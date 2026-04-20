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
import sys
import tempfile
from typing import Any

import httpx

from app.config import get_settings
from app.core.app_registry import get_app_registry
from app.core.browser_tools import BROWSER_TOOL_SCHEMAS, dispatch_browser_tool
from app.core.database import AsyncSessionLocal

BUILTIN_TOOL_SCHEMAS: list[dict] = [
    {
        "type": "function",
        "function": {
            "name": "calculator",
            "description": "Calculate a math expression safely.",
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
            "description": "Fetch a URL and return plain text content.",
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
            "description": "List files and directories in the virtual file system.",
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
            "description": "Read a text file from the virtual file system.",
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
            "description": "Execute Python code in a sandboxed subprocess.",
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
        return f"璇硶閿欒: {exc}"

    for node in ast.walk(tree):
        if not isinstance(node, _ALLOWED_NODE_TYPES):
            return f"涓嶅厑璁哥殑鎿嶄綔: {type(node).__name__}"
        if isinstance(node, ast.Name) and node.id not in _SAFE_NAMES:
            return f"鏈煡鍙橀噺: {node.id}"

    try:
        result = eval(compile(tree, "<calc>", "eval"), {"__builtins__": {}}, _SAFE_NAMES)  # noqa: S307
        return str(result)
    except Exception as exc:
        return f"璁＄畻閿欒: {exc}"


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
            suffix = "鈥︼紙鍐呭宸叉埅鏂級" if len(text) > max_chars else ""
            return text[:max_chars] + suffix
    except httpx.HTTPStatusError as exc:
        return f"HTTP 閿欒 {exc.response.status_code}: {url}"
    except Exception as exc:
        return f"鎶撳彇澶辫触: {exc}"



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
        return output[:3000] if output.strip() else "锛堜唬鐮佹墽琛屽畬姣曪紝鏃犺緭鍑猴級"
    except subprocess.TimeoutExpired:
        return f"鎵ц瓒呮椂锛堣秴杩?{timeout_seconds} 绉掞級"
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
        return output[:3000] if output.strip() else "锛堜唬鐮佹墽琛屽畬姣曪紝鏃犺緭鍑猴級"
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


def _read_skill_match_corpus(skill: dict[str, Any]) -> str:
    chunks = [
        str(skill.get("raw_content") or ""),
        str(skill.get("content") or ""),
        str(skill.get("description") or ""),
    ]
    skill_path = Path(str(skill.get("path") or ""))
    skill_dir = skill_path.parent
    if skill_dir.exists():
        for child in skill_dir.rglob("*"):
            if not child.is_file() or child == skill_path:
                continue
            if child.suffix.lower() not in {".md", ".py", ".json", ".txt"}:
                continue
            try:
                chunks.append(child.read_text(encoding="utf-8", errors="ignore"))
            except OSError:
                continue
    return "\n".join(chunk for chunk in chunks if chunk)


def _score_python_code_skill_match(code: str, corpus: str) -> int:
    score = 0
    for line in code.splitlines():
        stripped = line.strip()
        if len(stripped) >= 24 and stripped in corpus:
            score += 4

    code_terms = _extract_skill_match_terms(code)
    corpus_terms = _extract_skill_match_terms(corpus)
    for term in code_terms & corpus_terms:
        if term.startswith("http://") or term.startswith("https://"):
            score += 12
        elif re.fullmatch(r"[A-Z][A-Z0-9_]{5,}", term):
            score += 8
        elif re.fullmatch(r"[\u4e00-\u9fff]{2,}", term):
            score += min(8, max(3, len(term)))
        elif len(term) >= 12:
            score += 5
        else:
            score += 1
    return score


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


def get_python_exec_display_name(code: str, skill_context: dict[str, Any] | None = None) -> str | None:
    code = str(code or "")
    if not code.strip():
        return None

    registry = get_app_registry()
    priority = _skill_context_priority(skill_context)
    best_skill: dict[str, Any] | None = None
    best_score = 0
    for skill in registry.list_user_skills(enabled_only=True):
        corpus = _read_skill_match_corpus(skill)
        score = _score_python_code_skill_match(code, corpus)
        score += priority.get(f"user-skill:{skill.get('id')}".lower(), 0)
        score += priority.get(str(skill.get("id") or "").lower(), 0)
        score += priority.get(str(skill.get("skill_key") or "").lower(), 0)
        score += priority.get(str(skill.get("name") or "").lower(), 0)
        if score > best_score:
            best_score = score
            best_skill = skill

    if best_skill is None or best_score < 12:
        return None

    skill_name = str(best_skill.get("name") or best_skill.get("skill_key") or best_skill.get("id") or "Skill")
    return f"{skill_name} Skill 调用"


async def _list_external_mcp_tool_routes() -> list[dict]:
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

    return routes


async def get_tool_display_name(name: str) -> str | None:
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
) -> str:
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
    user_skill_result = await _execute_user_skill_tool(name, args)
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


def _list_user_skill_tools() -> list[dict]:
    """Build tool schemas for user skills that own executable scripts."""
    registry = get_app_registry()
    tools: list[dict] = []
    for skill in registry.list_user_skills(enabled_only=True):
        skill_path = Path(str(skill.get("path") or ""))
        skill_dir = skill_path.parent if skill_path.is_file() else skill_path

        script = _find_skill_script(skill_dir)
        if script is None:
            continue  # knowledge-only skill – not a tool

        skill_name = skill.get("name") or skill["id"]
        description = str(skill.get("description") or "").strip()
        tool_name = _build_user_skill_tool_name(skill["id"])

        tools.append({
            "tool_name": tool_name,
            "skill_id": skill["id"],
            "skill_name": skill_name,
            "script_path": str(script),
            "description": description,
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
                                "description": "用户的查询内容",
                            },
                        },
                        "required": ["query"],
                    },
                },
            },
        })
    return tools


async def _execute_user_skill_tool(name: str, args: dict) -> str | None:
    """If *name* matches a user-skill tool, run it and return the output."""
    for tool_info in _list_user_skill_tools():
        if tool_info["tool_name"] != name:
            continue

        script_path = tool_info["script_path"]
        query = str(args.get("query", ""))
        if not query:
            return "缺少 query 参数"

        code = (
            "import subprocess, sys, os\n"
            f"result = subprocess.run(\n"
            f"    [sys.executable, {script_path!r}, '--query', {query!r}],\n"
            f"    capture_output=True, text=True, timeout=60,\n"
            f"    env={{**os.environ, 'PYTHONIOENCODING': 'utf-8', 'PYTHONUTF8': '1'}},\n"
            f")\n"
            f"output = result.stdout + (result.stderr if result.returncode != 0 else '')\n"
            f"print(output[:4000] if output.strip() else '（执行完毕，无输出）')\n"
        )
        return await _python_exec(code)

    return None  # not a user-skill tool


async def get_tools_for_model(model: str) -> list[dict]:
    unsupported_prefixes = ("deepseek-r1", "o1-mini", "o1-preview")
    model_lower = model.lower()
    if any(model_lower.startswith(prefix) for prefix in unsupported_prefixes):
        return []

    tools = list(BUILTIN_TOOL_SCHEMAS)

    from app.core.knowledge import get_knowledge_manager

    if get_knowledge_manager() is not None:
        tools.append(RETRIEVE_KNOWLEDGE_SCHEMA)

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

    # ── Register user-skill dedicated tools ────────────────────
    for tool_info in _list_user_skill_tools():
        tools.append(tool_info["schema"])

    return tools

