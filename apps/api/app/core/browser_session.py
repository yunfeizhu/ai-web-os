from __future__ import annotations

from typing import Any

import httpx

from app.config import get_settings


class BrowserSessionError(RuntimeError):
    pass


class BrowserSessionManager:
    _instance: BrowserSessionManager | None = None

    @classmethod
    def instance(cls) -> BrowserSessionManager:
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def __init__(self) -> None:
        self._client: httpx.AsyncClient | None = None

    async def startup(self) -> None:
        if self._client is None:
            base_url = get_settings().browser_runtime_url.rstrip("/")
            self._client = httpx.AsyncClient(base_url=base_url, timeout=30.0)

    async def shutdown(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    def _ensure_client(self) -> httpx.AsyncClient:
        if self._client is None:
            raise BrowserSessionError("Browser runtime client is not initialized.")
        return self._client

    async def _request(self, method: str, path: str, **kwargs) -> Any:
        client = self._ensure_client()
        try:
            response = await client.request(method, path, **kwargs)
        except httpx.RequestError as exc:
            raise BrowserSessionError(
                "Browser runtime service is unreachable. Please start the browser-runtime container first."
            ) from exc

        if response.status_code >= 400:
            detail = ""
            try:
                payload = response.json()
                detail = payload.get("detail") or str(payload)
            except Exception:
                detail = response.text.strip()
            raise BrowserSessionError(detail or f"Browser runtime service error: HTTP {response.status_code}")

        content_type = response.headers.get("content-type", "")
        if "application/json" in content_type:
            return response.json()
        return response.content

    async def runtime_status(self) -> dict[str, Any]:
        try:
            payload = await self._request("GET", "/health")
            payload["backend"] = "remote"
            return payload
        except BrowserSessionError as exc:
            return {"ready": False, "error": str(exc), "backend": "remote"}

    async def create_session(self) -> dict[str, Any]:
        return await self._request("POST", "/sessions")

    async def list_sessions(self) -> list[dict[str, Any]]:
        return await self._request("GET", "/sessions")

    async def get_session_summary(self, session_id: str) -> dict[str, Any]:
        return await self._request("GET", f"/sessions/{session_id}")

    async def get_session_detail(self, session_id: str) -> dict[str, Any]:
        return await self._request("GET", f"/sessions/{session_id}")

    async def close_session(self, session_id: str) -> None:
        await self._request("DELETE", f"/sessions/{session_id}")

    async def navigate(self, session_id: str, url: str) -> dict[str, Any]:
        return await self._request("POST", f"/sessions/{session_id}/navigate", json={"url": url})

    async def reload(self, session_id: str) -> dict[str, Any]:
        return await self._request("POST", f"/sessions/{session_id}/reload")

    async def go_back(self, session_id: str) -> dict[str, Any]:
        return await self._request("POST", f"/sessions/{session_id}/back")

    async def go_forward(self, session_id: str) -> dict[str, Any]:
        return await self._request("POST", f"/sessions/{session_id}/forward")

    async def activate_tab(self, session_id: str, tab_id: str) -> dict[str, Any]:
        return await self._request(
            "POST",
            f"/sessions/{session_id}/activate-tab",
            json={"tab_id": tab_id},
        )

    async def create_tab(self, session_id: str) -> dict[str, Any]:
        return await self._request("POST", f"/sessions/{session_id}/tabs")

    async def close_tab(self, session_id: str, tab_id: str) -> dict[str, Any]:
        return await self._request("DELETE", f"/sessions/{session_id}/tabs/{tab_id}")

    async def focus_session(self, session_id: str) -> dict[str, Any]:
        return await self._request("POST", f"/sessions/{session_id}/focus")

    async def extract_text(
        self,
        session_id: str,
        selector: str | None = None,
        max_chars: int = 12000,
    ) -> dict[str, Any]:
        return await self._request(
            "POST",
            f"/sessions/{session_id}/extract",
            json={"selector": selector, "max_chars": max_chars},
        )

    async def screenshot(self, session_id: str) -> bytes:
        return await self._request("GET", f"/sessions/{session_id}/screenshot")

    async def export_storage_state(self, session_id: str) -> dict[str, Any]:
        return await self._request("GET", f"/sessions/{session_id}/storage-state")

    async def import_storage_state(self, session_id: str, state: Any) -> dict[str, Any]:
        return await self._request(
            "POST",
            f"/sessions/{session_id}/storage-state",
            json={"state": state},
        )

    async def import_cookie_header(
        self,
        session_id: str,
        site_url: str,
        cookie_header: str | None = None,
        cookie_json: Any | None = None,
    ) -> dict[str, Any]:
        return await self._request(
            "POST",
            f"/sessions/{session_id}/cookies",
            json={
                "site_url": site_url,
                "cookie_header": cookie_header,
                "cookie_json": cookie_json,
            },
        )

    async def request_human(
        self,
        session_id: str,
        reason: str,
        wait_for_resume: bool = True,
        timeout_ms: int = 600000,
    ) -> dict[str, Any]:
        return await self._request(
            "POST",
            f"/sessions/{session_id}/request-human",
            json={
                "reason": reason,
                "wait_for_resume": wait_for_resume,
                "timeout_ms": timeout_ms,
            },
        )

    async def resume(self, session_id: str) -> dict[str, Any]:
        return await self._request("POST", f"/sessions/{session_id}/resume")

    async def click(self, session_id: str, selector: str) -> str:
        payload = await self._request(
            "POST", f"/sessions/{session_id}/click", json={"selector": selector}
        )
        return str(payload.get("message", "Clicked page element."))

    async def click_at(self, session_id: str, x: float, y: float, button: str = "left") -> str:
        payload = await self._request(
            "POST",
            f"/sessions/{session_id}/click-at",
            json={"x": x, "y": y, "button": button},
        )
        return str(payload.get("message", "Clicked page coordinates."))

    async def mouse_down(self, session_id: str, x: float, y: float, button: str = "left") -> str:
        payload = await self._request(
            "POST",
            f"/sessions/{session_id}/mouse-down",
            json={"x": x, "y": y, "button": button},
        )
        return str(payload.get("message", "Mouse down sent."))

    async def mouse_move(self, session_id: str, x: float, y: float) -> str:
        payload = await self._request(
            "POST",
            f"/sessions/{session_id}/mouse-move",
            json={"x": x, "y": y},
        )
        return str(payload.get("message", "Mouse move sent."))

    async def mouse_up(self, session_id: str, x: float, y: float, button: str = "left") -> str:
        payload = await self._request(
            "POST",
            f"/sessions/{session_id}/mouse-up",
            json={"x": x, "y": y, "button": button},
        )
        return str(payload.get("message", "Mouse up sent."))

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
        payload = await self._request(
            "POST",
            f"/sessions/{session_id}/drag",
            json={
                "start_x": start_x,
                "start_y": start_y,
                "end_x": end_x,
                "end_y": end_y,
                "steps": steps,
                "duration_ms": duration_ms,
                "button": button,
            },
        )
        return str(payload.get("message", "Drag completed."))

    async def type(
        self,
        session_id: str,
        selector: str,
        text: str,
        press_enter: bool = False,
    ) -> str:
        payload = await self._request(
            "POST",
            f"/sessions/{session_id}/type",
            json={"selector": selector, "text": text, "press_enter": press_enter},
        )
        return str(payload.get("message", "Typed text into element."))

    async def press(self, session_id: str, key: str) -> str:
        payload = await self._request(
            "POST", f"/sessions/{session_id}/press", json={"key": key}
        )
        return str(payload.get("message", "Pressed key."))

    async def type_text(self, session_id: str, text: str) -> str:
        payload = await self._request(
            "POST", f"/sessions/{session_id}/type-text", json={"text": text}
        )
        return str(payload.get("message", "Sent text to focused element."))

    async def wheel(self, session_id: str, delta_x: float = 0, delta_y: float = 0) -> str:
        payload = await self._request(
            "POST",
            f"/sessions/{session_id}/wheel",
            json={"delta_x": delta_x, "delta_y": delta_y},
        )
        return str(payload.get("message", "Scrolled page."))

    async def wait_for(
        self,
        session_id: str,
        selector: str | None = None,
        timeout_ms: int = 10000,
    ) -> str:
        payload = await self._request(
            "POST",
            f"/sessions/{session_id}/wait-for",
            json={"selector": selector, "timeout_ms": timeout_ms},
        )
        return str(payload.get("message", "Wait completed."))

    async def get_state(self, session_id: str) -> str:
        payload = await self._request("GET", f"/sessions/{session_id}/state")
        return payload.get("state", "{}")


def get_browser_session_manager() -> BrowserSessionManager:
    return BrowserSessionManager.instance()
