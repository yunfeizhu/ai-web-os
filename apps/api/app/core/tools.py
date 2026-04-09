"""内置工具定义与执行"""
from __future__ import annotations

import ast
import asyncio
import json
import math
import operator
import re
from typing import Any

import httpx

# ── Tool Schemas (OpenAI function-calling format) ─────────────────────────────

TOOL_SCHEMAS: list[dict] = [
    {
        "type": "function",
        "function": {
            "name": "calculator",
            "description": "计算数学表达式。支持加减乘除、幂运算、括号、常用数学函数（sin/cos/sqrt/log等）。",
            "parameters": {
                "type": "object",
                "properties": {
                    "expression": {
                        "type": "string",
                        "description": "数学表达式，例如：'2 + 3 * 4'、'sqrt(16)'、'sin(pi/2)'",
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
            "description": "抓取指定 URL 的网页内容，返回纯文本（去除 HTML 标签）。适合读取文章、文档、API 响应等。",
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "要抓取的网页 URL",
                    },
                    "max_chars": {
                        "type": "integer",
                        "description": "返回的最大字符数，默认 3000",
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
            "name": "web_search",
            "description": "使用 Tavily 搜索引擎搜索最新信息。适合查找新闻、事实、最新数据等。需要配置 Tavily API Key。",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "搜索关键词或问题",
                    },
                    "max_results": {
                        "type": "integer",
                        "description": "返回结果数量，默认 5",
                        "default": 5,
                    },
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "python_exec",
            "description": "在安全沙箱中执行 Python 代码并返回输出结果。仅限 Python 语言，不支持 JavaScript/TypeScript/Shell 等其他语言。仅在用户明确要求「运行」「执行」「跑一下」Python 代码时才调用，纯粹写代码不需要调用此工具。",
            "parameters": {
                "type": "object",
                "properties": {
                    "code": {
                        "type": "string",
                        "description": "要执行的 Python 代码",
                    }
                },
                "required": ["code"],
            },
        },
    },
]


# ── Safe Calculator ───────────────────────────────────────────────────────────

_SAFE_NAMES: dict[str, Any] = {
    "abs": abs, "round": round, "min": min, "max": max,
    "sum": sum, "pow": pow, "int": int, "float": float,
    **{k: getattr(math, k) for k in dir(math) if not k.startswith("_")},
}

_ALLOWED_NODE_TYPES = (
    ast.Expression, ast.BinOp, ast.UnaryOp, ast.Call, ast.Constant,
    ast.Add, ast.Sub, ast.Mult, ast.Div, ast.Mod, ast.Pow, ast.FloorDiv,
    ast.USub, ast.UAdd,
    ast.Name, ast.Load,
)


def _safe_eval(expression: str) -> str:
    try:
        tree = ast.parse(expression.strip(), mode="eval")
    except SyntaxError as e:
        return f"语法错误: {e}"

    for node in ast.walk(tree):
        if not isinstance(node, _ALLOWED_NODE_TYPES):
            return f"不允许的操作: {type(node).__name__}"
        if isinstance(node, ast.Name) and node.id not in _SAFE_NAMES:
            return f"未知变量: {node.id}"

    try:
        result = eval(compile(tree, "<calc>", "eval"), {"__builtins__": {}}, _SAFE_NAMES)  # noqa: S307
        return str(result)
    except Exception as e:
        return f"计算错误: {e}"


# ── Fetch URL ─────────────────────────────────────────────────────────────────

def _strip_html(html: str) -> str:
    # 移除 script/style 块
    html = re.sub(r"<(script|style)[^>]*>.*?</\1>", "", html, flags=re.DOTALL | re.IGNORECASE)
    # 移除所有标签
    text = re.sub(r"<[^>]+>", " ", html)
    # 合并空白
    text = re.sub(r"\s{2,}", "\n", text)
    return text.strip()


async def _fetch_url(url: str, max_chars: int = 3000) -> str:
    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; AI-Native-OS/1.0)",
        "Accept": "text/html,application/xhtml+xml,text/plain",
    }
    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
            resp = await client.get(url, headers=headers)
            resp.raise_for_status()
            content_type = resp.headers.get("content-type", "")
            if "html" in content_type:
                text = _strip_html(resp.text)
            else:
                text = resp.text
            return text[:max_chars] + ("…（内容已截断）" if len(text) > max_chars else "")
    except httpx.HTTPStatusError as e:
        return f"HTTP 错误 {e.response.status_code}: {url}"
    except Exception as e:
        return f"抓取失败: {e}"


# ── Web Search (Tavily) ───────────────────────────────────────────────────────

async def _web_search(query: str, max_results: int = 5, tavily_key: str | None = None) -> str:
    if not tavily_key:
        return "未配置 Tavily API Key，请在设置 → API Keys 中添加 Tavily Key。"
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.post(
                "https://api.tavily.com/search",
                json={
                    "api_key": tavily_key,
                    "query": query,
                    "max_results": max_results,
                    "search_depth": "basic",
                    "include_answer": True,
                },
            )
            resp.raise_for_status()
            data = resp.json()

        lines: list[str] = []
        if data.get("answer"):
            lines.append(f"摘要：{data['answer']}\n")

        for i, r in enumerate(data.get("results", []), 1):
            lines.append(f"{i}. [{r.get('title', '无标题')}]({r.get('url', '')})")
            if r.get("content"):
                lines.append(f"   {r['content'][:200]}…")

        return "\n".join(lines) if lines else "未找到相关结果。"
    except Exception as e:
        return f"搜索失败: {e}"


# ── Python Exec (RestrictedPython sandbox) ───────────────────────────────────

async def _python_exec(code: str) -> str:
    """在隔离子进程中执行 Python 代码，捕获 stdout/stderr，5 秒超时。"""
    return await _python_exec_subprocess(code)


def _run_python_sync(code: str) -> str:
    """同步执行 Python 代码（在线程池中调用，避免 Windows asyncio subprocess 限制）。"""
    import sys
    import subprocess
    import tempfile
    import os

    with tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False, encoding="utf-8") as f:
        f.write(code)
        tmp_path = f.name

    try:
        result = subprocess.run(
            [sys.executable, tmp_path],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=5,
            env={**os.environ, "PYTHONIOENCODING": "utf-8", "PYTHONUTF8": "1"},
        )
        output = result.stdout + (result.stderr if result.returncode != 0 else "")
        return output[:3000] if output.strip() else "（代码执行完毕，无输出）"
    except subprocess.TimeoutExpired:
        return "执行超时（超过 5 秒）"
    finally:
        os.unlink(tmp_path)


async def _python_exec_subprocess(code: str) -> str:
    """在线程池中运行同步 subprocess，兼容 Windows asyncio。"""
    import asyncio
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _run_python_sync, code)


# ── Dispatcher ───────────────────────────────────────────────────────────────

async def execute_tool(
    name: str,
    args: dict,
    tavily_key: str | None = None,
) -> str:
    """根据工具名分发执行，返回字符串结果。"""
    if name == "calculator":
        return _safe_eval(args.get("expression", ""))

    if name == "fetch_url":
        return await _fetch_url(args.get("url", ""), int(args.get("max_chars", 3000)))

    if name == "web_search":
        return await _web_search(
            args.get("query", ""),
            int(args.get("max_results", 5)),
            tavily_key,
        )

    if name == "python_exec":
        return await _python_exec(args.get("code", ""))

    if name == "retrieve_knowledge":
        from app.core.knowledge import get_knowledge_manager
        mgr = get_knowledge_manager()
        if not mgr:
            return "知识库未初始化，请先在设置 → 知识库中初始化。"
        results = await mgr.search(args.get("query", ""), limit=5)
        if not results:
            return "未在知识库中找到相关文档片段。"
        lines = []
        for i, r in enumerate(results, 1):
            lines.append(f"{i}. 【{r['title']}】（相关度: {r['score']:.2f}）\n{r['content']}")
        return "\n\n".join(lines)

    return f"未知工具: {name}"


RETRIEVE_KNOWLEDGE_SCHEMA: dict = {
    "type": "function",
    "function": {
        "name": "retrieve_knowledge",
        "description": (
            "从用户的本地知识库中检索相关文档片段。"
            "当用户询问可能在其上传的文档、笔记或资料中有答案的问题时调用此工具。"
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "检索查询文本",
                }
            },
            "required": ["query"],
        },
    },
}


def get_tools_for_model(model: str) -> list[dict]:
    """根据模型返回支持工具调用的 schema 列表。

    部分模型（如某些开源模型）不支持工具调用，返回空列表。
    retrieve_knowledge 仅在知识库已初始化时才加入，避免 LLM 调用无数据的工具。
    """
    unsupported_prefixes = ("deepseek-r1", "o1-mini", "o1-preview")
    model_lower = model.lower()
    if any(model_lower.startswith(p) for p in unsupported_prefixes):
        return []

    tools = list(TOOL_SCHEMAS)

    from app.core.knowledge import get_knowledge_manager
    if get_knowledge_manager() is not None:
        tools.append(RETRIEVE_KNOWLEDGE_SCHEMA)

    return tools
