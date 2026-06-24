"""Agent policy engine — tool call guards, result validation, fallback decisions.

This module is intentionally narrow. It does NOT perform routing or scope
inference. Those responsibilities belong to the LLM and tool descriptions.
This module enforces hard safety invariants and returns deterministic fallback
instructions when a tool result cannot be trusted:

  - File tools must not access skill-internal or non-virtual paths.
  - Calculator must not be used for non-math expressions.
  - Duplicate tool calls with the same query are detected and blocked.
  - Tool results are classified as ok / failed for the agent loop to act on.
  - Temporal arguments in search queries are normalised to the intended year.

Design reference: smolagents policy layer, LangChain tool-validation guards,
Hermes/OpenClaw agent control-plane patterns.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import json
import re
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from app.core.tool_capabilities import (
    json_result_has_partial_success,
    json_result_has_total_extract_failure,
)

FILE_TOOL_NAMES: frozenset[str] = frozenset({"list_files", "read_file", "write_file"})
NOTE_TOOL_NAMES: frozenset[str] = frozenset({"list_notes", "save_note"})
MEMORY_INTENT_TERMS: tuple[str, ...] = (
    "记住",
    "记得",
    "记录",
    "以后",
    "偏好",
    "喜欢",
    "希望",
    "决定",
    "remember",
    "note that",
)
EXPLICIT_NOTE_TERMS: tuple[str, ...] = (
    "笔记",
    "备忘录",
    "便签",
    "notes",
    "note",
    "/notes",
)


# ── Decision dataclasses ──────────────────────────────────────────────────────


@dataclass(frozen=True)
class ToolPolicyDecision:
    allowed: bool
    reason: str = ""
    replacement_hint: str = ""


@dataclass(frozen=True)
class ToolResultValidation:
    ok: bool
    reason: str = ""
    retryable: bool = False
    fallback_hint: str = ""


@dataclass(frozen=True)
class FallbackPolicyDecision:
    action: str
    retry_original_tool: bool = False
    system_hint: str = ""


# ── Tool name predicates ──────────────────────────────────────────────────────


def is_mcp_tool(tool_name: str) -> bool:
    return str(tool_name or "").startswith("mcp_")


def is_skill_tool(tool_name: str) -> bool:
    return str(tool_name or "").startswith("skill_")


def is_browser_tool(tool_name: str) -> bool:
    return str(tool_name or "").startswith("browser_")


def is_load_skill_tool(tool_name: str) -> bool:
    return str(tool_name or "") == "load_skill_context"


# ── Human-in-the-loop confirmation predicates ─────────────────────────────────

# Base set is intentionally empty; extend via Settings.confirm_required_tools or
# by passing extra_tools= to tool_requires_confirmation().
# Typical candidates: "python_exec", "write_file", "delete_file", "send_email"
CONFIRM_REQUIRED_TOOLS: frozenset[str] = frozenset()


def tool_requires_confirmation(
    tool_name: str,
    args: dict | None = None,
    *,
    extra_tools: frozenset[str] | None = None,
) -> bool:
    """Return True when this tool call must be confirmed by the user before execution.

    The base CONFIRM_REQUIRED_TOOLS set is empty; callers extend it via
    ``extra_tools`` (e.g. loaded from Settings.confirm_required_tools).
    """
    confirm_set = CONFIRM_REQUIRED_TOOLS | (extra_tools or frozenset())
    return str(tool_name or "") in confirm_set


# ── Path inspection helpers ───────────────────────────────────────────────────


def _looks_like_skill_internal_path(path: str) -> bool:
    n = str(path or "").replace("\\", "/").lower()
    if not n:
        return False
    return any(
        m in n
        for m in (
            "/app/",
            "/skills/",
            "/.kimi/",
            "/.codex/",
            "/.claude/",
            "skill.md",
            "skills/user",
        )
    )


def _looks_like_virtual_file_path(path: str) -> bool:
    n = str(path or "").replace("\\", "/").strip()
    if not n or not n.startswith("/"):
        return False
    return not n.startswith(("/app/", "/workspace/", "/usr/", "/var/", "/etc/"))


def _looks_like_reserved_memory_file_path(path: str) -> bool:
    n = str(path or "").replace("\\", "/").strip().lower()
    if not n:
        return False
    leaf = n.rsplit("/", 1)[-1]
    return (
        leaf in {"memory.md", "dreams.md"}
        or "/daily/" in n
        or "/.dreams/" in n
    )


# ── Tool policy guard ─────────────────────────────────────────────────────────


_NON_MATH_RE = re.compile(
    r"\b(time|date|datetime|now|today|weekday|import|from|open|exec|eval)\b",
    re.I,
)


def guard_tool_call(
    *,
    tool_name: str,
    args: dict[str, Any],
    task_text: str = "",
) -> ToolPolicyDecision:
    """Validate a tool call for safety violations.

    This function has NO routing logic. It only blocks provably wrong calls:
      - File tools trying to access skill-internal or non-virtual paths.
      - Calculator used for non-math expressions (e.g. time(), Chinese text).

    All routing decisions are left to the LLM based on tool descriptions.
    """
    name = str(tool_name or "")

    if name in NOTE_TOOL_NAMES and _is_memory_request_without_explicit_note(task_text):
        return ToolPolicyDecision(
            allowed=False,
            reason="memory_request_should_not_use_notes",
            replacement_hint=(
                "这是记忆请求，不是笔记编辑请求。请直接回复用户；"
                "对话结束后记忆系统会自动把可保存内容写入待整理记忆。"
            ),
        )

    if name in FILE_TOOL_NAMES:
        path = str(args.get("path") or "")
        if name == "write_file" and _is_memory_request_without_explicit_note(task_text):
            return ToolPolicyDecision(
                allowed=False,
                reason="memory_request_should_not_use_files",
                replacement_hint=(
                    "这是记忆请求，不是文件编辑请求。请直接回复用户；"
                    "对话结束后记忆系统会自动把可保存内容写入待整理记忆。"
                ),
            )
        if name == "write_file" and _looks_like_reserved_memory_file_path(path):
            return ToolPolicyDecision(
                allowed=False,
                reason="reserved_memory_file_path_blocked",
                replacement_hint=(
                    "MEMORY.md、DREAMS.md 和 daily 记忆文件由记忆系统维护；"
                    "需要读取时请使用 memory_search 或 memory_get，不要用 write_file 直接覆盖。"
                ),
            )
        if _looks_like_skill_internal_path(path):
            return ToolPolicyDecision(
                allowed=False,
                reason="skill_internal_path_blocked",
                replacement_hint=(
                    "Skill 的本地文件不能通过 read_file/list_files 读取。"
                    "请直接调用对应的 skill_* 工具执行任务，"
                    "或使用 load_skill_context(skill_id) 加载 Skill 说明文档。"
                ),
            )
        if path and not _looks_like_virtual_file_path(path):
            return ToolPolicyDecision(
                allowed=False,
                reason="invalid_virtual_file_path",
                replacement_hint="文件工具只能访问文件管理器虚拟路径，例如 / 或 /Notes。",
            )

    if name == "calculator":
        expr = str(args.get("expression") or "").strip()
        if _NON_MATH_RE.search(expr) or re.search(r"[\u4e00-\u9fff]", expr):
            return ToolPolicyDecision(
                allowed=False,
                reason="calculator_non_math_expression",
                replacement_hint=(
                    "calculator 只能用于纯数学表达式（如 2+3*4 或 sqrt(16)）。"
                    "当前日期时间已在系统上下文中，请直接回答而无需调用工具。"
                ),
            )

    return ToolPolicyDecision(allowed=True)


def _is_memory_request_without_explicit_note(task_text: str) -> bool:
    normalized = str(task_text or "").strip().lower()
    if not normalized:
        return False
    if any(term in normalized for term in EXPLICIT_NOTE_TERMS):
        return False
    return any(term in normalized for term in MEMORY_INTENT_TERMS)


# ── Duplicate call detection ──────────────────────────────────────────────────


def tool_call_signature(tool_name: str, args: dict[str, Any]) -> str | None:
    """Return a canonical key for detecting duplicate tool calls.

    Year tokens are stripped so that "茅台2025年股价" and "茅台2026年股价" are
    treated as the same query (model re-asking with a different year).
    """
    name = str(tool_name or "")
    if not name:
        return None
    query = ""
    for key in ("query", "q", "search_query", "url", "path", "expression"):
        value = args.get(key)
        if isinstance(value, str) and value.strip():
            query = value
            break
    if not query:
        return None
    normalized = re.sub(r"20\d{2}\s*年?", "", query.lower())
    normalized = re.sub(r"\s+", "", normalized)
    normalized = re.sub(r"[^\w\u4e00-\u9fff]+", "", normalized)
    return f"{name}:{normalized}"


# ── Tool result validation ────────────────────────────────────────────────────


_FAILURE_MARKERS: tuple[str, ...] = (
    "工具执行异常",
    "工具调用被策略拦截",
    "查询失败",
    "请求失败",
    "抓取失败",
    "failed to fetch",
    "notimplementederror",
    "api token 未设置",
    "api key 未设置",
    "缺少 query 参数",
    "缺少 skill_id",
    "未找到可用 skill",
)


def _result_has_failure_marker(text: str) -> bool:
    lowered = text.lower()
    return any(m.lower() in lowered for m in _FAILURE_MARKERS)


def _json_result_is_error(text: str) -> bool:
    try:
        payload = json.loads(text)
    except Exception:
        return False
    if isinstance(payload, dict):
        if payload.get("isError") is True or payload.get("is_error") is True:
            return True
        content = payload.get("content")
        if isinstance(content, list):
            return any(
                isinstance(item, dict) and item.get("isError") is True
                for item in content
            )
    return False


def _json_has_no_search_results(text: str) -> bool:
    """Return True when a JSON search response contains empty result sets."""
    try:
        payload = json.loads(text)
    except Exception:
        return False

    def _walk(value: Any):
        yield value
        if isinstance(value, dict):
            for v in value.values():
                yield from _walk(v)
        elif isinstance(value, list):
            for v in value:
                yield from _walk(v)
        elif isinstance(value, str):
            s = value.strip()
            if s.startswith(("{", "[")):
                try:
                    yield from _walk(json.loads(s))
                except Exception:
                    pass

    saw_search = False
    saw_empty_results = False
    saw_answer = False
    for node in _walk(payload):
        if not isinstance(node, dict):
            continue
        if "results" in node or "answer" in node:
            saw_search = True
            answer = str(node.get("answer") or "").strip()
            if answer and answer.lower() not in {"none", "null", "无", "n/a"}:
                saw_answer = True
            if (
                isinstance(node.get("results"), list)
                and not node["results"]
                and not answer
            ):
                saw_empty_results = True
    compact = text.replace(" ", "")
    return saw_search and not saw_answer and (saw_empty_results or '"results":[]' in compact)


def validate_tool_result(
    *,
    tool_name: str,
    result: str,
    error: bool,
) -> ToolResultValidation:
    """Classify a tool result into ok / failed for the agent loop.

    Does NOT make routing or fallback decisions — only reports whether
    the result looks valid so the agent loop can decide what to do next.
    """
    text = str(result or "").strip()

    if not text:
        return ToolResultValidation(
            ok=False,
            reason="empty_result",
            retryable=True,
            fallback_hint="工具没有返回内容，请换用其他工具或向用户说明失败。",
        )

    if text.startswith("工具调用被策略拦截"):
        return ToolResultValidation(
            ok=False,
            reason="policy_blocked",
            retryable=False,
            fallback_hint="遵循策略提示修正参数，不要重复调用被拦截的工具。",
        )

    if is_mcp_tool(tool_name) and json_result_has_partial_success(text):
        return ToolResultValidation(ok=True)

    if is_mcp_tool(tool_name) and (
        json_result_has_total_extract_failure(text) or _json_has_no_search_results(text)
    ):
        return ToolResultValidation(
            ok=False,
            reason="no_search_results",
            retryable=False,
            fallback_hint="搜索没有返回有效结果，请换个查询词或向用户说明数据不可用。",
        )

    if error or _json_result_is_error(text) or _result_has_failure_marker(text):
        return ToolResultValidation(
            ok=False,
            reason="tool_failure",
            retryable=True,
            fallback_hint="工具执行失败，请修正参数重试或向用户说明失败原因。",
        )

    return ToolResultValidation(ok=True)


# ── Fallback policy ───────────────────────────────────────────────────────────


def decide_fallback_policy(
    *,
    tool_name: str,
    validation: ToolResultValidation,
) -> FallbackPolicyDecision:
    """Return a deterministic recovery instruction for failed tool results.

    This does not choose a concrete next tool for the model. It constrains the
    recovery lane so the ReAct loop avoids repeating known-bad calls.
    """
    if validation.ok:
        return FallbackPolicyDecision(action="none")

    name = str(tool_name or "")
    reason = str(validation.reason or "")

    if reason == "policy_blocked":
        return FallbackPolicyDecision(
            action="revise_arguments",
            retry_original_tool=False,
            system_hint=(
                "不要重复调用刚才被策略拦截的工具参数。"
                "请根据策略提示修正参数；如果无法修正，向用户说明限制。"
            ),
        )

    if is_skill_tool(name) and reason in {"tool_failure", "empty_result"}:
        return FallbackPolicyDecision(
            action="switch_to_realtime_research",
            retry_original_tool=False,
            system_hint=(
                "Skill 工具失败后不要继续重试同一个 Skill。"
                "请切换到具备 search.discovery / web.fetch 能力的实时研究工具，"
                "或在已有 URL 时使用 fetch_url；若没有可用研究工具，请说明失败原因。"
            ),
        )

    if is_mcp_tool(name) and reason == "no_search_results":
        return FallbackPolicyDecision(
            action="reformulate_search",
            retry_original_tool=False,
            system_hint=(
                "搜索没有有效结果，不要用同一查询重复搜索。"
                "请改写查询词、降低限定条件，或基于已有证据说明未找到数据。"
            ),
        )

    if reason == "empty_result":
        return FallbackPolicyDecision(
            action="try_alternative_tool",
            retry_original_tool=False,
            system_hint=(
                "工具返回空结果，不要原样重试。"
                "请尝试其他可用工具、换一种参数，或向用户说明无法取得结果。"
            ),
        )

    if validation.retryable:
        return FallbackPolicyDecision(
            action="retry_with_revised_arguments",
            retry_original_tool=False,
            system_hint=(
                "工具失败但可能可恢复。请先修正参数或选择更合适的工具，"
                "不要用完全相同的参数重复调用。"
            ),
        )

    return FallbackPolicyDecision(
        action="explain_limitation",
        retry_original_tool=False,
        system_hint="当前失败不可自动恢复，请向用户说明限制和已尝试的路径。",
    )


# ── Temporal argument normalisation ──────────────────────────────────────────


_NETWORK_TOOL_NAMES: frozenset[str] = frozenset({"fetch_url", "retrieve_knowledge"})


def _current_year() -> int:
    try:
        tz: Any = ZoneInfo("Asia/Shanghai")
    except ZoneInfoNotFoundError:
        tz = timezone(timedelta(hours=8))
    return datetime.now(tz).year


def normalize_temporal_tool_args(
    *,
    tool_name: str,
    args: dict[str, Any],
    user_message: str,
) -> dict[str, Any]:
    """Normalise year tokens in search query arguments.

    If the user's message implies a particular year but the model generated
    a query with a different year (e.g. from stale training-time memory),
    this replaces that year with the intended one.
    Only applies to MCP / network tools with query arguments.
    """
    name = str(tool_name or "")
    if not (is_mcp_tool(name) or name in _NETWORK_TOOL_NAMES):
        return args

    text = str(user_message or "")

    explicit = re.search(r"(20\d{2})\s*年?", text)
    if explicit:
        intended_year = int(explicit.group(1))
    else:
        now = _current_year()
        if "明年" in text:
            intended_year = now + 1
        elif "去年" in text:
            intended_year = now - 1
        elif re.search(
            r"\d{1,2}\s*月|五一|黄金周|春节|国庆|今天|明天|后天|本周|周末|下周|最近|实时|最新",
            text,
        ):
            intended_year = now
        else:
            return args

    normalized = dict(args)
    for key in ("query", "q", "search_query"):
        value = normalized.get(key)
        if not isinstance(value, str) or not value.strip():
            continue
        q = re.sub(r"20\d{2}\s*年?", f"{intended_year}年", value)
        if not re.search(r"20\d{2}", q):
            q = f"{q.strip()} {intended_year}年"
        normalized[key] = q
    return normalized


# ── Trace payload helpers ─────────────────────────────────────────────────────


def policy_trace_payload(
    *,
    tool_name: str,
    args: dict[str, Any],
    decision: ToolPolicyDecision,
) -> dict[str, Any]:
    return {
        "status": "tool_policy",
        "tool": tool_name,
        "decision": "allowed" if decision.allowed else "rejected",
        "reason": decision.reason,
        "hint": decision.replacement_hint,
        "args": args,
    }


def validation_trace_payload(
    *,
    tool_name: str,
    validation: ToolResultValidation,
) -> dict[str, Any]:
    return {
        "tool": tool_name,
        "validation": "ok" if validation.ok else "failed",
        "reason": validation.reason,
        "retryable": validation.retryable,
        "hint": validation.fallback_hint,
    }


def fallback_trace_payload(decision: FallbackPolicyDecision) -> dict[str, Any]:
    return {
        "fallbackAction": decision.action,
        "fallbackRetryOriginalTool": decision.retry_original_tool,
        "fallbackHint": decision.system_hint,
    }

