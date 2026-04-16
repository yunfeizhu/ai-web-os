from __future__ import annotations

import asyncio
import json
import os
import time
import uuid
from http.cookies import SimpleCookie
from urllib.parse import quote
from urllib.parse import urlparse
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, Field


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _utc_iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat()


def _read_int_env(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


def _normalize_site_url(raw_url: str) -> str:
    trimmed = raw_url.strip()
    if not trimmed:
        raise ValueError("Site URL is required.")
    if not urlparse(trimmed).scheme:
        trimmed = f"https://{trimmed}"
    parsed = urlparse(trimmed)
    if not parsed.scheme or not parsed.hostname:
        raise ValueError("Invalid site URL.")
    return parsed.geturl()


def _parse_cookie_header(cookie_header: str, site_url: str) -> list[dict[str, Any]]:
    parsed_url = urlparse(site_url)
    hostname = parsed_url.hostname
    if not hostname:
        raise ValueError("Invalid site URL.")

    raw = cookie_header.strip()
    if not raw:
        raise ValueError("Cookie string is required.")

    cookie = SimpleCookie()
    try:
        cookie.load(raw)
    except Exception as exc:
        raise ValueError(f"Invalid cookie string: {exc}") from exc

    if not cookie:
        raise ValueError("No valid cookie pairs were found.")

    secure = parsed_url.scheme == "https"
    result: list[dict[str, Any]] = []
    for morsel in cookie.values():
        result.append(
            {
                "name": morsel.key,
                "value": morsel.value,
                "domain": hostname,
                "path": "/",
                "httpOnly": False,
                "secure": secure,
                "sameSite": "Lax",
            }
        )
    return result


def _normalize_same_site(value: Any) -> str | None:
    if value is None:
        return "Lax"
    if not isinstance(value, str):
        return "Lax"

    normalized = value.strip().lower()
    if not normalized:
        return "Lax"
    if normalized in {"lax"}:
        return "Lax"
    if normalized in {"strict"}:
        return "Strict"
    if normalized in {"none", "no_restriction", "no-restriction"}:
        return "None"
    return "Lax"


def _normalize_cookie_json(raw_cookie_json: Any, site_url: str) -> list[dict[str, Any]]:
    parsed_url = urlparse(site_url)
    fallback_hostname = parsed_url.hostname
    fallback_secure = parsed_url.scheme == "https"

    payload = raw_cookie_json
    if isinstance(payload, dict):
        payload = payload.get("cookies", payload)

    if not isinstance(payload, list):
        raise ValueError("Cookie JSON must be an array, or an object with a cookies array.")

    normalized: list[dict[str, Any]] = []
    for index, item in enumerate(payload):
        if not isinstance(item, dict):
            raise ValueError(f"Cookie JSON entry #{index + 1} must be an object.")

        name = item.get("name")
        value = item.get("value")
        if not isinstance(name, str) or not name.strip():
            raise ValueError(f"Cookie JSON entry #{index + 1} is missing a valid name.")
        if not isinstance(value, str):
            raise ValueError(f"Cookie JSON entry #{index + 1} is missing a valid value.")

        domain = item.get("domain")
        path = item.get("path")
        url = item.get("url")
        if isinstance(url, str) and url.strip():
            parsed_cookie_url = urlparse(url.strip())
            if not domain:
                domain = parsed_cookie_url.hostname
            if not path:
                path = parsed_cookie_url.path or "/"

        if not isinstance(domain, str) or not domain.strip():
            domain = fallback_hostname
        if not isinstance(domain, str) or not domain.strip():
            raise ValueError(f"Cookie JSON entry #{index + 1} is missing a valid domain.")

        normalized_entry: dict[str, Any] = {
            "name": name,
            "value": value,
            "domain": domain.strip(),
            "path": path.strip() if isinstance(path, str) and path.strip() else "/",
            "httpOnly": bool(item.get("httpOnly", item.get("http_only", False))),
            "secure": bool(item.get("secure", fallback_secure)),
            "sameSite": _normalize_same_site(item.get("sameSite", item.get("same_site"))),
        }

        is_session = bool(item.get("session", False))
        expires = item.get("expires", item.get("expirationDate"))
        if not is_session and expires not in {None, "", -1}:
            try:
                normalized_entry["expires"] = float(expires)
            except (TypeError, ValueError) as exc:
                raise ValueError(
                    f"Cookie JSON entry #{index + 1} has an invalid expires value."
                ) from exc

        normalized.append(normalized_entry)

    if not normalized:
        raise ValueError("No valid cookies were found in the JSON payload.")
    return normalized


VIEWPORT_WIDTH = _read_int_env("BROWSER_VIEWPORT_WIDTH", 1440)
VIEWPORT_HEIGHT = _read_int_env("BROWSER_VIEWPORT_HEIGHT", 920)
VIEWPORT = {"width": VIEWPORT_WIDTH, "height": VIEWPORT_HEIGHT}
SCREEN = {"width": VIEWPORT_WIDTH, "height": VIEWPORT_HEIGHT}
LOCALE = os.environ.get("BROWSER_LOCALE", "zh-CN")
TIMEZONE_ID = os.environ.get("BROWSER_TIMEZONE", "Asia/Shanghai")
COLOR_SCHEME = os.environ.get("BROWSER_COLOR_SCHEME", "light")
STORAGE_ROOT = Path(os.environ.get("BROWSER_STORAGE_ROOT", "/data/browser-state"))
STORAGE_STATE_PATH = STORAGE_ROOT / "default-storage-state.json"
ACCEPT_LANGUAGE = os.environ.get(
    "BROWSER_ACCEPT_LANGUAGE",
    "zh-CN,zh;q=0.9,en;q=0.8",
)
BROWSER_CHROMIUM_CHANNEL = os.environ.get("BROWSER_CHROMIUM_CHANNEL", "chrome").strip()
BROWSER_EXECUTABLE_PATH = os.environ.get("BROWSER_EXECUTABLE_PATH", "").strip()
BROWSER_CHROME_APP_MODE = os.environ.get("BROWSER_CHROME_APP_MODE", "1").strip().lower() not in {
    "",
    "0",
    "false",
    "no",
}
BROWSER_IMMERSIVE_CHROME = os.environ.get("BROWSER_IMMERSIVE_CHROME", "1").strip().lower() not in {
    "",
    "0",
    "false",
    "no",
}
BROWSER_CHROME_APP_URL = os.environ.get(
    "BROWSER_CHROME_APP_URL",
    "data:text/html," + quote(
        "<!doctype html><html><head><meta charset='utf-8'><title>AI Native Browser</title>"
        "<style>html,body{margin:0;height:100%;background:#ffffff;}</style></head><body></body></html>",
        safe=":/,;=+?&",
    ),
).strip()


@dataclass
class ActionLogEntry:
    ts: str
    action: str
    detail: str


@dataclass
class BrowserTab:
    id: str
    page: Any
    title: str = ""
    url: str = "about:blank"
    created_at: datetime = field(default_factory=_utc_now)


@dataclass
class BrowserSession:
    id: str
    browser: Any
    context: Any
    tabs: dict[str, BrowserTab]
    active_tab_id: str
    created_at: datetime = field(default_factory=_utc_now)
    updated_at: datetime = field(default_factory=_utc_now)
    last_error: str | None = None
    action_log: list[ActionLogEntry] = field(default_factory=list)


class RuntimeErrorMessage(RuntimeError):
    pass


class BrowserRuntime:
    def __init__(self) -> None:
        self.playwright = None
        self.sessions: dict[str, BrowserSession] = {}

    async def startup(self) -> None:
        from playwright.async_api import async_playwright

        STORAGE_ROOT.mkdir(parents=True, exist_ok=True)
        self.playwright = await async_playwright().start()

    async def shutdown(self) -> None:
        session_ids = list(self.sessions.keys())
        for session_id in session_ids:
            await self.close_session(session_id)
        if self.playwright is not None:
            await self.playwright.stop()
            self.playwright = None

    def _ensure_ready(self) -> None:
        if self.playwright is None:
            raise RuntimeErrorMessage("Browser runtime is not initialized.")

    def _log(self, session: BrowserSession, action: str, detail: str) -> None:
        session.updated_at = _utc_now()
        session.action_log.append(ActionLogEntry(ts=_utc_iso(session.updated_at), action=action, detail=detail))
        if len(session.action_log) > 200:
            session.action_log = session.action_log[-200:]

    def _build_context_options(self, storage_state: dict[str, Any] | None = None) -> dict[str, Any]:
        options: dict[str, Any] = {
            "viewport": VIEWPORT,
            "screen": SCREEN,
            "locale": LOCALE,
            "timezone_id": TIMEZONE_ID,
            "color_scheme": COLOR_SCHEME,
            "reduced_motion": "no-preference",
            "device_scale_factor": 1,
            "has_touch": False,
            "is_mobile": False,
            "ignore_https_errors": True,
            "accept_downloads": True,
            "extra_http_headers": {
                "Accept-Language": ACCEPT_LANGUAGE,
            },
        }
        if storage_state is not None:
            options["storage_state"] = storage_state
        elif STORAGE_STATE_PATH.exists():
            options["storage_state"] = str(STORAGE_STATE_PATH)
        return options

    def _build_launch_options(self) -> dict[str, Any]:
        launch_args = [
            "--disable-dev-shm-usage",
            f"--window-size={VIEWPORT_WIDTH},{VIEWPORT_HEIGHT}",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-session-crashed-bubble",
            "--hide-crash-restore-bubble",
            "--disable-features=GlobalMediaControls,ExtensionsToolbarMenu,SidePanelPinning,ReadAnything",
        ]
        if BROWSER_CHROME_APP_MODE and BROWSER_CHROME_APP_URL:
            launch_args.extend(
                [
                    "--force-app-mode",
                    f"--app={BROWSER_CHROME_APP_URL}",
                ]
            )
        if BROWSER_IMMERSIVE_CHROME:
            launch_args.append("--start-fullscreen")

        options: dict[str, Any] = {
            "headless": False,
            "args": launch_args,
        }
        if BROWSER_EXECUTABLE_PATH:
            options["executable_path"] = BROWSER_EXECUTABLE_PATH
        elif BROWSER_CHROMIUM_CHANNEL:
            options["channel"] = BROWSER_CHROMIUM_CHANNEL
        return options

    async def _apply_immersive_chrome(self, page: Any) -> None:
        if not BROWSER_IMMERSIVE_CHROME or page.is_closed():
            return

        try:
            session = await page.context.new_cdp_session(page)
            window = await session.send("Browser.getWindowForTarget")
            window_id = window.get("windowId")
            if window_id:
                await session.send(
                    "Browser.setWindowBounds",
                    {
                        "windowId": window_id,
                        "bounds": {"windowState": "fullscreen"},
                    },
                )
            await session.detach()
        except Exception:
            try:
                await page.keyboard.press("F11")
            except Exception:
                pass

    def _wire_context(self, session: BrowserSession, context: Any) -> None:
        context.on("page", lambda new_page: asyncio.create_task(self._attach_tab(session, new_page)))

    async def _persist_storage_state(self, session: BrowserSession) -> None:
        try:
            await session.context.storage_state(path=str(STORAGE_STATE_PATH))
        except Exception:
            pass

    def _normalize_storage_state(self, raw_state: Any) -> dict[str, Any]:
        if isinstance(raw_state, list):
            return {"cookies": raw_state, "origins": []}
        if not isinstance(raw_state, dict):
            raise RuntimeErrorMessage("Storage state must be a JSON object or a cookie array.")

        cookies = raw_state.get("cookies", [])
        origins = raw_state.get("origins", [])
        if not isinstance(cookies, list):
            raise RuntimeErrorMessage("Storage state cookies must be a JSON array.")
        if not isinstance(origins, list):
            raise RuntimeErrorMessage("Storage state origins must be a JSON array.")

        return {
            "cookies": cookies,
            "origins": origins,
        }

    async def _attach_tab(self, session: BrowserSession, page: Any) -> str:
        tab_id = str(uuid.uuid4())
        title = ""
        url = "about:blank"
        if not page.is_closed():
            try:
                title = await page.title()
            except Exception:
                title = ""
            try:
                url = page.url or "about:blank"
            except Exception:
                url = "about:blank"

        tab = BrowserTab(id=tab_id, page=page, title=title, url=url)
        session.tabs[tab_id] = tab
        session.active_tab_id = tab_id
        await self._apply_immersive_chrome(page)
        self._log(session, "tab_opened", url)

        def _on_close() -> None:
            if tab_id in session.tabs:
                session.tabs.pop(tab_id, None)
                if session.active_tab_id == tab_id and session.tabs:
                    session.active_tab_id = next(reversed(session.tabs))
                self._log(session, "tab_closed", tab.url or tab.title or tab_id)

        page.on("close", lambda: _on_close())
        return tab_id

    async def _sync_tab(self, tab: BrowserTab) -> None:
        if tab.page.is_closed():
            return
        try:
            tab.title = await tab.page.title()
        except Exception:
            pass
        try:
            tab.url = tab.page.url or tab.url
        except Exception:
            pass

    def _get_session(self, session_id: str) -> BrowserSession:
        session = self.sessions.get(session_id)
        if session is None:
            raise RuntimeErrorMessage("Browser session does not exist.")
        return session

    def _get_active_tab(self, session: BrowserSession) -> BrowserTab:
        tab = session.tabs.get(session.active_tab_id)
        if tab is not None:
            return tab

        if session.tabs:
            fallback_tab_id = next(reversed(session.tabs))
            fallback_tab = session.tabs[fallback_tab_id]
            session.active_tab_id = fallback_tab_id
            self._log(
                session,
                "active_tab_recovered",
                fallback_tab.url or fallback_tab.title or fallback_tab_id,
            )
            return fallback_tab

        raise RuntimeErrorMessage("No active browser tab is available.")

    async def _detail(self, session: BrowserSession) -> dict[str, Any]:
        for tab in list(session.tabs.values()):
            await self._sync_tab(tab)
        active = self._get_active_tab(session)
        return {
            "id": session.id,
            "current_url": active.url,
            "current_title": active.title,
            "created_at": _utc_iso(session.created_at),
            "updated_at": _utc_iso(session.updated_at),
            "tab_count": len(session.tabs),
            "last_error": session.last_error,
            "tabs": [
                {
                    "id": tab.id,
                    "title": tab.title,
                    "url": tab.url,
                    "is_active": tab.id == session.active_tab_id,
                }
                for tab in session.tabs.values()
            ],
            "action_log": [
                {"ts": item.ts, "action": item.action, "detail": item.detail}
                for item in reversed(session.action_log[-40:])
            ],
        }

    async def create_session(self) -> dict[str, Any]:
        self._ensure_ready()
        try:
            launch_options = self._build_launch_options()
            browser = await self.playwright.chromium.launch(**launch_options)
            context = await browser.new_context(**self._build_context_options())
            page = await context.new_page()
            await page.bring_to_front()
        except Exception as exc:
            raise RuntimeErrorMessage(f"Failed to launch browser session: {exc}") from exc

        session_id = str(uuid.uuid4())
        session = BrowserSession(
            id=session_id,
            browser=browser,
            context=context,
            tabs={},
            active_tab_id="",
        )
        await self._attach_tab(session, page)
        self._wire_context(session, context)
        self.sessions[session_id] = session
        self._log(
            session,
            "session_created",
            "Browser session created. "
            f"locale={LOCALE}, timezone={TIMEZONE_ID}, viewport={VIEWPORT_WIDTH}x{VIEWPORT_HEIGHT}, "
            f"channel={BROWSER_CHROMIUM_CHANNEL or 'default'}, "
            f"executable={BROWSER_EXECUTABLE_PATH or 'playwright-managed'}, "
            f"app_mode={BROWSER_CHROME_APP_MODE}",
        )
        return await self._detail(session)

    async def list_sessions(self) -> list[dict[str, Any]]:
        return [await self._detail(session) for session in self.sessions.values()]

    async def close_session(self, session_id: str) -> None:
        session = self._get_session(session_id)
        self.sessions.pop(session_id, None)
        try:
            await self._persist_storage_state(session)
            await session.context.close()
        finally:
            await session.browser.close()

    async def export_storage_state(self, session_id: str) -> dict[str, Any]:
        session = self._get_session(session_id)
        try:
            state = await session.context.storage_state()
        except Exception as exc:
            session.last_error = f"Export storage state failed: {exc}"
            self._log(session, "storage_state_export_error", session.last_error)
            raise RuntimeErrorMessage(session.last_error) from exc

        self._log(
            session,
            "storage_state_export",
            f"{len(state.get('cookies', []))} cookies, {len(state.get('origins', []))} origins",
        )
        return state

    async def import_storage_state(self, session_id: str, raw_state: Any) -> dict[str, Any]:
        session = self._get_session(session_id)
        normalized_state = self._normalize_storage_state(raw_state)
        current_url = "about:blank"
        try:
            active_tab = self._get_active_tab(session)
            current_url = active_tab.url or current_url
        except RuntimeErrorMessage:
            current_url = "about:blank"

        try:
            await self._persist_storage_state(session)
            await session.context.close()
            session.tabs.clear()
            session.active_tab_id = ""

            new_context = await session.browser.new_context(
                **self._build_context_options(storage_state=normalized_state)
            )
            session.context = new_context
            self._wire_context(session, new_context)

            page = await new_context.new_page()
            await page.bring_to_front()
            await self._attach_tab(session, page)
            if current_url and current_url != "about:blank":
                try:
                    await page.goto(current_url, wait_until="domcontentloaded", timeout=20000)
                except Exception:
                    pass
            await self._persist_storage_state(session)
        except Exception as exc:
            session.last_error = f"Import storage state failed: {exc}"
            self._log(session, "storage_state_import_error", session.last_error)
            raise RuntimeErrorMessage(session.last_error) from exc

        self._log(
            session,
            "storage_state_import",
            f"{len(normalized_state.get('cookies', []))} cookies, {len(normalized_state.get('origins', []))} origins",
        )
        return await self._detail(session)

    async def import_cookie_header(
        self,
        session_id: str,
        site_url: str,
        cookie_header: str | None = None,
        cookie_json: Any | None = None,
    ) -> dict[str, Any]:
        session = self._get_session(session_id)
        try:
            normalized_url = _normalize_site_url(site_url)
            if cookie_json is not None:
                cookies = _normalize_cookie_json(cookie_json, normalized_url)
            elif isinstance(cookie_header, str) and cookie_header.strip():
                cookies = _parse_cookie_header(cookie_header, normalized_url)
            else:
                raise ValueError("Cookie string or Cookie JSON is required.")
            await session.context.add_cookies(cookies)
            await self._persist_storage_state(session)
        except ValueError as exc:
            raise RuntimeErrorMessage(str(exc)) from exc
        except Exception as exc:
            session.last_error = f"Import cookies failed: {exc}"
            self._log(session, "cookie_import_error", session.last_error)
            raise RuntimeErrorMessage(session.last_error) from exc

        active_url = ""
        try:
            active_tab = self._get_active_tab(session)
            active_url = active_tab.url or ""
            active_host = urlparse(active_url).hostname or ""
            target_host = urlparse(normalized_url).hostname or ""
            if active_host and target_host and active_host == target_host:
                try:
                    await active_tab.page.reload(
                        wait_until="domcontentloaded",
                        timeout=20000,
                    )
                    await self._sync_tab(active_tab)
                except Exception:
                    pass
        except RuntimeErrorMessage:
            active_url = ""

        self._log(
            session,
            "cookie_import",
            f"{len(cookies)} cookies -> {normalized_url}",
        )
        return await self._detail(session)

    async def navigate(self, session_id: str, url: str) -> dict[str, Any]:
        session = self._get_session(session_id)
        tab = self._get_active_tab(session)
        started_at = time.perf_counter()
        try:
            await tab.page.goto(url, wait_until="domcontentloaded", timeout=20000)
            await self._sync_tab(tab)
            self._log(session, "navigate", f"{url} ({time.perf_counter() - started_at:.2f}s)")
        except Exception as exc:
            session.last_error = f"Navigate failed: {exc}"
            self._log(session, "navigate_error", session.last_error)
            raise RuntimeErrorMessage(session.last_error) from exc
        return await self._detail(session)

    async def reload(self, session_id: str) -> dict[str, Any]:
        session = self._get_session(session_id)
        tab = self._get_active_tab(session)
        try:
            await tab.page.reload(wait_until="domcontentloaded", timeout=20000)
            await self._sync_tab(tab)
            self._log(session, "reload", tab.url)
        except Exception as exc:
            session.last_error = f"Reload failed: {exc}"
            self._log(session, "reload_error", session.last_error)
            raise RuntimeErrorMessage(session.last_error) from exc
        return await self._detail(session)

    async def go_back(self, session_id: str) -> dict[str, Any]:
        session = self._get_session(session_id)
        tab = self._get_active_tab(session)
        try:
            await tab.page.go_back(wait_until="domcontentloaded", timeout=20000)
            await self._sync_tab(tab)
            self._log(session, "go_back", tab.url)
        except Exception as exc:
            session.last_error = f"Back navigation failed: {exc}"
            self._log(session, "back_error", session.last_error)
            raise RuntimeErrorMessage(session.last_error) from exc
        return await self._detail(session)

    async def go_forward(self, session_id: str) -> dict[str, Any]:
        session = self._get_session(session_id)
        tab = self._get_active_tab(session)
        try:
            await tab.page.go_forward(wait_until="domcontentloaded", timeout=20000)
            await self._sync_tab(tab)
            self._log(session, "go_forward", tab.url)
        except Exception as exc:
            session.last_error = f"Forward navigation failed: {exc}"
            self._log(session, "forward_error", session.last_error)
            raise RuntimeErrorMessage(session.last_error) from exc
        return await self._detail(session)

    async def activate_tab(self, session_id: str, tab_id: str) -> dict[str, Any]:
        session = self._get_session(session_id)
        if tab_id not in session.tabs:
            raise RuntimeErrorMessage("Tab does not exist.")
        session.active_tab_id = tab_id
        await session.tabs[tab_id].page.bring_to_front()
        await self._apply_immersive_chrome(session.tabs[tab_id].page)
        self._log(session, "activate_tab", tab_id)
        return await self._detail(session)

    async def create_tab(self, session_id: str) -> dict[str, Any]:
        session = self._get_session(session_id)
        try:
            page = await session.context.new_page()
            await page.bring_to_front()
            await self._apply_immersive_chrome(page)
        except Exception as exc:
            session.last_error = f"Create tab failed: {exc}"
            self._log(session, "create_tab_error", session.last_error)
            raise RuntimeErrorMessage(session.last_error) from exc

        self._log(session, "create_tab", "about:blank")
        return await self._detail(session)

    async def close_tab(self, session_id: str, tab_id: str) -> dict[str, Any]:
        session = self._get_session(session_id)
        tab = session.tabs.get(tab_id)
        if tab is None:
            raise RuntimeErrorMessage("Tab does not exist.")
        if len(session.tabs) <= 1:
            raise RuntimeErrorMessage("Cannot close the last tab in the session.")

        try:
            await tab.page.close()
        except Exception as exc:
            session.last_error = f"Close tab failed: {exc}"
            self._log(session, "close_tab_error", session.last_error)
            raise RuntimeErrorMessage(session.last_error) from exc

        self._log(session, "close_tab", tab_id)
        return await self._detail(session)

    async def focus_session(self, session_id: str) -> dict[str, Any]:
        session = self._get_session(session_id)
        tab = self._get_active_tab(session)
        try:
            await tab.page.bring_to_front()
            await self._apply_immersive_chrome(tab.page)
            await self._sync_tab(tab)
        except Exception as exc:
            session.last_error = f"Focus session failed: {exc}"
            self._log(session, "focus_session_error", session.last_error)
            raise RuntimeErrorMessage(session.last_error) from exc
        self._log(session, "focus_session", tab.url)
        return await self._detail(session)

    async def extract(self, session_id: str, selector: str | None, max_chars: int) -> dict[str, Any]:
        session = self._get_session(session_id)
        tab = self._get_active_tab(session)
        try:
            if selector:
                locator = self._locator(tab.page, selector)
                text = await locator.first.inner_text(timeout=10000)
            else:
                text = await tab.page.locator("body").inner_text(timeout=10000)
        except Exception as exc:
            session.last_error = f"Extract text failed: {exc}"
            self._log(session, "extract_error", session.last_error)
            raise RuntimeErrorMessage(session.last_error) from exc

        normalized = "\n".join(line.rstrip() for line in text.splitlines())
        normalized = "\n".join(line for line in normalized.splitlines() if line.strip()).strip()
        truncated = len(normalized) > max_chars
        preview = normalized[:max_chars]
        self._log(session, "extract_text", f"{selector or 'body'} -> {len(preview)} chars")
        return {
            "title": tab.title or tab.url,
            "url": tab.url,
            "content": preview,
            "truncated": truncated,
        }

    async def screenshot(self, session_id: str) -> bytes:
        session = self._get_session(session_id)
        tab = self._get_active_tab(session)
        try:
            return await tab.page.screenshot(type="png")
        except Exception as exc:
            session.last_error = f"Screenshot failed: {exc}"
            self._log(session, "screenshot_error", session.last_error)
            raise RuntimeErrorMessage(session.last_error) from exc

    def _locator(self, page: Any, selector: str):
        selector = selector.strip()
        if selector.startswith("text="):
            return page.get_by_text(selector[5:])
        return page.locator(selector)

    async def click(self, session_id: str, selector: str) -> str:
        session = self._get_session(session_id)
        tab = self._get_active_tab(session)
        try:
            await self._locator(tab.page, selector).first.click(timeout=10000)
            await self._sync_tab(tab)
        except Exception as exc:
            session.last_error = f"Click failed: {exc}"
            self._log(session, "click_error", session.last_error)
            raise RuntimeErrorMessage(session.last_error) from exc
        self._log(session, "click", selector)
        return f"Clicked: {selector}"

    async def click_at(self, session_id: str, x: float, y: float, button: str = "left") -> str:
        session = self._get_session(session_id)
        tab = self._get_active_tab(session)
        try:
            await tab.page.mouse.click(x, y, button=button)
            await self._sync_tab(tab)
        except Exception as exc:
            session.last_error = f"Coordinate click failed: {exc}"
            self._log(session, "click_at_error", session.last_error)
            raise RuntimeErrorMessage(session.last_error) from exc
        self._log(session, "click_at", f"{button} ({x:.0f}, {y:.0f})")
        return f"Clicked coordinates: ({x:.0f}, {y:.0f})"

    async def mouse_down(self, session_id: str, x: float, y: float, button: str = "left") -> str:
        session = self._get_session(session_id)
        tab = self._get_active_tab(session)
        try:
            await tab.page.mouse.move(x, y)
            await tab.page.mouse.down(button=button)
        except Exception as exc:
            session.last_error = f"Mouse down failed: {exc}"
            self._log(session, "mouse_down_error", session.last_error)
            raise RuntimeErrorMessage(session.last_error) from exc
        self._log(session, "mouse_down", f"{button} ({x:.0f}, {y:.0f})")
        return f"Mouse down at ({x:.0f}, {y:.0f})"

    async def mouse_move(self, session_id: str, x: float, y: float) -> str:
        session = self._get_session(session_id)
        tab = self._get_active_tab(session)
        try:
            await tab.page.mouse.move(x, y)
        except Exception as exc:
            session.last_error = f"Mouse move failed: {exc}"
            self._log(session, "mouse_move_error", session.last_error)
            raise RuntimeErrorMessage(session.last_error) from exc
        session.updated_at = _utc_now()
        return f"Mouse moved to ({x:.0f}, {y:.0f})"

    async def mouse_up(self, session_id: str, x: float, y: float, button: str = "left") -> str:
        session = self._get_session(session_id)
        tab = self._get_active_tab(session)
        try:
            await tab.page.mouse.move(x, y)
            await tab.page.mouse.up(button=button)
            await self._sync_tab(tab)
        except Exception as exc:
            session.last_error = f"Mouse up failed: {exc}"
            self._log(session, "mouse_up_error", session.last_error)
            raise RuntimeErrorMessage(session.last_error) from exc
        self._log(session, "mouse_up", f"{button} ({x:.0f}, {y:.0f})")
        return f"Mouse up at ({x:.0f}, {y:.0f})"

    async def drag(
        self,
        session_id: str,
        start_x: float,
        start_y: float,
        end_x: float,
        end_y: float,
        steps: int = 24,
        duration_ms: int = 700,
        button: str = "left",
    ) -> str:
        session = self._get_session(session_id)
        tab = self._get_active_tab(session)
        total_steps = max(steps, 1)
        try:
            await tab.page.mouse.move(start_x, start_y)
            await tab.page.mouse.down(button=button)
            pause_seconds = (duration_ms / total_steps) / 1000 if duration_ms > 0 else 0
            for index in range(1, total_steps + 1):
                progress = index / total_steps
                next_x = start_x + (end_x - start_x) * progress
                next_y = start_y + (end_y - start_y) * progress
                await tab.page.mouse.move(next_x, next_y)
                if pause_seconds > 0:
                    await asyncio.sleep(pause_seconds)
            await tab.page.mouse.up(button=button)
            await self._sync_tab(tab)
        except Exception as exc:
            session.last_error = f"Drag failed: {exc}"
            self._log(session, "drag_error", session.last_error)
            raise RuntimeErrorMessage(session.last_error) from exc
        self._log(
            session,
            "drag",
            f"{button} ({start_x:.0f}, {start_y:.0f}) -> ({end_x:.0f}, {end_y:.0f})",
        )
        return f"Dragged to ({end_x:.0f}, {end_y:.0f})"

    async def type(self, session_id: str, selector: str, text: str, press_enter: bool) -> str:
        session = self._get_session(session_id)
        tab = self._get_active_tab(session)
        try:
            await self._locator(tab.page, selector).first.fill(text, timeout=10000)
            if press_enter:
                await tab.page.keyboard.press("Enter")
            await self._sync_tab(tab)
        except Exception as exc:
            session.last_error = f"Type into selector failed: {exc}"
            self._log(session, "type_error", session.last_error)
            raise RuntimeErrorMessage(session.last_error) from exc
        self._log(session, "type", f"{selector} <= {text[:80]}")
        return f"Typed into {selector}"

    async def type_text(self, session_id: str, text: str) -> str:
        session = self._get_session(session_id)
        tab = self._get_active_tab(session)
        try:
            await tab.page.keyboard.type(text)
            await self._sync_tab(tab)
        except Exception as exc:
            session.last_error = f"Type into focused element failed: {exc}"
            self._log(session, "type_text_error", session.last_error)
            raise RuntimeErrorMessage(session.last_error) from exc
        self._log(session, "type_text", text[:80])
        return "Typed into focused element."

    async def press(self, session_id: str, key: str) -> str:
        session = self._get_session(session_id)
        tab = self._get_active_tab(session)
        try:
            await tab.page.keyboard.press(key)
            await self._sync_tab(tab)
        except Exception as exc:
            session.last_error = f"Key press failed: {exc}"
            self._log(session, "press_error", session.last_error)
            raise RuntimeErrorMessage(session.last_error) from exc
        self._log(session, "press", key)
        return f"Pressed key: {key}"

    async def wheel(self, session_id: str, delta_x: float, delta_y: float) -> str:
        session = self._get_session(session_id)
        tab = self._get_active_tab(session)
        try:
            await tab.page.mouse.wheel(delta_x=delta_x, delta_y=delta_y)
            await self._sync_tab(tab)
        except Exception as exc:
            session.last_error = f"Scroll failed: {exc}"
            self._log(session, "wheel_error", session.last_error)
            raise RuntimeErrorMessage(session.last_error) from exc
        self._log(session, "wheel", f"dx={delta_x:.0f}, dy={delta_y:.0f}")
        return "Scrolled page."

    async def wait_for(self, session_id: str, selector: str | None, timeout_ms: int) -> str:
        session = self._get_session(session_id)
        tab = self._get_active_tab(session)
        try:
            if selector:
                await self._locator(tab.page, selector).first.wait_for(timeout=timeout_ms)
            else:
                await tab.page.wait_for_load_state("domcontentloaded", timeout=timeout_ms)
            await self._sync_tab(tab)
        except Exception as exc:
            session.last_error = f"Wait failed: {exc}"
            self._log(session, "wait_error", session.last_error)
            raise RuntimeErrorMessage(session.last_error) from exc
        self._log(session, "wait_for", selector or "domcontentloaded")
        return f"Wait completed: {selector or 'domcontentloaded'}"

    async def get_state(self, session_id: str) -> str:
        session = self._get_session(session_id)
        tab = self._get_active_tab(session)
        await self._sync_tab(tab)
        try:
            headings = await tab.page.locator("h1, h2, h3").all_inner_texts()
        except Exception:
            headings = []
        try:
            inputs = await tab.page.locator("input, textarea, select").evaluate_all(
                """elements => elements.map(el => ({
                    name: el.getAttribute('name') || '',
                    placeholder: el.getAttribute('placeholder') || '',
                    type: el.getAttribute('type') || el.tagName.toLowerCase()
                }))"""
            )
        except Exception:
            inputs = []
        try:
            interactables = await tab.page.evaluate(
                """() => {
                    const clean = (value) => (value || '').replace(/\\s+/g, ' ').trim();
                    const crop = (value, max = 80) => clean(value).slice(0, max);
                    const isVisible = (el) => {
                        if (!(el instanceof HTMLElement)) return false;
                        const style = window.getComputedStyle(el);
                        if (style.display === 'none' || style.visibility === 'hidden') return false;
                        const rect = el.getBoundingClientRect();
                        return rect.width > 0 && rect.height > 0;
                    };
                    const quoteAttr = (value) => value.replace(/["\\\\]/g, '\\\\$&');
                    const selectorFor = (el) => {
                        if (!(el instanceof HTMLElement)) return '';
                        if (el.id) return `#${CSS.escape(el.id)}`;
                        const tag = el.tagName.toLowerCase();
                        const text = crop(el.innerText || el.textContent || '', 60);
                        const placeholder = crop(el.getAttribute('placeholder') || '', 40);
                        const ariaLabel = crop(el.getAttribute('aria-label') || '', 40);
                        const name = crop(el.getAttribute('name') || '', 40);
                        const type = crop(el.getAttribute('type') || '', 20);
                        if ((tag === 'a' || tag === 'button' || el.getAttribute('role') === 'button') && text) return `text=${text}`;
                        if (placeholder) return `${tag}[placeholder*="${quoteAttr(placeholder)}"]`;
                        if (ariaLabel) return `${tag}[aria-label*="${quoteAttr(ariaLabel)}"]`;
                        if (name) return `${tag}[name*="${quoteAttr(name)}"]`;
                        if (type && (tag === 'input' || tag === 'button')) return `${tag}[type="${quoteAttr(type)}"]`;
                        return tag;
                    };

                    return Array.from(document.querySelectorAll('a, button, input, textarea, select, [role="button"], [onclick]'))
                        .filter(isVisible)
                        .slice(0, 80)
                        .map((el, index) => {
                            const tag = el.tagName.toLowerCase();
                            const rect = el.getBoundingClientRect();
                            const text = crop(el.innerText || el.textContent || '', 80);
                            return {
                                index,
                                tag,
                                role: crop(el.getAttribute('role') || '', 30),
                                text,
                                placeholder: crop(el.getAttribute('placeholder') || '', 50),
                                aria_label: crop(el.getAttribute('aria-label') || '', 50),
                                name: crop(el.getAttribute('name') || '', 50),
                                type: crop(el.getAttribute('type') || '', 30),
                                href: tag === 'a' ? crop(el.getAttribute('href') || '', 120) : '',
                                selector: selectorFor(el),
                                x: Math.round(rect.x),
                                y: Math.round(rect.y),
                                width: Math.round(rect.width),
                                height: Math.round(rect.height),
                            };
                        });
                }"""
            )
        except Exception:
            interactables = []
        payload = {
            "url": tab.url,
            "title": tab.title,
            "headings": headings[:20],
            "inputs": inputs[:20],
            "interactables": interactables[:60],
            "tabs": [
                {
                    "id": browser_tab.id,
                    "title": browser_tab.title,
                    "url": browser_tab.url,
                    "is_active": browser_tab.id == session.active_tab_id,
                }
                for browser_tab in session.tabs.values()
            ],
        }
        self._log(session, "get_state", tab.url)
        return json.dumps(payload, ensure_ascii=False, indent=2)


runtime = BrowserRuntime()
app = FastAPI(title="AI-Native OS Browser Runtime", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def _startup() -> None:
    await runtime.startup()


@app.on_event("shutdown")
async def _shutdown() -> None:
    await runtime.shutdown()


def _raise(exc: RuntimeErrorMessage) -> None:
    detail = str(exc)
    status_code = 400
    if "does not exist" in detail:
        status_code = 404
    raise HTTPException(status_code=status_code, detail=detail)


class NavigateRequest(BaseModel):
    url: str = Field(..., min_length=1)


class ExtractRequest(BaseModel):
    selector: str | None = None
    max_chars: int = Field(default=12000, ge=1000, le=50000)


class SwitchTabRequest(BaseModel):
    tab_id: str = Field(..., min_length=1)


class ClickRequest(BaseModel):
    selector: str = Field(..., min_length=1)


class TypeRequest(BaseModel):
    selector: str = Field(..., min_length=1)
    text: str = ""
    press_enter: bool = False


class PressRequest(BaseModel):
    key: str = Field(..., min_length=1)


class WaitRequest(BaseModel):
    selector: str | None = None
    timeout_ms: int = Field(default=10000, ge=100, le=60000)


class ClickAtRequest(BaseModel):
    x: float = Field(..., ge=0)
    y: float = Field(..., ge=0)
    button: str = Field(default="left")


class MouseMoveRequest(BaseModel):
    x: float = Field(..., ge=0)
    y: float = Field(..., ge=0)


class DragRequest(BaseModel):
    start_x: float = Field(..., ge=0)
    start_y: float = Field(..., ge=0)
    end_x: float = Field(..., ge=0)
    end_y: float = Field(..., ge=0)
    steps: int = Field(default=24, ge=1, le=120)
    duration_ms: int = Field(default=700, ge=0, le=10000)
    button: str = Field(default="left")


class WheelRequest(BaseModel):
    delta_x: float = 0
    delta_y: float = 0


class TypeTextRequest(BaseModel):
    text: str = ""


class StorageStateRequest(BaseModel):
    state: dict[str, Any] | list[Any] = Field(default_factory=dict)


class CookieImportRequest(BaseModel):
    site_url: str = Field(..., min_length=1)
    cookie_header: str | None = None
    cookie_json: dict[str, Any] | list[Any] | None = None


@app.get("/health")
async def health() -> dict[str, Any]:
    return {"ready": runtime.playwright is not None, "error": None}


@app.get("/sessions")
async def list_sessions() -> list[dict[str, Any]]:
    try:
        return await runtime.list_sessions()
    except RuntimeErrorMessage as exc:
        _raise(exc)


@app.post("/sessions")
async def create_session() -> dict[str, Any]:
    try:
        return await runtime.create_session()
    except RuntimeErrorMessage as exc:
        _raise(exc)


@app.get("/sessions/{session_id}")
async def get_session(session_id: str) -> dict[str, Any]:
    try:
        session = runtime._get_session(session_id)
        return await runtime._detail(session)
    except RuntimeErrorMessage as exc:
        _raise(exc)


@app.delete("/sessions/{session_id}")
async def delete_session(session_id: str) -> dict[str, str]:
    try:
        await runtime.close_session(session_id)
        return {"status": "ok"}
    except RuntimeErrorMessage as exc:
        _raise(exc)


@app.get("/sessions/{session_id}/storage-state")
async def export_storage_state(session_id: str) -> dict[str, Any]:
    try:
        return await runtime.export_storage_state(session_id)
    except RuntimeErrorMessage as exc:
        _raise(exc)


@app.post("/sessions/{session_id}/storage-state")
async def import_storage_state(session_id: str, req: StorageStateRequest) -> dict[str, Any]:
    try:
        return await runtime.import_storage_state(session_id, req.state)
    except RuntimeErrorMessage as exc:
        _raise(exc)


@app.post("/sessions/{session_id}/cookies")
async def import_cookie_header(session_id: str, req: CookieImportRequest) -> dict[str, Any]:
    try:
        return await runtime.import_cookie_header(
            session_id,
            req.site_url,
            req.cookie_header,
            req.cookie_json,
        )
    except RuntimeErrorMessage as exc:
        _raise(exc)


@app.post("/sessions/{session_id}/navigate")
async def navigate(session_id: str, req: NavigateRequest) -> dict[str, Any]:
    try:
        return await runtime.navigate(session_id, req.url)
    except RuntimeErrorMessage as exc:
        _raise(exc)


@app.post("/sessions/{session_id}/reload")
async def reload_page(session_id: str) -> dict[str, Any]:
    try:
        return await runtime.reload(session_id)
    except RuntimeErrorMessage as exc:
        _raise(exc)


@app.post("/sessions/{session_id}/back")
async def go_back(session_id: str) -> dict[str, Any]:
    try:
        return await runtime.go_back(session_id)
    except RuntimeErrorMessage as exc:
        _raise(exc)


@app.post("/sessions/{session_id}/forward")
async def go_forward(session_id: str) -> dict[str, Any]:
    try:
        return await runtime.go_forward(session_id)
    except RuntimeErrorMessage as exc:
        _raise(exc)


@app.post("/sessions/{session_id}/activate-tab")
async def activate_tab(session_id: str, req: SwitchTabRequest) -> dict[str, Any]:
    try:
        return await runtime.activate_tab(session_id, req.tab_id)
    except RuntimeErrorMessage as exc:
        _raise(exc)


@app.post("/sessions/{session_id}/tabs")
async def create_tab(session_id: str) -> dict[str, Any]:
    try:
        return await runtime.create_tab(session_id)
    except RuntimeErrorMessage as exc:
        _raise(exc)


@app.delete("/sessions/{session_id}/tabs/{tab_id}")
async def close_tab(session_id: str, tab_id: str) -> dict[str, Any]:
    try:
        return await runtime.close_tab(session_id, tab_id)
    except RuntimeErrorMessage as exc:
        _raise(exc)


@app.post("/sessions/{session_id}/focus")
async def focus_session(session_id: str) -> dict[str, Any]:
    try:
        return await runtime.focus_session(session_id)
    except RuntimeErrorMessage as exc:
        _raise(exc)


@app.post("/sessions/{session_id}/extract")
async def extract_text(session_id: str, req: ExtractRequest) -> dict[str, Any]:
    try:
        return await runtime.extract(session_id, req.selector, req.max_chars)
    except RuntimeErrorMessage as exc:
        _raise(exc)


@app.get("/sessions/{session_id}/screenshot")
async def screenshot(session_id: str) -> Response:
    try:
        image = await runtime.screenshot(session_id)
    except RuntimeErrorMessage as exc:
        _raise(exc)
    return Response(content=image, media_type="image/png", headers={"Cache-Control": "no-store"})


@app.post("/sessions/{session_id}/click")
async def click(session_id: str, req: ClickRequest) -> dict[str, str]:
    try:
        message = await runtime.click(session_id, req.selector)
        return {"message": message}
    except RuntimeErrorMessage as exc:
        _raise(exc)


@app.post("/sessions/{session_id}/click-at")
async def click_at(session_id: str, req: ClickAtRequest) -> dict[str, str]:
    try:
        message = await runtime.click_at(session_id, req.x, req.y, req.button)
        return {"message": message}
    except RuntimeErrorMessage as exc:
        _raise(exc)


@app.post("/sessions/{session_id}/mouse-down")
async def mouse_down(session_id: str, req: ClickAtRequest) -> dict[str, str]:
    try:
        message = await runtime.mouse_down(session_id, req.x, req.y, req.button)
        return {"message": message}
    except RuntimeErrorMessage as exc:
        _raise(exc)


@app.post("/sessions/{session_id}/mouse-move")
async def mouse_move(session_id: str, req: MouseMoveRequest) -> dict[str, str]:
    try:
        message = await runtime.mouse_move(session_id, req.x, req.y)
        return {"message": message}
    except RuntimeErrorMessage as exc:
        _raise(exc)


@app.post("/sessions/{session_id}/mouse-up")
async def mouse_up(session_id: str, req: ClickAtRequest) -> dict[str, str]:
    try:
        message = await runtime.mouse_up(session_id, req.x, req.y, req.button)
        return {"message": message}
    except RuntimeErrorMessage as exc:
        _raise(exc)


@app.post("/sessions/{session_id}/drag")
async def drag(session_id: str, req: DragRequest) -> dict[str, str]:
    try:
        message = await runtime.drag(
            session_id,
            req.start_x,
            req.start_y,
            req.end_x,
            req.end_y,
            req.steps,
            req.duration_ms,
            req.button,
        )
        return {"message": message}
    except RuntimeErrorMessage as exc:
        _raise(exc)


@app.post("/sessions/{session_id}/type")
async def type_text(session_id: str, req: TypeRequest) -> dict[str, str]:
    try:
        message = await runtime.type(session_id, req.selector, req.text, req.press_enter)
        return {"message": message}
    except RuntimeErrorMessage as exc:
        _raise(exc)


@app.post("/sessions/{session_id}/type-text")
async def type_text_to_focus(session_id: str, req: TypeTextRequest) -> dict[str, str]:
    try:
        message = await runtime.type_text(session_id, req.text)
        return {"message": message}
    except RuntimeErrorMessage as exc:
        _raise(exc)


@app.post("/sessions/{session_id}/press")
async def press_key(session_id: str, req: PressRequest) -> dict[str, str]:
    try:
        message = await runtime.press(session_id, req.key)
        return {"message": message}
    except RuntimeErrorMessage as exc:
        _raise(exc)


@app.post("/sessions/{session_id}/wheel")
async def wheel(session_id: str, req: WheelRequest) -> dict[str, str]:
    try:
        message = await runtime.wheel(session_id, req.delta_x, req.delta_y)
        return {"message": message}
    except RuntimeErrorMessage as exc:
        _raise(exc)


@app.post("/sessions/{session_id}/wait-for")
async def wait_for(session_id: str, req: WaitRequest) -> dict[str, str]:
    try:
        message = await runtime.wait_for(session_id, req.selector, req.timeout_ms)
        return {"message": message}
    except RuntimeErrorMessage as exc:
        _raise(exc)


@app.get("/sessions/{session_id}/state")
async def get_state(session_id: str) -> dict[str, str]:
    try:
        state = await runtime.get_state(session_id)
        return {"state": state}
    except RuntimeErrorMessage as exc:
        _raise(exc)
