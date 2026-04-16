from __future__ import annotations

from app.core.browser_session import BrowserSessionError, get_browser_session_manager


BROWSER_TOOL_SCHEMAS: list[dict] = [
    {
        "type": "function",
        "function": {
            "name": "browser_create_session",
            "description": "Create a real browser session hosted by the backend.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "browser_open",
            "description": "Open a URL inside a real browser session.",
            "parameters": {
                "type": "object",
                "properties": {
                    "session_id": {"type": "string"},
                    "url": {"type": "string"},
                },
                "required": ["session_id", "url"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "browser_click",
            "description": "Click an element in the current browser tab. Supports CSS selectors and text=... locators.",
            "parameters": {
                "type": "object",
                "properties": {
                    "session_id": {"type": "string"},
                    "selector": {"type": "string"},
                },
                "required": ["session_id", "selector"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "browser_type",
            "description": "Fill text into an element in the current browser tab.",
            "parameters": {
                "type": "object",
                "properties": {
                    "session_id": {"type": "string"},
                    "selector": {"type": "string"},
                    "text": {"type": "string"},
                    "press_enter": {"type": "boolean", "default": False},
                },
                "required": ["session_id", "selector", "text"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "browser_press",
            "description": "Press a keyboard key in the current browser tab.",
            "parameters": {
                "type": "object",
                "properties": {
                    "session_id": {"type": "string"},
                    "key": {"type": "string"},
                },
                "required": ["session_id", "key"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "browser_wait_for",
            "description": "Wait for the page or an element to be ready.",
            "parameters": {
                "type": "object",
                "properties": {
                    "session_id": {"type": "string"},
                    "selector": {"type": "string"},
                    "timeout_ms": {"type": "integer", "default": 10000},
                },
                "required": ["session_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "browser_extract_text",
            "description": "Extract readable text from the current browser tab.",
            "parameters": {
                "type": "object",
                "properties": {
                    "session_id": {"type": "string"},
                    "selector": {"type": "string"},
                    "max_chars": {"type": "integer", "default": 12000},
                },
                "required": ["session_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "browser_get_state",
            "description": "Inspect the current browser tab state including title, headings, inputs and tabs.",
            "parameters": {
                "type": "object",
                "properties": {
                    "session_id": {"type": "string"},
                },
                "required": ["session_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "browser_close_session",
            "description": "Close a real browser session and all of its tabs.",
            "parameters": {
                "type": "object",
                "properties": {
                    "session_id": {"type": "string"},
                },
                "required": ["session_id"],
            },
        },
    },
]


async def dispatch_browser_tool(name: str, args: dict) -> str:
    manager = get_browser_session_manager()
    try:
        if name == "browser_create_session":
            session = await manager.create_session()
            return f"已创建浏览器会话：{session['id']}"
        if name == "browser_open":
            detail = await manager.navigate(str(args.get("session_id", "")), str(args.get("url", "")))
            return f"已打开网页：{detail['current_title']} ({detail['current_url']})"
        if name == "browser_click":
            return await manager.click(str(args.get("session_id", "")), str(args.get("selector", "")))
        if name == "browser_type":
            return await manager.type(
                str(args.get("session_id", "")),
                str(args.get("selector", "")),
                str(args.get("text", "")),
                bool(args.get("press_enter", False)),
            )
        if name == "browser_press":
            return await manager.press(str(args.get("session_id", "")), str(args.get("key", "")))
        if name == "browser_wait_for":
            return await manager.wait_for(
                str(args.get("session_id", "")),
                str(args.get("selector")) if args.get("selector") else None,
                int(args.get("timeout_ms", 10000)),
            )
        if name == "browser_extract_text":
            data = await manager.extract_text(
                str(args.get("session_id", "")),
                str(args.get("selector")) if args.get("selector") else None,
                int(args.get("max_chars", 12000)),
            )
            return data["content"]
        if name == "browser_get_state":
            return await manager.get_state(str(args.get("session_id", "")))
        if name == "browser_close_session":
            await manager.close_session(str(args.get("session_id", "")))
            return "浏览器会话已关闭。"
    except BrowserSessionError as exc:
        return str(exc)

    return f"未知浏览器工具: {name}"
