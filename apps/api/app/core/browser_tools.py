from __future__ import annotations

import json
from typing import Any

from app.core.browser_session import BrowserSessionError, get_browser_session_manager


def _tool(
    name: str,
    description: str,
    properties: dict[str, Any],
    required: list[str] | None = None,
) -> dict[str, Any]:
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": {
                "type": "object",
                "properties": properties,
                **({"required": required} if required else {}),
            },
        },
    }


BROWSER_TOOL_SCHEMAS: list[dict[str, Any]] = [
    _tool(
        "browser_create_session",
        "Create a real browser session hosted by the backend.",
        {},
    ),
    _tool(
        "browser_open",
        "Open a URL inside the active tab of a real browser session.",
        {
            "session_id": {"type": "string"},
            "url": {"type": "string"},
        },
        ["session_id", "url"],
    ),
    _tool(
        "browser_reload",
        "Reload the current browser tab.",
        {"session_id": {"type": "string"}},
        ["session_id"],
    ),
    _tool(
        "browser_back",
        "Navigate back in the current browser tab.",
        {"session_id": {"type": "string"}},
        ["session_id"],
    ),
    _tool(
        "browser_forward",
        "Navigate forward in the current browser tab.",
        {"session_id": {"type": "string"}},
        ["session_id"],
    ),
    _tool(
        "browser_new_tab",
        "Create a new browser tab in the current session.",
        {"session_id": {"type": "string"}},
        ["session_id"],
    ),
    _tool(
        "browser_switch_tab",
        "Switch the active browser tab.",
        {
            "session_id": {"type": "string"},
            "tab_id": {"type": "string"},
        },
        ["session_id", "tab_id"],
    ),
    _tool(
        "browser_close_tab",
        "Close a browser tab by id.",
        {
            "session_id": {"type": "string"},
            "tab_id": {"type": "string"},
        },
        ["session_id", "tab_id"],
    ),
    _tool(
        "browser_click",
        "Click an element in the current browser tab. Supports CSS selectors and text=... locators.",
        {
            "session_id": {"type": "string"},
            "selector": {"type": "string"},
        },
        ["session_id", "selector"],
    ),
    _tool(
        "browser_click_at",
        "Click specific screen coordinates in the current browser tab.",
        {
            "session_id": {"type": "string"},
            "x": {"type": "number"},
            "y": {"type": "number"},
            "button": {"type": "string", "default": "left"},
        },
        ["session_id", "x", "y"],
    ),
    _tool(
        "browser_type",
        "Fill text into an element in the current browser tab.",
        {
            "session_id": {"type": "string"},
            "selector": {"type": "string"},
            "text": {"type": "string"},
            "press_enter": {"type": "boolean", "default": False},
        },
        ["session_id", "selector", "text"],
    ),
    _tool(
        "browser_type_text",
        "Type text into the currently focused element.",
        {
            "session_id": {"type": "string"},
            "text": {"type": "string"},
        },
        ["session_id", "text"],
    ),
    _tool(
        "browser_press",
        "Press a keyboard key in the current browser tab.",
        {
            "session_id": {"type": "string"},
            "key": {"type": "string"},
        },
        ["session_id", "key"],
    ),
    _tool(
        "browser_wheel",
        "Scroll the current browser page by wheel deltas.",
        {
            "session_id": {"type": "string"},
            "delta_x": {"type": "number", "default": 0},
            "delta_y": {"type": "number", "default": 800},
        },
        ["session_id"],
    ),
    _tool(
        "browser_wait_for",
        "Wait for the page or an element to be ready.",
        {
            "session_id": {"type": "string"},
            "selector": {"type": "string"},
            "timeout_ms": {"type": "integer", "default": 10000},
        },
        ["session_id"],
    ),
    _tool(
        "browser_extract_text",
        "Extract readable text from the current browser tab.",
        {
            "session_id": {"type": "string"},
            "selector": {"type": "string"},
            "max_chars": {"type": "integer", "default": 12000},
        },
        ["session_id"],
    ),
    _tool(
        "browser_get_state",
        "Inspect the current browser tab state including title, headings, inputs and tabs.",
        {"session_id": {"type": "string"}},
        ["session_id"],
    ),
    _tool(
        "browser_focus",
        "Bring the current browser tab to the front.",
        {"session_id": {"type": "string"}},
        ["session_id"],
    ),
    _tool(
        "browser_import_cookies",
        "Import cookies into the current browser session using either a Cookie header string or full cookie JSON.",
        {
            "session_id": {"type": "string"},
            "site_url": {"type": "string"},
            "cookie_header": {"type": "string"},
            "cookie_json": {
                "type": ["object", "array"],
                "description": "Browser-exported cookie JSON.",
            },
        },
        ["session_id", "site_url"],
    ),
    _tool(
        "browser_import_storage_state",
        "Import a Playwright storage state object or a cookie array into the current session.",
        {
            "session_id": {"type": "string"},
            "state": {"type": ["object", "array"]},
        },
        ["session_id", "state"],
    ),
    _tool(
        "browser_request_human",
        "Pause for human takeover in the shared browser until the user resumes AI.",
        {
            "session_id": {"type": "string"},
            "reason": {"type": "string"},
            "timeout_ms": {"type": "integer", "default": 600000},
        },
        ["session_id", "reason"],
    ),
    _tool(
        "browser_close_session",
        "Close a real browser session and all of its tabs.",
        {
            "session_id": {"type": "string"},
        },
        ["session_id"],
    ),
]


def _detail_summary(detail: dict[str, Any]) -> str:
    title = str(detail.get("current_title") or "").strip() or "未命名页面"
    url = str(detail.get("current_url") or "").strip() or "about:blank"
    tab_count = int(detail.get("tab_count") or 0)
    status = str(detail.get("status") or "active")
    if status == "awaiting_human":
        reason = str(detail.get("takeover_reason") or "").strip()
        return f"{title} ({url})，标签页 {tab_count}，当前等待人工接管。{reason}".strip()
    return f"{title} ({url})，标签页 {tab_count}"


async def dispatch_browser_tool(name: str, args: dict[str, Any]) -> str:
    manager = get_browser_session_manager()
    session_id = str(args.get("session_id", ""))
    try:
        if name == "browser_create_session":
            detail = await manager.create_session()
            return f"已创建浏览器会话：{detail['id']}，{_detail_summary(detail)}"

        if name == "browser_open":
            detail = await manager.navigate(session_id, str(args.get("url", "")))
            return f"已打开网页：{_detail_summary(detail)}"

        if name == "browser_reload":
            detail = await manager.reload(session_id)
            return f"已刷新当前页面：{_detail_summary(detail)}"

        if name == "browser_back":
            detail = await manager.go_back(session_id)
            return f"已后退：{_detail_summary(detail)}"

        if name == "browser_forward":
            detail = await manager.go_forward(session_id)
            return f"已前进：{_detail_summary(detail)}"

        if name == "browser_new_tab":
            detail = await manager.create_tab(session_id)
            return f"已新建标签页：{_detail_summary(detail)}"

        if name == "browser_switch_tab":
            detail = await manager.activate_tab(session_id, str(args.get("tab_id", "")))
            return f"已切换标签页：{_detail_summary(detail)}"

        if name == "browser_close_tab":
            detail = await manager.close_tab(session_id, str(args.get("tab_id", "")))
            return f"已关闭标签页：{_detail_summary(detail)}"

        if name == "browser_click":
            return await manager.click(session_id, str(args.get("selector", "")))

        if name == "browser_click_at":
            return await manager.click_at(
                session_id,
                float(args.get("x", 0)),
                float(args.get("y", 0)),
                str(args.get("button", "left")),
            )

        if name == "browser_type":
            return await manager.type(
                session_id,
                str(args.get("selector", "")),
                str(args.get("text", "")),
                bool(args.get("press_enter", False)),
            )

        if name == "browser_type_text":
            return await manager.type_text(session_id, str(args.get("text", "")))

        if name == "browser_press":
            return await manager.press(session_id, str(args.get("key", "")))

        if name == "browser_wheel":
            return await manager.wheel(
                session_id,
                float(args.get("delta_x", 0)),
                float(args.get("delta_y", 800)),
            )

        if name == "browser_wait_for":
            return await manager.wait_for(
                session_id,
                str(args.get("selector")) if args.get("selector") else None,
                int(args.get("timeout_ms", 10000)),
            )

        if name == "browser_extract_text":
            data = await manager.extract_text(
                session_id,
                str(args.get("selector")) if args.get("selector") else None,
                int(args.get("max_chars", 12000)),
            )
            return data["content"]

        if name == "browser_get_state":
            return await manager.get_state(session_id)

        if name == "browser_focus":
            detail = await manager.focus_session(session_id)
            return f"已聚焦浏览器：{_detail_summary(detail)}"

        if name == "browser_import_cookies":
            detail = await manager.import_cookie_header(
                session_id,
                str(args.get("site_url", "")),
                str(args.get("cookie_header")) if args.get("cookie_header") else None,
                args.get("cookie_json"),
            )
            return f"已导入 Cookie：{_detail_summary(detail)}"

        if name == "browser_import_storage_state":
            detail = await manager.import_storage_state(session_id, args.get("state", {}))
            return f"已导入浏览器登录态：{_detail_summary(detail)}"

        if name == "browser_request_human":
            detail = await manager.request_human(
                session_id,
                str(args.get("reason", "")),
                True,
                int(args.get("timeout_ms", 600000)),
            )
            return f"人工接管已结束，AI 已恢复：{_detail_summary(detail)}"

        if name == "browser_close_session":
            await manager.close_session(session_id)
            return "浏览器会话已关闭。"
    except BrowserSessionError as exc:
        return str(exc)

    return f"未知浏览器工具：{name}"
