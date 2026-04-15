"""Built-in tool definitions and MCP bridging for the agent loop."""

from __future__ import annotations

import ast
import asyncio
import hashlib
import json
import math
import re
from typing import Any

import httpx

from app.core.app_registry import get_app_registry
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


def _run_python_sync(code: str) -> str:
    import os
    import subprocess
    import sys
    import tempfile

    with tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False, encoding="utf-8") as handle:
        handle.write(code)
        temp_path = handle.name

    try:
        result = subprocess.run(
            [sys.executable, temp_path],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=5,
            env={**os.environ, "PYTHONIOENCODING": "utf-8", "PYTHONUTF8": "1"},
        )
        output = result.stdout + (result.stderr if result.returncode != 0 else "")
        return output[:3000] if output.strip() else "锛堜唬鐮佹墽琛屽畬姣曪紝鏃犺緭鍑猴級"
    except subprocess.TimeoutExpired:
        return "鎵ц瓒呮椂锛堣秴杩?5 绉掞級"
    finally:
        os.unlink(temp_path)


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
        lines = [f"{'馃搧' if row.kind == 'dir' else '馃搫'} {row.path}" for row in rows]
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

    routes = await _list_external_mcp_tool_routes()
    route = next((item for item in routes if item["alias"] == name), None)
    if route is not None:
        registry = get_app_registry()
        async with AsyncSessionLocal() as db:
            result = await registry.call_tool(db, route["app_id"], route["tool_name"], args)
        return _format_tool_result(result)

    return f"鏈煡宸ュ叿: {name}"


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

    return tools

