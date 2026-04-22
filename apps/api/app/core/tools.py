"""Built-in tool definitions and MCP bridging for the agent loop."""

from __future__ import annotations

import ast
import asyncio
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time
from typing import Any

import httpx

from app.config import get_settings
from app.core.agent_harness import (
    FILE_TOOL_NAMES,
    is_browser_tool,
)
from app.core.app_registry import get_app_registry
from app.core.browser_tools import BROWSER_TOOL_SCHEMAS, dispatch_browser_tool
from app.core.database import AsyncSessionLocal

# ── MCP route cache ───────────────────────────────────────────────────────────
_MCP_ROUTES_CACHE: list[dict] | None = None
_MCP_ROUTES_CACHE_EXPIRES: float = 0.0
_MCP_ROUTES_CACHE_TTL = 30.0  # seconds


def invalidate_mcp_routes_cache() -> None:
    """Force the next call to _list_external_mcp_tool_routes to re-scan."""
    global _MCP_ROUTES_CACHE
    _MCP_ROUTES_CACHE = None

BUILTIN_TOOL_SCHEMAS: list[dict] = [
    {
        "type": "function",
        "function": {
            "name": "calculator",
            "description": "Calculate a pure math expression safely (e.g. 2+3*4, sqrt(16)). Use ONLY for arithmetic; do not use for time, date, or text queries.",
            "parameters": {
                "type": "object",
                "properties": {
                    "expression": {
                        "type": "string",
                        "description": "Math expression such as `2 + 3 * 4` or `sqrt(16)`.",
                    }
                },
                "required": ["expression"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "fetch_url",
            "description": "Fetch a URL and return its plain-text content. Use for retrieving specific web pages when you already know the URL.",
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "The URL to fetch.",
                    },
                    "max_chars": {
                        "type": "integer",
                        "description": "Maximum characters to return.",
                        "default": 3000,
                    },
                },
                "required": ["url"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_files",
            "description": "List files and directories in the virtual file system (paths starting with /). Do NOT use for Skill directories or local OS paths.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Directory path such as `/` or `/Notes`.",
                        "default": "/",
                    }
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": "Read a text file from the virtual file system (paths starting with /). Do NOT use for Skill directories or local OS paths.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "File path such as `/Notes/todo.md`.",
                    }
                },
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "write_file",
            "description": "Write a text file into the virtual file system.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Target file path.",
                    },
                    "content": {
                        "type": "string",
                        "description": "Full file content.",
                    },
                },
                "required": ["path", "content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "python_exec",
            "description": "Execute arbitrary Python code in a sandboxed subprocess. Use ONLY when the user explicitly requests code execution or computation that cannot be done with calculator. For Skill scripts, use the dedicated skill_* tool instead.",
            "parameters": {
                "type": "object",
                "properties": {
                    "code": {
                        "type": "string",
                        "description": "Python code to execute.",
                    }
                },
                "required": ["code"],
            },
        },
    },
]

BUILTIN_TOOL_SCHEMAS.extend(BROWSER_TOOL_SCHEMAS)

RETRIEVE_KNOWLEDGE_SCHEMA: dict = {
    "type": "function",
    "function": {
        "name": "retrieve_knowledge",
        "description": "Search the local knowledge base for relevant passages.",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Search query.",
                }
            },
            "required": ["query"],
        },
    },
}

LOAD_SKILL_CONTEXT_TOOL_NAME = "load_skill_context"

DELEGATE_TASK_SCHEMA: dict = {
    "type": "function",
    "function": {
        "name": "delegate_task",
        "description": (
            "Call one or more specialist agents as tools while you keep ownership "
            "of the user-facing answer. Use only when a bounded subtask benefits "
            "from isolated context, a role-specific tool set, or parallel execution. "
            "Do not use for simple questions, direct conversation handoff, or "
            "sequential tasks where a later step depends on an earlier result."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "tasks": {
                    "type": "array",
                    "description": (
                        "Specialist tasks. Items may run in parallel, so every task must be "
                        "independent and self-contained."
                    ),
                    "items": {
                        "type": "object",
                        "properties": {
                            "role": {
                                "type": "string",
                                "enum": ["research", "coder", "system", "writer"],
                                "description": (
                                    "Specialist role. research=web/knowledge/realtime facts; "
                                    "coder=code/math/data; system=files/calendar/mail/notes; "
                                    "writer=drafting/translation/formatting."
                                ),
                            },
                            "task": {
                                "type": "string",
                                "description": (
                                    "A complete, self-contained task contract including goal, "
                                    "scope boundaries, needed context, and what not to do."
                                ),
                            },
                            "agent_name": {
                                "type": "string",
                                "description": (
                                    "Short stable label for the specialist, e.g. "
                                    "`research_prices`, `coder_analysis`, `writer_summary`."
                                ),
                            },
                            "output_format": {
                                "type": "string",
                                "description": (
                                    "Expected final shape, e.g. `bullets with sources`, "
                                    "`JSON array`, `markdown table`, or `short answer`."
                                ),
                            },
                            "success_criteria": {
                                "type": "string",
                                "description": (
                                    "How the specialist should know it is done. Include source, "
                                    "verification, or safety expectations when relevant."
                                ),
                            },
                            "allowed_tools": {
                                "type": "array",
                                "items": {"type": "string"},
                                "description": (
                                    "Optional extra exact tool whitelist. The server still applies "
                                    "the role's allowlist first."
                                ),
                            },
                        },
                        "required": ["role", "task", "agent_name"],
                    },
                    "minItems": 1,
                    "maxItems": 4,
                }
            },
            "required": ["tasks"],
        },
    },
}


def _tool_schema_name(schema: dict[str, Any]) -> str:
    return str(((schema.get("function") or {}).get("name")) or "")


_SAFE_NAMES: dict[str, Any] = {
    "abs": abs,
    "round": round,
    "min": min,
    "max": max,
    "sum": sum,
    "pow": pow,
    "int": int,
    "float": float,
    **{key: getattr(math, key) for key in dir(math) if not key.startswith("_")},
}

_ALLOWED_NODE_TYPES = (
    ast.Expression,
    ast.BinOp,
    ast.UnaryOp,
    ast.Call,
    ast.Constant,
    ast.Add,
    ast.Sub,
    ast.Mult,
    ast.Div,
    ast.Mod,
    ast.Pow,
    ast.FloorDiv,
    ast.USub,
    ast.UAdd,
    ast.Name,
    ast.Load,
)


def _safe_eval(expression: str) -> str:
    try:
        tree = ast.parse(expression.strip(), mode="eval")
    except SyntaxError as exc:
        return f"语法错误: {exc}"

    for node in ast.walk(tree):
        if not isinstance(node, _ALLOWED_NODE_TYPES):
            return f"不允许的操作: {type(node).__name__}"
        if isinstance(node, ast.Name) and node.id not in _SAFE_NAMES:
            return f"未知变量: {node.id}"

    try:
        result = eval(compile(tree, "<calc>", "eval"), {"__builtins__": {}}, _SAFE_NAMES)  # noqa: S307
        return str(result)
    except Exception as exc:
        return f"计算错误: {exc}"


def _strip_html(html: str) -> str:
    html = re.sub(r"<(script|style)[^>]*>.*?</\1>", "", html, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r"<[^>]+>", " ", html)
    text = re.sub(r"\s{2,}", "\n", text)
    return text.strip()


async def _fetch_url(url: str, max_chars: int = 3000) -> str:
    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; AI-Native-OS/1.0)",
        "Accept": "text/html,application/xhtml+xml,text/plain",
    }
    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
            response = await client.get(url, headers=headers)
            response.raise_for_status()
            content_type = response.headers.get("content-type", "")
            text = _strip_html(response.text) if "html" in content_type else response.text
            suffix = "…（内容已截断）" if len(text) > max_chars else ""
            return text[:max_chars] + suffix
    except httpx.HTTPStatusError as exc:
        return f"HTTP 错误 {exc.response.status_code}: {url}"
    except Exception as exc:
        return f"抓取失败: {exc}"



async def _python_exec(code: str) -> str:
    return await _python_exec_subprocess(code)


def _python_exec_temp_dir():
    candidates = [
        get_app_registry().user_config_dir / "runtime" / "python-exec",
        Path.cwd() / ".ainative-runtime" / "python-exec",
    ]
    for parent in candidates:
        try:
            parent.mkdir(parents=True, exist_ok=True)
            probe = parent / ".write-test"
            probe.write_text("", encoding="utf-8")
            probe.unlink(missing_ok=True)
            return tempfile.TemporaryDirectory(
                prefix="ainative-python-exec-",
                dir=str(parent),
                ignore_cleanup_errors=True,
            )
        except OSError:
            continue

    return tempfile.TemporaryDirectory(
        prefix="ainative-python-exec-",
        ignore_cleanup_errors=True,
    )


async def stream_python_exec(code: str):
    settings = get_settings()
    timeout_seconds = max(1, int(settings.python_exec_timeout_sec))
    mode = str(settings.python_exec_mode or "local").strip().lower()

    if mode != "local":
        yield {
            "type": "progress",
            "stream": "meta",
            "chunk": f"正在以 {mode} 模式执行 Python...\n",
        }
        result = await _python_exec_subprocess(code)
        yield {"type": "result", "result": result}
        return

    try:
        process = await asyncio.create_subprocess_exec(
            sys.executable,
            "-c",
            code,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=str(Path.cwd()),
            env={**os.environ, "PYTHONIOENCODING": "utf-8", "PYTHONUTF8": "1"},
        )
    except (NotImplementedError, PermissionError, OSError):
        yield {
            "type": "progress",
            "stream": "meta",
            "chunk": "当前环境不支持流式 Python 输出，已切换为一次性执行。\n",
        }
        result = await _python_exec_subprocess(code)
        yield {"type": "result", "result": result}
        return

    queue: asyncio.Queue[dict[str, str]] = asyncio.Queue()
    combined_chunks: list[str] = []

    async def pump(stream: asyncio.StreamReader | None, stream_name: str) -> None:
        if stream is None:
            await queue.put({"type": "stream_done", "stream": stream_name})
            return

        while True:
            line = await stream.readline()
            if not line:
                break
            text = line.decode("utf-8", errors="replace")
            await queue.put(
                {"type": "progress", "stream": stream_name, "chunk": text}
            )

        await queue.put({"type": "stream_done", "stream": stream_name})

    stdout_task = asyncio.create_task(pump(process.stdout, "stdout"))
    stderr_task = asyncio.create_task(pump(process.stderr, "stderr"))
    wait_task = asyncio.create_task(process.wait())

    stream_done = 0
    loop = asyncio.get_running_loop()
    started_at = loop.time()

    while True:
        remaining = timeout_seconds - (loop.time() - started_at)
        if remaining <= 0:
            process.kill()
            await process.wait()
            stdout_task.cancel()
            stderr_task.cancel()
            yield {"type": "result", "result": f"执行超时（超过 {timeout_seconds} 秒）"}
            return

        if wait_task.done() and stream_done >= 2 and queue.empty():
            break

        try:
            item = await asyncio.wait_for(queue.get(), timeout=min(0.2, remaining))
        except asyncio.TimeoutError:
            continue

        if item["type"] == "stream_done":
            stream_done += 1
            continue

        combined_chunks.append(item["chunk"])
        yield item

    await asyncio.gather(stdout_task, stderr_task, return_exceptions=True)
    return_code = await wait_task
    output = "".join(combined_chunks)
    if return_code != 0 and not output.strip():
        output = f"Python 执行失败，退出码 {return_code}"
    if not output.strip():
        output = "（代码执行完毕，无输出）"
    yield {"type": "result", "result": output[:3000]}


def _run_python_sync(code: str) -> str:
    import os
    import subprocess
    import sys
    import tempfile
    from pathlib import Path

    settings = get_settings()
    timeout_seconds = max(1, int(settings.python_exec_timeout_sec))

    mode = str(settings.python_exec_mode or "local").strip().lower()
    if mode == "docker":
        with _python_exec_temp_dir() as temp_dir:
            script_path = Path(temp_dir) / "script.py"
            script_path.write_text(code, encoding="utf-8")
            return _run_python_in_docker(script_path, temp_dir, timeout_seconds)
    if mode != "local":
        return f"不支持的 python_exec 模式：{mode}"

    try:
        result = subprocess.run(
            [sys.executable, "-c", code],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout_seconds,
            env={**os.environ, "PYTHONIOENCODING": "utf-8", "PYTHONUTF8": "1"},
            cwd=str(Path.cwd()),
        )
        output = result.stdout + (result.stderr if result.returncode != 0 else "")
        return output[:3000] if output.strip() else "（代码执行完毕，无输出）"
    except subprocess.TimeoutExpired:
        return f"执行超时（超过 {timeout_seconds} 秒）"
    except OSError as exc:
        return f"Python 执行失败: {type(exc).__name__}: {exc}"


def _run_python_in_docker(script_path, temp_dir: str, timeout_seconds: int) -> str:
    import subprocess

    settings = get_settings()
    docker_bin = shutil.which("docker")
    if docker_bin is None:
        return "Docker 模式不可用：当前环境未安装 docker 命令。"

    command = [
        docker_bin,
        "run",
        "--rm",
        "--network",
        "none",
        "--cpus",
        "1",
        "--memory",
        "256m",
        "--mount",
        f"type=bind,src={temp_dir},dst=/workspace",
        "--workdir",
        "/workspace",
        str(settings.python_exec_docker_image or "python:3.11-slim"),
        "python",
        f"/workspace/{script_path.name}",
    ]

    try:
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout_seconds + 3,
        )
        output = result.stdout + (result.stderr if result.returncode != 0 else "")
        if result.returncode != 0 and not output.strip():
            output = f"Docker python_exec 失败，退出码 {result.returncode}"
        return output[:3000] if output.strip() else "（代码执行完毕，无输出）"
    except subprocess.TimeoutExpired:
        return f"Docker 模式执行超时（超过 {timeout_seconds + 3} 秒）"


async def _python_exec_subprocess(code: str) -> str:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _run_python_sync, code)


def _slug_tool_segment(value: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9_]+", "_", value.strip().lower()).strip("_")
    return slug or "tool"


def _normalize_app_alias_segment(app_id: str) -> str:
    slug = _slug_tool_segment(app_id)
    if slug.endswith("_mcp"):
        slug = slug[: -len("_mcp")].rstrip("_")
    return slug or "tool"


def _dedupe_tool_segment(app_segment: str, tool_name: str) -> str:
    tool_segment = _slug_tool_segment(tool_name)
    app_tokens = [token for token in app_segment.split("_") if token]
    tool_tokens = [token for token in tool_segment.split("_") if token]

    overlap = 0
    for app_token, tool_token in zip(app_tokens, tool_tokens):
        if app_token != tool_token:
            break
        overlap += 1

    if overlap:
        deduped = "_".join(tool_tokens[overlap:])
        if deduped:
            return deduped

    return tool_segment


def _build_mcp_tool_alias(app_id: str, tool_name: str) -> str:
    digest = hashlib.sha1(f"{app_id}:{tool_name}".encode("utf-8")).hexdigest()[:8]
    app_segment = _normalize_app_alias_segment(app_id)
    tool_segment = _dedupe_tool_segment(app_segment, tool_name)
    base = f"mcp_{app_segment}_{tool_segment}"
    max_base_len = 64 - len(digest) - 1
    if len(base) > max_base_len:
        base = base[:max_base_len].rstrip("_")
    return f"{base}_{digest}"


def _ensure_object_schema(schema: Any) -> dict:
    if not isinstance(schema, dict):
        return {"type": "object", "properties": {}}
    if schema.get("type") != "object":
        return {"type": "object", "properties": {}}
    schema.setdefault("properties", {})
    return schema


def _format_mcp_tool_description(app_name: str, tool_name: str, description: str | None) -> str:
    summary = description.strip() if description else f"Call the `{tool_name}` MCP tool."
    return f"[MCP:{app_name}] {summary}"


def _extract_skill_match_terms(text: str) -> set[str]:
    terms: set[str] = set()
    for item in re.findall(r"https?://[^\s\"'`<>)]+", text):
        if len(item) >= 12:
            terms.add(item)
    for item in re.findall(r"\b[A-Z][A-Z0-9_]{5,}\b", text):
        terms.add(item)
    for item in re.findall(r"['\"]([^'\"]{6,120})['\"]", text):
        value = item.strip()
        if value and not value.isspace():
            terms.add(value)
    for item in re.findall(r"\b[a-zA-Z_][a-zA-Z0-9_]{5,}\b", text):
        terms.add(item)
    for item in re.findall(r"[\u4e00-\u9fff]{2,}", text):
        terms.add(item)
        for size in (2, 3, 4):
            if len(item) <= size:
                continue
            for index in range(0, len(item) - size + 1):
                terms.add(item[index : index + size])
    return terms



def _score_user_message_skill_match(message: str, skill: dict[str, Any]) -> int:
    message = str(message or "").strip()
    if not message:
        return 0

    score = 0
    message_lower = message.lower()
    identity_parts = [
        str(skill.get("id") or ""),
        str(skill.get("skill_key") or ""),
        str(skill.get("name") or ""),
    ]
    for value in identity_parts:
        normalized = value.strip().lower()
        if normalized and normalized in message_lower:
            score += 16

    skill_summary = "\n".join([
        str(skill.get("name") or ""),
        str(skill.get("skill_key") or ""),
        str(skill.get("description") or ""),
    ])
    message_terms = _extract_skill_match_terms(message)
    summary_terms = _extract_skill_match_terms(skill_summary)

    for term in message_terms & summary_terms:
        score += 8 if len(term) >= 3 else 5

    return score


def _is_user_skill_enabled(skill: dict[str, Any]) -> bool:
    return bool(skill.get("enabled", True))


def _matches_skill_id(skill: dict[str, Any], skill_ids: set[str]) -> bool:
    values = {
        str(skill.get("id") or "").strip().lower(),
        str(skill.get("skill_key") or "").strip().lower(),
        f"user-skill:{skill.get('id')}".strip().lower(),
        f"skill_{_slug_tool_segment(str(skill.get('id') or ''))}",
        f"skill_{_slug_tool_segment(str(skill.get('skill_key') or ''))}",
    }
    return any(value and value in skill_ids for value in values)


def _list_candidate_user_skills(user_message: str | None = None) -> list[dict[str, Any]]:
    registry = get_app_registry()
    skills = [
        skill
        for skill in registry.list_user_skills(enabled_only=True)
        if _is_user_skill_enabled(skill)
    ]
    if not user_message:
        return skills

    scored: list[tuple[int, dict[str, Any]]] = []
    for skill in skills:
        score = _score_user_message_skill_match(user_message, skill)
        if score >= 6:
            scored.append((score, skill))

    scored.sort(key=lambda item: (-item[0], str(item[1].get("name") or "").lower()))
    return [skill for _, skill in scored[:6]]


def _build_load_skill_context_schema(candidate_skills: list[dict[str, Any]]) -> dict | None:
    if not candidate_skills:
        return None

    enum_values = [str(skill["id"]) for skill in candidate_skills if skill.get("id")]
    if not enum_values:
        return None

    lines = []
    for skill in candidate_skills:
        skill_name = skill.get("name") or skill.get("id")
        skill_desc = str(skill.get("description") or "暂无描述").strip()
        lines.append(f"- {skill['id']}: {skill_name} — {skill_desc}")

    return {
        "type": "function",
        "function": {
            "name": LOAD_SKILL_CONTEXT_TOOL_NAME,
            "description": (
                "Load the full SKILL.md body for a relevant local user Skill. "
                "Call this before relying on a Skill's workflow or before using its executable script. "
                "Candidate Skills:\n" + "\n".join(lines)
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "skill_id": {
                        "type": "string",
                        "enum": enum_values,
                        "description": "The id of the Skill to load.",
                    },
                    "query": {
                        "type": "string",
                        "description": "The user task or question that made this Skill relevant.",
                    },
                },
                "required": ["skill_id"],
            },
        },
    }


def _load_user_skill_context(skill_id: str, query: str | None = None) -> str:
    registry = get_app_registry()
    normalized = str(skill_id or "").strip().lower()
    if not normalized:
        return "缺少 skill_id 参数。"

    skill: dict[str, Any] | None = None
    for item in registry.list_user_skills(enabled_only=True):
        if _matches_skill_id(item, {normalized}):
            skill = item
            break
    if skill is None:
        return f"未找到可用 Skill: {skill_id}"

    skill_path = Path(str(skill.get("path") or ""))
    skill_dir = skill_path.parent if skill_path.is_file() else skill_path
    resource_lines: list[str] = []
    if skill_dir.exists():
        for child in sorted(skill_dir.rglob("*")):
            if not child.is_file() or child == skill_path:
                continue
            try:
                rel_path = child.relative_to(skill_dir)
            except ValueError:
                rel_path = child
            if child.suffix.lower() in {".md", ".txt", ".json", ".py", ".js", ".ts", ".sh"}:
                resource_lines.append(f"- {rel_path}")

    return "\n".join([
        f"Skill 名称: {skill.get('name') or skill.get('id')}",
        f"Skill ID: {skill.get('id')}",
        f"Skill Key: {skill.get('skill_key') or skill.get('id')}",
        f"描述: {skill.get('description') or '暂无描述'}",
        f"入口: {skill.get('entrypoint') or skill_path.name}",
        f"本地路径: {skill.get('path')}（仅供用户查看；不是文件管理器虚拟路径）",
        "路径访问规则: 不要把上述本地路径传给 read_file/list_files；Skill 内容只能通过 load_skill_context 与已暴露的 Skill 工具使用。",
        f"用户任务: {query or ''}",
        "",
        "完整 SKILL.md:",
        str(skill.get("content") or "").strip() or "（SKILL.md 正文为空）",
        "",
        "Skill 目录中的相关资源清单（仅供判断；不要用文件工具直接读取这些路径）:",
        "\n".join(resource_lines[:40]) if resource_lines else "（无额外资源）",
    ])


def _skill_context_priority(skill_context: dict[str, Any] | None) -> dict[str, int]:
    priority: dict[str, int] = {}
    if not isinstance(skill_context, dict):
        return priority

    ordered: list[dict[str, Any]] = []
    # Support both legacy context format and new simplified format
    ordered.extend(skill_context.get("highlighted_skills") or [])
    ordered.extend(skill_context.get("skills") or [])
    ordered.extend(skill_context.get("user_skills") or [])
    for index, skill in enumerate(ordered):
        weight = max(1, 40 - index)
        for value in (
            skill.get("app_id"),
            skill.get("name"),
            str(skill.get("app_id") or "").replace("user-skill:", ""),
        ):
            key = str(value or "").strip().lower()
            if key:
                priority[key] = max(priority.get(key, 0), weight)
    return priority


async def _list_external_mcp_tool_routes() -> list[dict]:
    """List MCP tool routes with a short TTL cache to avoid repeated DB scans."""
    global _MCP_ROUTES_CACHE, _MCP_ROUTES_CACHE_EXPIRES

    now = time.monotonic()
    if _MCP_ROUTES_CACHE is not None and now < _MCP_ROUTES_CACHE_EXPIRES:
        return _MCP_ROUTES_CACHE

    registry = get_app_registry()
    routes: list[dict] = []

    async with AsyncSessionLocal() as db:
        apps = await registry.list_apps(db)
        for app in apps:
            if app.is_builtin or not app.enabled:
                continue

            transport = ((app.manifest or {}).get("mcp") or {}).get("transport", "builtin")
            if transport == "builtin":
                continue

            try:
                tool_defs = await registry.get_tools(db, app.id)
            except Exception as exc:
                print(f"[Agent MCP tools] skip app={app.id}: {exc}")
                continue

            for tool in tool_defs:
                tool_name = tool.get("name")
                if not tool_name:
                    continue
                routes.append(
                    {
                        "alias": _build_mcp_tool_alias(app.id, tool_name),
                        "app_id": app.id,
                        "app_name": app.name,
                        "tool_name": tool_name,
                        "description": tool.get("description", ""),
                        "input_schema": _ensure_object_schema(
                            tool.get("inputSchema") or tool.get("input_schema") or {"type": "object", "properties": {}}
                        ),
                    }
                )

    _MCP_ROUTES_CACHE = routes
    _MCP_ROUTES_CACHE_EXPIRES = time.monotonic() + _MCP_ROUTES_CACHE_TTL
    return routes


async def get_tool_display_name(name: str) -> str | None:
    if name == "delegate_task":
        return "多 Agent 委托"
    if name == LOAD_SKILL_CONTEXT_TOOL_NAME:
        return "加载 Skill 上下文"
    for route in await _list_external_mcp_tool_routes():
        if route["alias"] == name:
            return route["app_name"]
    # User-skill tools
    for tool_info in _list_user_skill_tools():
        if tool_info["tool_name"] == name:
            return f"{tool_info['skill_name']} Skill 调用"
    return None


def _format_tool_result(result: Any) -> str:
    if isinstance(result, str):
        return result
    return json.dumps(result, ensure_ascii=False, indent=2)


async def execute_tool(
    name: str,
    args: dict,
    loaded_skill_guides: set[str] | None = None,
) -> str:
    if name == LOAD_SKILL_CONTEXT_TOOL_NAME:
        return _load_user_skill_context(
            str(args.get("skill_id") or ""),
            str(args.get("query") or ""),
        )

    if name == "calculator":
        return _safe_eval(args.get("expression", ""))

    if name == "fetch_url":
        return await _fetch_url(args.get("url", ""), int(args.get("max_chars", 3000)))

    if name == "python_exec":
        return await _python_exec(args.get("code", ""))

    if name == "list_files":
        from app.core.file_manager import list_entries

        rows = await list_entries(None, str(args.get("path", "/")))
        if not rows:
            return "目录为空。"
        lines = [f"{'📁' if row.kind == 'dir' else '📄'} {row.path}" for row in rows]
        return "\n".join(lines)

    if name == "read_file":
        from app.core.file_manager import get_entry_by_path, read_entry_text

        entry = await get_entry_by_path(None, str(args.get("path", "")))
        if not entry or entry.kind != "file":
            return "文件不存在。"
        return await read_entry_text(entry)

    if name == "write_file":
        from app.core.file_manager import save_text_file

        entry = await save_text_file(
            None,
            str(args.get("path", "")),
            str(args.get("content", "")),
            mime_type="text/plain",
        )
        return f"已写入 {entry.path}（{entry.size} bytes）"

    if name == "retrieve_knowledge":
        from app.core.knowledge import get_knowledge_manager

        manager = get_knowledge_manager()
        if not manager:
            return "知识库未初始化，请先在设置中完成知识库初始化。"

        results = await manager.search(args.get("query", ""), limit=5)
        if not results:
            return "未在知识库中找到相关文档片段。"

        lines = []
        for index, result in enumerate(results, 1):
            lines.append(
                f"{index}. 【{result['title']}】（相关度 {result['score']:.2f}）\n{result['content']}"
            )
        return "\n\n".join(lines)

    if name.startswith("browser_"):
        return await dispatch_browser_tool(name, args)

    routes = await _list_external_mcp_tool_routes()
    route = next((item for item in routes if item["alias"] == name), None)
    if route is not None:
        registry = get_app_registry()
        async with AsyncSessionLocal() as db:
            result = await registry.call_tool(db, route["app_id"], route["tool_name"], args)
        return _format_tool_result(result)

    # ── User-skill dedicated tools ─────────────────────────────
    user_skill_result = await _execute_user_skill_tool(name, args, loaded_skill_guides=loaded_skill_guides)
    if user_skill_result is not None:
        return user_skill_result

    return f"未知工具: {name}"


# ── User skill → dedicated tool helpers ───────────────────────


def _build_user_skill_tool_name(skill_id: str) -> str:
    """Build a stable tool name from a user-skill id."""
    slug = re.sub(r"[^a-zA-Z0-9]+", "_", skill_id.strip()).strip("_").lower()
    return f"skill_{slug}"


def _find_skill_script(skill_dir: Path) -> Path | None:
    """Locate the main CLI script inside a skill directory."""
    scripts_dir = skill_dir / "scripts"
    if scripts_dir.is_dir():
        cli_py = scripts_dir / "cli.py"
        if cli_py.is_file():
            return cli_py
        for child in sorted(scripts_dir.iterdir()):
            if child.is_file() and child.suffix.lower() == ".py":
                return child
    root_cli = skill_dir / "cli.py"
    if root_cli.is_file():
        return root_cli
    return None



def _load_skill_md(skill_dir: Path) -> str:
    """Read SKILL.md body (front-matter stripped, capped at 2000 chars)."""
    skill_md_path = skill_dir / "SKILL.md"
    if not skill_md_path.is_file():
        return ""
    try:
        raw = skill_md_path.read_text(encoding="utf-8", errors="replace")
        if raw.startswith("---"):
            end = raw.find("---", 3)
            raw = raw[end + 3:].lstrip() if end > 0 else raw
        return raw[:2000]
    except OSError:
        return ""


def _has_executable_script(skill: dict) -> bool:
    """Return True if the skill directory contains an executable script."""
    try:
        skill_path = Path(str(skill.get("path") or ""))
        skill_dir = skill_path.parent if skill_path.is_file() else skill_path
        return _find_skill_script(skill_dir) is not None
    except (OSError, ValueError):
        return False


def _list_user_skill_tools(user_message: str | None = None) -> list[dict]:
    """Build tool schemas for user skills that own executable scripts.

    Script-backed skills are exposed directly (no regex scope gating).
    The execution path may still return a compact SKILL.md guide on first use
    before running the script, so the model can format the query correctly.
    If user_message is provided, skills with a very low relevance score are
    deprioritised but still included unless there are too many (>8).
    """
    registry = get_app_registry()
    all_tools: list[dict] = []
    for skill in registry.list_user_skills(enabled_only=True):
        skill_path = Path(str(skill.get("path") or ""))
        skill_dir = skill_path.parent if skill_path.is_file() else skill_path

        script = _find_skill_script(skill_dir)
        if script is None:
            continue  # knowledge-only skill – not a direct tool

        skill_name = skill.get("name") or skill["id"]
        description = str(skill.get("description") or "").strip()
        tool_name = _build_user_skill_tool_name(skill["id"])

        score = _score_user_message_skill_match(user_message or "", skill) if user_message else 0

        all_tools.append({
            "tool_name": tool_name,
            "skill_id": skill["id"],
            "skill_name": skill_name,
            "script_path": str(script),
            "skill_dir": str(skill_dir),
            "description": description,
            "relevance_score": score,
            "schema": {
                "type": "function",
                "function": {
                    "name": tool_name,
                    "description": f"[Skill: {skill_name}] {description}",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "query": {
                                "type": "string",
                                "description": "用户的查询内容或任务描述",
                            },
                        },
                        "required": ["query"],
                    },
                },
            },
        })

    # Sort by relevance score descending, cap at 8 to avoid context overflow
    all_tools.sort(key=lambda t: -t["relevance_score"])
    return all_tools[:8]


def _run_skill_script_sync(script_path: str, query: str) -> str:
    """Run a skill script directly via subprocess (no python_exec wrapper)."""
    try:
        result = subprocess.run(
            [sys.executable, script_path, "--query", query],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=60,
            env={**os.environ, "PYTHONIOENCODING": "utf-8", "PYTHONUTF8": "1"},
        )
        output = (result.stdout + (result.stderr if result.returncode != 0 else "")).strip()
        return output[:4000] if output else "（执行完毕，无输出）"
    except subprocess.TimeoutExpired:
        return "执行超时（超过 60 秒）"
    except OSError as exc:
        return f"Skill 执行失败: {type(exc).__name__}: {exc}"


async def _run_skill_script(script_path: str, query: str) -> str:
    """Run a skill script in the thread pool executor."""
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _run_skill_script_sync, script_path, query)


async def _execute_user_skill_tool(
    name: str,
    args: dict,
    loaded_skill_guides: set[str] | None = None,
) -> str | None:
    """If *name* matches a user-skill tool, run its script and return output.

    Two-stage loading: on the first call for a given skill (not in
    *loaded_skill_guides*), returns the SKILL.md instructions and asks the LLM
    to re-call with a correctly-formatted query.  On the second call the script
    is executed normally.
    """
    for tool_info in _list_user_skill_tools():
        if tool_info["tool_name"] != name:
            continue

        skill_id = tool_info["skill_id"]
        skill_dir = Path(tool_info["skill_dir"])

        # Stage 1: return SKILL.md guide if not yet loaded this session
        if loaded_skill_guides is not None and skill_id not in loaded_skill_guides:
            guide = _load_skill_md(skill_dir)
            if guide:
                loaded_skill_guides.add(skill_id)
                return (
                    f"[Skill 使用说明 — 请仔细阅读后按要求改写 query，然后重新调用此工具]\n\n{guide}"
                )

        # Stage 2: execute the script
        query = str(args.get("query", ""))
        if not query:
            return "缺少 query 参数"
        return await _run_skill_script(tool_info["script_path"], query)
    return None  # not a user-skill tool


async def get_tools_for_model(
    model: str,
    user_message: str | None = None,
    skill_context: dict | None = None,
) -> list[dict]:
    """Return all tools applicable for this model and context.

    Design principles (from smolagents / LangGraph ReAct patterns):
    - No regex scope-based gating. Tool descriptions guide the LLM.
    - Script-backed user skills are direct tools; first use may hydrate guidance.
    - Browser tools are included only when the active app is the browser.
    - Knowledge-only skills still use load_skill_context.
    - MCP tools are cached to avoid repeated DB scans.
    """
    unsupported_prefixes = ("deepseek-r1", "o1-mini", "o1-preview")
    if any(model.lower().startswith(p) for p in unsupported_prefixes):
        return []

    entry_app_id = str((skill_context or {}).get("entry_app_id") or "").lower()
    tools: list[dict] = []

    # ── Core builtin tools (always available) ─────────────────
    for schema in BUILTIN_TOOL_SCHEMAS:
        name = _tool_schema_name(schema)
        if is_browser_tool(name):
            # Browser tools only for browser app
            if entry_app_id == "browser":
                tools.append(schema)
        else:
            tools.append(schema)

    # ── Knowledge base ─────────────────────────────────────────
    from app.core.knowledge import get_knowledge_manager
    if get_knowledge_manager() is not None:
        tools.append(RETRIEVE_KNOWLEDGE_SCHEMA)

    # ── MCP tools (cached) ─────────────────────────────────────
    for route in await _list_external_mcp_tool_routes():
        tools.append(
            {
                "type": "function",
                "function": {
                    "name": route["alias"],
                    "description": _format_mcp_tool_description(
                        route["app_name"],
                        route["tool_name"],
                        route["description"],
                    ),
                    "parameters": route["input_schema"],
                },
            }
        )

    # ── User skill tools ───────────────────────────────────────
    # Script-backed skills: direct tools; first call may return guide text.
    for tool_info in _list_user_skill_tools(user_message=user_message):
        tools.append(tool_info["schema"])

    # Knowledge-only skills: load_skill_context for optional hydration
    registry = get_app_registry()
    knowledge_only = [
        s for s in registry.list_user_skills(enabled_only=True)
        if not _has_executable_script(s)
    ]
    candidate_knowledge = []
    for skill in knowledge_only:
        score = _score_user_message_skill_match(user_message or "", skill)
        if score >= 4 or not user_message:
            candidate_knowledge.append(skill)
    if candidate_knowledge:
        load_schema = _build_load_skill_context_schema(candidate_knowledge[:6])
        if load_schema:
            tools.append(load_schema)

    ctx = skill_context or {}
    agent_depth: int = int(ctx.get("agent_depth", 0))
    agent_mode = str(ctx.get("agent_mode") or "auto").lower()
    # Only the top-level agent (depth 0) may spawn sub-agents
    if agent_depth == 0 and agent_mode != "single":
        tools.append(DELEGATE_TASK_SCHEMA)

    # Specialist agents receive a role-scoped tool surface. The top-level Lead
    # Agent stays broad; sub-agents trade breadth for precision and safety.
    role_id = ctx.get("agent_role")
    if role_id:
        from app.core.agent_types import filter_tools_for_role, get_agent_role

        tools = filter_tools_for_role(tools, get_agent_role(str(role_id)))

    # Honor per-subagent tool allowlist
    allowed_tools: list[str] | None = ctx.get("allowed_tools") or None
    if allowed_tools:
        allowed_set = set(allowed_tools)
        tools = [t for t in tools if _tool_schema_name(t) in allowed_set]

    return tools
