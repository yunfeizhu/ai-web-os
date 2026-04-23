"""Conversation context management: token budgeting, history truncation,
and tool-result summarisation.

Uses LiteLLM's built-in ``token_counter`` so no extra dependencies are needed.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import Any, Awaitable, Callable

from litellm import get_max_tokens, token_counter

logger = logging.getLogger(__name__)

# ── Defaults ──────────────────────────────────────────────────

# Fallback context window when LiteLLM cannot determine model limits.
_DEFAULT_CONTEXT_WINDOW = 128_000

# Maximum proportion of the context window that history may occupy.
_HISTORY_BUDGET_RATIO = 0.70

# When a single tool result exceeds this many characters, it will be
# summarised in *historical* turns (the current turn keeps the original).
_TOOL_RESULT_SUMMARY_THRESHOLD = 1500
_CURRENT_TOOL_RESULT_CONTEXT_LIMIT = 4000
_SUBAGENT_TOOL_RESULT_CONTEXT_LIMIT = 1400
_SEARCH_RESULT_SNIPPET_LIMIT = 260
_MAX_SEARCH_RESULTS_FOR_CONTEXT = 4
_CONTEXT_COMPRESSION_TRIGGER_RATIO = 0.62
_CONTEXT_COMPRESSION_KEEP_RECENT_GROUPS = 8
_COMPACTION_RENDER_MAX_CHARS = 60_000
_COMPACTION_MESSAGE_SNIPPET_CHARS = 1800
_COMPACTION_SUMMARY_MAX_CHARS = 8000

CONTEXT_COMPRESSION_MARKER = "[ContextSummary:v1]"

# Sentinel appended to truncated tool results so the model sees the cut.
_TRUNCATION_MARKER = "\n\n…[结果已截断，仅保留关键部分]"

# Reminder injected right before the latest user message.
TOOL_USE_REMINDER = (
    "[系统提示] 如果本次请求需要获取实时数据或执行操作，并且存在名称、描述、参数都明显匹配的工具，"
    "请通过 function calling 调用对应工具；如果没有匹配工具，不要调用无关工具。"
    "禁止根据之前的对话历史仿写或编造工具返回结果。每次查询都可能返回不同数据。"
)

_ALLOWED_MESSAGE_ROLES = {"system", "user", "assistant", "tool", "function"}

HistorySummarizer = Callable[[list[dict]], Awaitable[str]]


@dataclass(frozen=True)
class ContextCompactionResult:
    messages: list[dict]
    compacted: bool
    before_tokens: int
    after_tokens: int
    summary_tokens: int = 0
    old_message_count: int = 0
    kept_message_count: int = 0
    reason: str = ""


# ── Public API ────────────────────────────────────────────────


def get_model_context_window(model: str) -> int:
    """Return the context window size for *model*, with a safe fallback."""
    try:
        max_tok = get_max_tokens(model)
        if max_tok and max_tok > 0:
            return int(max_tok)
    except Exception:
        pass
    return _DEFAULT_CONTEXT_WINDOW


def count_tokens(model: str, messages: list[dict]) -> int:
    """Count tokens for a message list using LiteLLM's tokeniser."""
    try:
        return token_counter(model=model, messages=messages)
    except Exception:
        # Rough fallback: ~4 chars per token for CJK-heavy content.
        total_chars = sum(len(str(m.get("content") or "")) for m in messages)
        return total_chars // 3


def compact_tool_result_for_context(
    *,
    tool_name: str,
    result: str,
    is_subagent: bool = False,
    max_chars: int | None = None,
) -> str:
    """Return the model-context version of a current-turn tool result.

    The UI and persistence keep the original result. This compacted text is only
    appended to the LLM message list so large search payloads do not overflow
    small OpenAI-compatible context windows during the next ReAct step.
    """
    text = str(result or "")
    limit = max_chars or (
        _SUBAGENT_TOOL_RESULT_CONTEXT_LIMIT
        if is_subagent
        else _CURRENT_TOOL_RESULT_CONTEXT_LIMIT
    )
    if len(text) <= limit:
        return text

    name = str(tool_name or "")
    if name.startswith(("mcp_", "browser_")) or name in {"fetch_url", "retrieve_knowledge"}:
        compacted = _compact_search_like_result(text, limit)
        if compacted:
            return compacted

    return _truncate_tool_result_to_limit(text, limit)


async def compact_history_if_needed(
    *,
    model: str,
    history: list[dict],
    max_output_tokens: int = 4096,
    token_budget: int | None = None,
    trigger_ratio: float = _CONTEXT_COMPRESSION_TRIGGER_RATIO,
    keep_recent_groups: int = _CONTEXT_COMPRESSION_KEEP_RECENT_GROUPS,
    summarizer: HistorySummarizer | None = None,
) -> ContextCompactionResult:
    """Replace older conversation history with a compact summary when needed.

    This is the high-level "conversation compaction" layer. It complements the
    lighter tool-result compaction above: verbose tool payloads are already
    shortened, and once the whole history grows too large, earlier turns are
    summarized while the recent tail remains verbatim.
    """
    preserve_reasoning_content = _model_uses_reasoning_history(model)
    processed = _sanitize_history_messages(
        history,
        preserve_reasoning_content=preserve_reasoning_content,
    )
    before_tokens = count_tokens(model, processed)

    if token_budget is None:
        context_window = get_model_context_window(model)
        token_budget = max(2000, context_window - max_output_tokens)

    trigger_tokens = max(500, int(token_budget * max(0.1, min(trigger_ratio, 0.95))))
    if before_tokens <= trigger_tokens:
        return ContextCompactionResult(
            messages=processed,
            compacted=False,
            before_tokens=before_tokens,
            after_tokens=before_tokens,
            reason="under_threshold",
        )

    groups = _group_turns(processed)
    if len(groups) <= keep_recent_groups:
        return ContextCompactionResult(
            messages=processed,
            compacted=False,
            before_tokens=before_tokens,
            after_tokens=before_tokens,
            reason="not_enough_history",
        )

    old_messages = [message for group in groups[:-keep_recent_groups] for message in group]
    recent_messages = [message for group in groups[-keep_recent_groups:] for message in group]
    if not old_messages:
        return ContextCompactionResult(
            messages=processed,
            compacted=False,
            before_tokens=before_tokens,
            after_tokens=before_tokens,
            reason="empty_old_history",
        )

    summary = ""
    if summarizer is not None:
        try:
            summary = (await summarizer(old_messages)).strip()
        except Exception as exc:
            logger.warning("Context summarizer failed; using extractive fallback: %s", exc)

    if not summary:
        summary = _build_extractive_context_summary(old_messages)

    summary_message = _build_context_summary_message(summary, len(old_messages))
    summary_tokens = count_tokens(model, [summary_message])
    recent_budget = max(500, token_budget - summary_tokens)
    trimmed_recent = _trim_history(model, recent_messages, recent_budget)
    compacted_messages = [summary_message] + trimmed_recent
    after_tokens = count_tokens(model, compacted_messages)

    return ContextCompactionResult(
        messages=compacted_messages,
        compacted=True,
        before_tokens=before_tokens,
        after_tokens=after_tokens,
        summary_tokens=summary_tokens,
        old_message_count=len(old_messages),
        kept_message_count=len(trimmed_recent),
        reason="threshold_exceeded",
    )


def prepare_messages(
    model: str,
    system_prompt: str,
    history: list[dict],
    max_output_tokens: int = 4096,
) -> list[dict]:
    """Build the final message list handed to the LLM.

    Strategy (applied in order):
    1. **Summarise old tool results** – Replace verbose tool outputs in
       historical turns with a short summary so the model cannot copy them.
    2. **Inject a tool-use reminder** – A short system-level reminder is
       placed right before the latest user message to reinforce that the
       model must actually call tools, not fabricate results.
    3. **Sliding-window truncation** – If the total token count still
       exceeds the budget, drop the *oldest* turns (keeping the system
       prompt and the most recent N turns intact).
    """

    context_window = get_model_context_window(model)

    # Token budget for system + history (reserve space for output).
    total_budget = context_window - max_output_tokens
    if total_budget < 2000:
        total_budget = 2000  # safety floor

    # -- Step 0: separate system prompt ---------------------------------
    sys_msg = {"role": "system", "content": system_prompt}
    sys_tokens = count_tokens(model, [sys_msg])

    history_budget = total_budget - sys_tokens
    if history_budget < 500:
        # System prompt alone is enormous; cannot do much.
        logger.warning("System prompt uses %d tokens, leaving only %d for history", sys_tokens, history_budget)
        history_budget = 500

    # -- Step 1: normalise externally supplied history ------------------
    preserve_reasoning_content = _model_uses_reasoning_history(model)
    processed = _sanitize_history_messages(
        history,
        preserve_reasoning_content=preserve_reasoning_content,
    )

    # -- Step 2: summarise old tool results -----------------------------
    processed = _summarise_old_tool_results(processed)

    # -- Step 3: inject tool-use reminder -------------------------------
    processed = _inject_tool_reminder(processed)

    # -- Step 4: sliding-window truncation ------------------------------
    trimmed = _trim_history(model, processed, history_budget)

    return [sys_msg] + trimmed


# ── Internal helpers ──────────────────────────────────────────


def _sanitize_tool_calls(raw_tool_calls: Any) -> list[dict]:
    if not isinstance(raw_tool_calls, list):
        return []

    tool_calls: list[dict] = []
    for raw_call in raw_tool_calls:
        if not isinstance(raw_call, dict):
            continue
        function = raw_call.get("function") or {}
        if not isinstance(function, dict):
            function = {}

        call_id = str(raw_call.get("id") or "").strip()
        name = str(function.get("name") or raw_call.get("name") or "").strip()
        if not call_id or not name:
            continue

        arguments = function.get("arguments")
        if arguments is None:
            arguments = raw_call.get("args")
        if isinstance(arguments, dict):
            arguments = json.dumps(arguments, ensure_ascii=False)
        elif not isinstance(arguments, str):
            arguments = "{}"

        tool_calls.append({
            "id": call_id,
            "type": "function",
            "function": {
                "name": name,
                "arguments": arguments,
            },
        })
    return tool_calls


def _model_uses_reasoning_history(model: str) -> bool:
    model_id = str(model or "").split("/")[-1].lower()
    return model_id.startswith("kimi-k2")


def _sanitize_reasoning_content(value: Any) -> str | None:
    if isinstance(value, str):
        return value
    return None


def _assistant_message(
    *,
    content: str | None,
    reasoning_content: str | None,
    preserve_reasoning_content: bool,
    tool_calls: list[dict] | None = None,
) -> dict:
    message: dict = {"role": "assistant", "content": content}
    if tool_calls:
        message["tool_calls"] = tool_calls
        if preserve_reasoning_content:
            # Kimi thinking mode requires assistant tool-call messages in
            # follow-up history to carry the reasoning_content field.
            message["reasoning_content"] = reasoning_content or ""
    elif preserve_reasoning_content and reasoning_content:
        message["reasoning_content"] = reasoning_content
    return message


def _sanitize_history_messages(
    history: list[dict],
    *,
    preserve_reasoning_content: bool = False,
) -> list[dict]:
    """Keep only provider-valid messages and preserve tool-call coherence."""
    messages = [msg for msg in history if isinstance(msg, dict)]
    sanitized: list[dict] = []
    i = 0

    while i < len(messages):
        msg = messages[i]
        role = str(msg.get("role") or "").strip()
        if role not in _ALLOWED_MESSAGE_ROLES:
            logger.warning("Dropping invalid chat history role: %r", role)
            i += 1
            continue

        if role in {"system", "user"}:
            content = str(msg.get("content") or "")
            if content.strip() or role == "system":
                sanitized.append({"role": role, "content": content})
            i += 1
            continue

        if role == "assistant":
            content = msg.get("content")
            assistant_content = content if isinstance(content, str) else None
            reasoning_content = _sanitize_reasoning_content(msg.get("reasoning_content"))
            tool_calls = _sanitize_tool_calls(msg.get("tool_calls"))
            if not tool_calls:
                if assistant_content and assistant_content.strip():
                    sanitized.append(
                        _assistant_message(
                            content=assistant_content,
                            reasoning_content=reasoning_content,
                            preserve_reasoning_content=preserve_reasoning_content,
                        )
                    )
                i += 1
                continue

            expected_ids = {call["id"] for call in tool_calls}
            tool_results: list[dict] = []
            j = i + 1
            while j < len(messages) and str(messages[j].get("role") or "").strip() == "tool":
                tool_msg = messages[j]
                tool_call_id = str(tool_msg.get("tool_call_id") or "").strip()
                if tool_call_id in expected_ids:
                    tool_results.append({
                        "role": "tool",
                        "tool_call_id": tool_call_id,
                        "content": str(tool_msg.get("content") or ""),
                    })
                j += 1

            result_ids = {tool_msg["tool_call_id"] for tool_msg in tool_results}
            matched_calls = [call for call in tool_calls if call["id"] in result_ids]
            if matched_calls:
                sanitized.append(
                    _assistant_message(
                        content=assistant_content,
                        reasoning_content=reasoning_content,
                        preserve_reasoning_content=preserve_reasoning_content,
                        tool_calls=matched_calls,
                    )
                )
                sanitized.extend(tool_msg for tool_msg in tool_results if tool_msg["tool_call_id"] in result_ids)
            elif assistant_content and assistant_content.strip():
                sanitized.append(
                    _assistant_message(
                        content=assistant_content,
                        reasoning_content=reasoning_content,
                        preserve_reasoning_content=preserve_reasoning_content,
                    )
                )

            i = j
            continue

        # Orphaned tool/function messages are invalid in OpenAI-compatible
        # payloads, so they are ignored instead of being passed through.
        i += 1

    return sanitized


def _summarise_old_tool_results(messages: list[dict]) -> list[dict]:
    """Replace long tool results in all turns *except the most recent
    assistant+tool exchange* with a compact summary.

    The most recent tool round is kept intact because the model needs
    full data to formulate its current answer.
    """
    if not messages:
        return messages

    # Find the index of the last user message – everything after it
    # belongs to the "current turn" and should be kept as-is.
    last_user_idx = -1
    for i in range(len(messages) - 1, -1, -1):
        if messages[i].get("role") == "user":
            last_user_idx = i
            break

    result: list[dict] = []
    for i, msg in enumerate(messages):
        if i >= last_user_idx:
            # Current turn – keep original.
            result.append(msg)
            continue

        if msg.get("role") == "tool":
            content = str(msg.get("content") or "")
            if len(content) > _TOOL_RESULT_SUMMARY_THRESHOLD:
                result.append({
                    **msg,
                    "content": _truncate_tool_result(content),
                })
            else:
                result.append(msg)
        else:
            result.append(msg)

    return result


def _truncate_tool_result(content: str) -> str:
    """Keep the first portion of a tool result up to the threshold."""
    keep = _TOOL_RESULT_SUMMARY_THRESHOLD
    return content[:keep] + _TRUNCATION_MARKER


def _truncate_tool_result_to_limit(content: str, limit: int) -> str:
    keep = max(200, limit - len(_TRUNCATION_MARKER))
    return content[:keep] + _TRUNCATION_MARKER


def _parse_jsonish(value: Any) -> Any | None:
    if isinstance(value, (dict, list)):
        return value
    if not isinstance(value, str):
        return None
    s = value.strip()
    if not s or s[0] not in "{[":
        return None
    try:
        return json.loads(s)
    except Exception:
        return None


def _find_search_payload(value: Any) -> dict[str, Any] | None:
    parsed = _parse_jsonish(value)
    if parsed is None:
        return None

    if isinstance(parsed, dict):
        if isinstance(parsed.get("results"), list):
            return parsed
        content = parsed.get("content")
        if isinstance(content, list):
            for item in content:
                if isinstance(item, dict):
                    nested = _find_search_payload(item.get("text"))
                    if nested:
                        return nested
        for child in parsed.values():
            nested = _find_search_payload(child)
            if nested:
                return nested
    elif isinstance(parsed, list):
        for item in parsed:
            nested = _find_search_payload(item)
            if nested:
                return nested
    return None


def _compact_search_like_result(content: str, limit: int) -> str | None:
    payload = _find_search_payload(content)
    if not payload:
        return None

    lines: list[str] = [
        "[ToolResult compacted for model context; original result is stored in the tool event.]",
    ]
    query = str(payload.get("query") or "").strip()
    answer = str(payload.get("answer") or "").strip()
    if query:
        lines.append(f"query: {query}")
    if answer and answer.lower() != "none":
        lines.append(f"answer: {answer[:_SEARCH_RESULT_SNIPPET_LIMIT]}")

    results = payload.get("results")
    if isinstance(results, list):
        for index, item in enumerate(results[:_MAX_SEARCH_RESULTS_FOR_CONTEXT], start=1):
            if not isinstance(item, dict):
                continue
            title = str(item.get("title") or "").strip()
            url = str(item.get("url") or "").strip()
            published = str(
                item.get("published_date") or item.get("date") or item.get("time") or ""
            ).strip()
            snippet = str(item.get("content") or item.get("snippet") or "").strip()
            snippet = " ".join(snippet.split())[:_SEARCH_RESULT_SNIPPET_LIMIT]
            lines.append(f"\nresult {index}:")
            if title:
                lines.append(f"title: {title}")
            if url:
                lines.append(f"url: {url}")
            if published:
                lines.append(f"date: {published}")
            if snippet:
                lines.append(f"snippet: {snippet}")

    compacted = "\n".join(lines).strip()
    if not compacted:
        return None
    if len(compacted) > limit:
        return _truncate_tool_result_to_limit(compacted, limit)
    return compacted


def render_messages_for_compaction(
    messages: list[dict],
    *,
    max_chars: int = _COMPACTION_RENDER_MAX_CHARS,
) -> str:
    """Render chat history into a bounded transcript for the summarizer."""
    lines: list[str] = []
    total = 0
    for index, msg in enumerate(messages, start=1):
        role = str(msg.get("role") or "unknown")
        header = f"\n[{index}] role={role}"
        if role == "tool":
            header += f" tool_call_id={msg.get('tool_call_id') or ''}"
        lines.append(header)
        total += len(header)

        tool_calls = msg.get("tool_calls")
        if isinstance(tool_calls, list) and tool_calls:
            call_lines: list[str] = []
            for call in tool_calls:
                if not isinstance(call, dict):
                    continue
                function = call.get("function") or {}
                if not isinstance(function, dict):
                    function = {}
                name = function.get("name") or call.get("name") or ""
                arguments = function.get("arguments") or call.get("args") or ""
                call_lines.append(f"- {name}: {_compact_inline(arguments, 360)}")
            if call_lines:
                chunk = "\ntool_calls:\n" + "\n".join(call_lines)
                lines.append(chunk)
                total += len(chunk)

        content = str(msg.get("content") or "").strip()
        if content:
            if role == "tool":
                content = _compact_inline(content, _TOOL_RESULT_SUMMARY_THRESHOLD)
            else:
                content = _compact_inline(content, _COMPACTION_MESSAGE_SNIPPET_CHARS)
            chunk = f"\ncontent:\n{content}"
            lines.append(chunk)
            total += len(chunk)

        if total >= max_chars:
            lines.append("\n[transcript clipped for compaction input]")
            break

    return "\n".join(lines).strip()


def _compact_inline(value: Any, limit: int) -> str:
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
    compact = " ".join(str(text or "").split())
    if len(compact) <= limit:
        return compact
    return compact[: max(80, limit - 20)] + " ... [clipped]"


def _build_context_summary_message(summary: str, old_message_count: int) -> dict:
    clean_summary = str(summary or "").strip() or "Earlier context was compacted."
    clean_summary = _compact_inline(clean_summary, _COMPACTION_SUMMARY_MAX_CHARS)
    return {
        "role": "system",
        "content": (
            f"{CONTEXT_COMPRESSION_MARKER}\n"
            "The earlier conversation history has been compressed to preserve "
            "working context. Treat this summary as authoritative background, "
            "then rely on the recent verbatim turns below for exact wording.\n\n"
            f"Compressed message count: {old_message_count}\n\n"
            f"{clean_summary}"
        ),
    }


def _build_extractive_context_summary(messages: list[dict]) -> str:
    """Deterministic fallback when model-based summary is unavailable."""
    lines = [
        "Fallback extractive summary of earlier turns:",
        "- Preserve explicit user requirements, decisions, unresolved tasks, file paths, "
        "tool names, errors, and final results below.",
    ]
    for msg in messages[-24:]:
        role = str(msg.get("role") or "unknown")
        if role == "tool":
            content = _compact_inline(msg.get("content") or "", 420)
            if content:
                lines.append(f"- tool[{msg.get('tool_call_id') or '?'}]: {content}")
            continue

        content = _compact_inline(msg.get("content") or "", 520)
        if content:
            lines.append(f"- {role}: {content}")

        tool_calls = msg.get("tool_calls")
        if isinstance(tool_calls, list) and tool_calls:
            names: list[str] = []
            for call in tool_calls:
                if not isinstance(call, dict):
                    continue
                function = call.get("function") or {}
                if not isinstance(function, dict):
                    function = {}
                name = str(function.get("name") or call.get("name") or "").strip()
                if name:
                    names.append(name)
            if names:
                lines.append(f"- assistant tool calls: {', '.join(names[:8])}")
    return "\n".join(lines)


def _inject_tool_reminder(messages: list[dict]) -> list[dict]:
    """Insert a brief system reminder right before the last user message
    so it sits in the model's recency window.
    """
    if not messages:
        return messages

    last_user_idx = -1
    for i in range(len(messages) - 1, -1, -1):
        if messages[i].get("role") == "user":
            last_user_idx = i
            break

    if last_user_idx < 0:
        return messages

    reminder = {"role": "system", "content": TOOL_USE_REMINDER}
    out = messages[:last_user_idx] + [reminder] + messages[last_user_idx:]
    return out


def _trim_history(
    model: str,
    messages: list[dict],
    budget_tokens: int,
) -> list[dict]:
    """Drop oldest messages until the history fits within *budget_tokens*.

    Preserves coherence rules:
    - Never orphan a ``tool`` message from its preceding ``assistant``
      that contains the matching ``tool_calls``.
    - Keep a leading compaction summary when present.
    - Always keep the most recent user message and the reminder.
    """
    current_tokens = count_tokens(model, messages)
    if current_tokens <= budget_tokens:
        return messages

    # Group messages into logical "turns" that must stay together.
    groups = _group_turns(messages)
    protected_prefix: list[list[dict]] = []
    if groups and _group_has_context_summary(groups[0]):
        protected_prefix = [groups.pop(0)]

    # Drop from the front (oldest) until we fit.
    while len(groups) > 1 and current_tokens > budget_tokens:
        groups.pop(0)
        current_tokens = count_tokens(
            model,
            [m for g in [*protected_prefix, *groups] for m in g],
        )

    return [m for g in [*protected_prefix, *groups] for m in g]


def _group_has_context_summary(group: list[dict]) -> bool:
    for message in group:
        if message.get("role") != "system":
            continue
        if CONTEXT_COMPRESSION_MARKER in str(message.get("content") or ""):
            return True
    return False


def _group_turns(messages: list[dict]) -> list[list[dict]]:
    """Group messages into indivisible turn blocks.

    A turn block is:
    - A single ``user`` or ``system`` message, OR
    - An ``assistant`` message followed by its ``tool`` result messages.
    """
    groups: list[list[dict]] = []
    current_group: list[dict] = []

    for msg in messages:
        role = msg.get("role")
        if role == "assistant":
            # Start a new group for assistant + upcoming tool results.
            if current_group:
                groups.append(current_group)
            current_group = [msg]
        elif role == "tool":
            # Attach to the current assistant group.
            current_group.append(msg)
        else:
            # user / system – standalone group.
            if current_group:
                groups.append(current_group)
            current_group = [msg]

    if current_group:
        groups.append(current_group)

    return groups
