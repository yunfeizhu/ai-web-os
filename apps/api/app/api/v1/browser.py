from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field

from app.core.browser_session import BrowserSessionError, get_browser_session_manager

router = APIRouter()


class NavigateRequest(BaseModel):
    url: str = Field(..., min_length=1)


class ExtractRequest(BaseModel):
    selector: str | None = None
    max_chars: int = Field(default=12000, ge=1000, le=50000)


class SwitchTabRequest(BaseModel):
    tab_id: str = Field(..., min_length=1)


class ClickAtRequest(BaseModel):
    x: float = Field(..., ge=0)
    y: float = Field(..., ge=0)
    button: str = "left"


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
    button: str = "left"


class TypeTextRequest(BaseModel):
    text: str = ""


class ClickRequest(BaseModel):
    selector: str = Field(..., min_length=1)


class TypeRequest(BaseModel):
    selector: str = Field(..., min_length=1)
    text: str = ""
    press_enter: bool = False


class WaitRequest(BaseModel):
    selector: str | None = None
    timeout_ms: int = Field(default=10000, ge=100, le=60000)


class WheelRequest(BaseModel):
    delta_x: float = 0
    delta_y: float = 0


class StorageStateRequest(BaseModel):
    state: dict | list = Field(default_factory=dict)


class CookieImportRequest(BaseModel):
    site_url: str = Field(..., min_length=1)
    cookie_header: str | None = None
    cookie_json: dict | list | None = None


def _map_error(exc: BrowserSessionError) -> HTTPException:
    detail = str(exc)
    status_code = 400
    if "不存在" in detail:
        status_code = 404
    elif "依赖 Playwright" in detail or "安装 Chromium" in detail or "尚未就绪" in detail:
        status_code = 503
    return HTTPException(status_code=status_code, detail=detail)


@router.get("/runtime")
async def browser_runtime():
    return await get_browser_session_manager().runtime_status()


@router.get("/sessions")
async def list_sessions():
    manager = get_browser_session_manager()
    try:
        return await manager.list_sessions()
    except BrowserSessionError as exc:
        raise _map_error(exc) from exc


@router.post("/sessions")
async def create_session():
    manager = get_browser_session_manager()
    try:
        return await manager.create_session()
    except BrowserSessionError as exc:
        raise _map_error(exc) from exc


@router.get("/sessions/{session_id}")
async def get_session(session_id: str):
    manager = get_browser_session_manager()
    try:
        return await manager.get_session_detail(session_id)
    except BrowserSessionError as exc:
        raise _map_error(exc) from exc


@router.delete("/sessions/{session_id}")
async def close_session(session_id: str):
    manager = get_browser_session_manager()
    try:
        await manager.close_session(session_id)
        return {"status": "ok"}
    except BrowserSessionError as exc:
        raise _map_error(exc) from exc


@router.get("/sessions/{session_id}/storage-state")
async def export_storage_state(session_id: str):
    manager = get_browser_session_manager()
    try:
        return await manager.export_storage_state(session_id)
    except BrowserSessionError as exc:
        raise _map_error(exc) from exc


@router.post("/sessions/{session_id}/storage-state")
async def import_storage_state(session_id: str, req: StorageStateRequest):
    manager = get_browser_session_manager()
    try:
        return await manager.import_storage_state(session_id, req.state)
    except BrowserSessionError as exc:
        raise _map_error(exc) from exc


@router.post("/sessions/{session_id}/cookies")
async def import_cookie_header(session_id: str, req: CookieImportRequest):
    manager = get_browser_session_manager()
    try:
        return await manager.import_cookie_header(
            session_id,
            req.site_url,
            req.cookie_header,
            req.cookie_json,
        )
    except BrowserSessionError as exc:
        raise _map_error(exc) from exc


@router.post("/sessions/{session_id}/navigate")
async def navigate(session_id: str, req: NavigateRequest):
    manager = get_browser_session_manager()
    try:
        return await manager.navigate(session_id, req.url)
    except BrowserSessionError as exc:
        raise _map_error(exc) from exc


@router.post("/sessions/{session_id}/reload")
async def reload_page(session_id: str):
    manager = get_browser_session_manager()
    try:
        return await manager.reload(session_id)
    except BrowserSessionError as exc:
        raise _map_error(exc) from exc


@router.post("/sessions/{session_id}/back")
async def go_back(session_id: str):
    manager = get_browser_session_manager()
    try:
        return await manager.go_back(session_id)
    except BrowserSessionError as exc:
        raise _map_error(exc) from exc


@router.post("/sessions/{session_id}/forward")
async def go_forward(session_id: str):
    manager = get_browser_session_manager()
    try:
        return await manager.go_forward(session_id)
    except BrowserSessionError as exc:
        raise _map_error(exc) from exc


@router.post("/sessions/{session_id}/activate-tab")
async def activate_tab(session_id: str, req: SwitchTabRequest):
    manager = get_browser_session_manager()
    try:
        return await manager.activate_tab(session_id, req.tab_id)
    except BrowserSessionError as exc:
        raise _map_error(exc) from exc


@router.post("/sessions/{session_id}/tabs")
async def create_tab(session_id: str):
    manager = get_browser_session_manager()
    try:
        return await manager.create_tab(session_id)
    except BrowserSessionError as exc:
        raise _map_error(exc) from exc


@router.delete("/sessions/{session_id}/tabs/{tab_id}")
async def close_tab(session_id: str, tab_id: str):
    manager = get_browser_session_manager()
    try:
        return await manager.close_tab(session_id, tab_id)
    except BrowserSessionError as exc:
        raise _map_error(exc) from exc


@router.post("/sessions/{session_id}/focus")
async def focus_session(session_id: str):
    manager = get_browser_session_manager()
    try:
        return await manager.focus_session(session_id)
    except BrowserSessionError as exc:
        raise _map_error(exc) from exc


@router.post("/sessions/{session_id}/extract")
async def extract_page_text(session_id: str, req: ExtractRequest):
    manager = get_browser_session_manager()
    try:
        return await manager.extract_text(session_id, selector=req.selector, max_chars=req.max_chars)
    except BrowserSessionError as exc:
        raise _map_error(exc) from exc


@router.get("/sessions/{session_id}/screenshot")
async def get_screenshot(session_id: str, _: str | None = Query(default=None)):
    manager = get_browser_session_manager()
    try:
        image = await manager.screenshot(session_id)
    except BrowserSessionError as exc:
        raise _map_error(exc) from exc

    return Response(
        content=image,
        media_type="image/png",
        headers={"Cache-Control": "no-store, no-cache, must-revalidate"},
    )


@router.post("/sessions/{session_id}/click-at")
async def click_at(session_id: str, req: ClickAtRequest):
    manager = get_browser_session_manager()
    try:
        return {"message": await manager.click_at(session_id, req.x, req.y, req.button)}
    except BrowserSessionError as exc:
        raise _map_error(exc) from exc


@router.post("/sessions/{session_id}/mouse-down")
async def mouse_down(session_id: str, req: ClickAtRequest):
    manager = get_browser_session_manager()
    try:
        return {"message": await manager.mouse_down(session_id, req.x, req.y, req.button)}
    except BrowserSessionError as exc:
        raise _map_error(exc) from exc


@router.post("/sessions/{session_id}/mouse-move")
async def mouse_move(session_id: str, req: MouseMoveRequest):
    manager = get_browser_session_manager()
    try:
        return {"message": await manager.mouse_move(session_id, req.x, req.y)}
    except BrowserSessionError as exc:
        raise _map_error(exc) from exc


@router.post("/sessions/{session_id}/mouse-up")
async def mouse_up(session_id: str, req: ClickAtRequest):
    manager = get_browser_session_manager()
    try:
        return {"message": await manager.mouse_up(session_id, req.x, req.y, req.button)}
    except BrowserSessionError as exc:
        raise _map_error(exc) from exc


@router.post("/sessions/{session_id}/drag")
async def drag(session_id: str, req: DragRequest):
    manager = get_browser_session_manager()
    try:
        return {
            "message": await manager.drag(
                session_id,
                req.start_x,
                req.start_y,
                req.end_x,
                req.end_y,
                req.steps,
                req.duration_ms,
                req.button,
            )
        }
    except BrowserSessionError as exc:
        raise _map_error(exc) from exc


@router.post("/sessions/{session_id}/type-text")
async def type_text(session_id: str, req: TypeTextRequest):
    manager = get_browser_session_manager()
    try:
        return {"message": await manager.type_text(session_id, req.text)}
    except BrowserSessionError as exc:
        raise _map_error(exc) from exc


@router.post("/sessions/{session_id}/click")
async def click(session_id: str, req: ClickRequest):
    manager = get_browser_session_manager()
    try:
        return {"message": await manager.click(session_id, req.selector)}
    except BrowserSessionError as exc:
        raise _map_error(exc) from exc


@router.post("/sessions/{session_id}/type")
async def type_into_selector(session_id: str, req: TypeRequest):
    manager = get_browser_session_manager()
    try:
        return {"message": await manager.type(session_id, req.selector, req.text, req.press_enter)}
    except BrowserSessionError as exc:
        raise _map_error(exc) from exc


@router.post("/sessions/{session_id}/press")
async def press_key(session_id: str, req: dict):
    manager = get_browser_session_manager()
    try:
        return {"message": await manager.press(session_id, str(req.get("key", "")))}
    except BrowserSessionError as exc:
        raise _map_error(exc) from exc


@router.post("/sessions/{session_id}/wheel")
async def wheel(session_id: str, req: WheelRequest):
    manager = get_browser_session_manager()
    try:
        return {"message": await manager.wheel(session_id, req.delta_x, req.delta_y)}
    except BrowserSessionError as exc:
        raise _map_error(exc) from exc


@router.post("/sessions/{session_id}/wait-for")
async def wait_for(session_id: str, req: WaitRequest):
    manager = get_browser_session_manager()
    try:
        return {"message": await manager.wait_for(session_id, req.selector, req.timeout_ms)}
    except BrowserSessionError as exc:
        raise _map_error(exc) from exc


@router.get("/sessions/{session_id}/state")
async def get_state(session_id: str):
    manager = get_browser_session_manager()
    try:
        return {"state": await manager.get_state(session_id)}
    except BrowserSessionError as exc:
        raise _map_error(exc) from exc
