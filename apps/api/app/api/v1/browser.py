from __future__ import annotations

import re
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.browser_persistence import (
    delete_login_profile,
    get_browser_session_record,
    list_browser_session_records,
    list_login_profiles,
    mark_browser_session_closed,
    save_login_profile,
    touch_login_profile,
    upsert_browser_session,
    upsert_browser_sessions,
)
from app.core.browser_session import BrowserSessionError, get_browser_session_manager
from app.core.database import get_db
from app.core.knowledge import get_knowledge_manager
from app.models.browser import BrowserLoginProfile, BrowserSessionRecord

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


class PressRequest(BaseModel):
    key: str = Field(..., min_length=1)


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


class RequestHumanRequest(BaseModel):
    reason: str = Field(..., min_length=1)
    wait_for_resume: bool = True
    timeout_ms: int = Field(default=600000, ge=1000, le=3600000)


class SaveLoginProfileRequest(BaseModel):
    label: str | None = None
    site_url: str | None = None


class ApplyLoginProfileRequest(BaseModel):
    profile_id: str = Field(..., min_length=1)


class SavePageToKnowledgeRequest(BaseModel):
    title: str | None = None
    max_chars: int = Field(default=12000, ge=1000, le=50000)


def _map_error(exc: BrowserSessionError) -> HTTPException:
    detail = str(exc)
    status_code = 400
    if "does not exist" in detail:
        status_code = 404
    elif "Browser runtime service is unreachable" in detail:
        status_code = 503
    return HTTPException(status_code=status_code, detail=detail)


def _serialize_login_profile(profile: BrowserLoginProfile) -> dict:
    return {
        "id": profile.id,
        "label": profile.label,
        "site_url": profile.site_url,
        "site_host": profile.site_host,
        "cookie_count": profile.cookie_count,
        "source_session_id": profile.source_session_id,
        "created_at": profile.created_at.isoformat(),
        "updated_at": profile.updated_at.isoformat(),
        "last_used_at": profile.last_used_at.isoformat() if profile.last_used_at else None,
    }


def _serialize_browser_session_record(record: BrowserSessionRecord) -> dict:
    return {
        "id": record.id,
        "status": record.status,
        "current_url": record.current_url,
        "current_title": record.current_title,
        "tab_count": record.tab_count,
        "takeover_reason": record.takeover_reason,
        "last_error": record.last_error,
        "action_log": record.action_log or [],
        "created_at": record.created_at.isoformat(),
        "updated_at": record.updated_at.isoformat(),
        "closed_at": record.closed_at.isoformat() if record.closed_at else None,
    }


def _clean_knowledge_title(raw_title: str, source_url: str = "", content: str = "") -> str:
    title = re.sub(r"\s+", " ", (raw_title or "").strip())
    host = (urlparse(source_url).hostname or "").strip().lower()

    if title:
        title = re.sub(
            r"^[\(\[（【]?\s*\d+[^)\]）】]{0,40}(私信|消息|通知|提醒|评论|回复|未读)[^)\]）】]*[\)\]）】]?\s*",
            "",
            title,
            flags=re.IGNORECASE,
        )
        title = re.sub(r"^[\(\[（【][^)\]）】]{0,40}[\)\]）】]\s*", "", title)

        parts = re.split(r"\s*[-|｜_·•]+\s*", title)
        host_tokens = [
            token
            for token in host.split(".")
            if token and token not in {"www", "com", "cn", "net", "org"}
        ]
        filtered_parts: list[str] = []

        for index, part in enumerate(parts):
            cleaned_part = part.strip()
            if not cleaned_part:
                continue

            normalized = cleaned_part.lower()
            is_last = index == len(parts) - 1
            if host and normalized in {host, f"www.{host}"}:
                continue
            if is_last and host_tokens and any(token in normalized for token in host_tokens):
                continue

            filtered_parts.append(cleaned_part)

        if filtered_parts:
            title = " - ".join(filtered_parts)

        title = re.sub(r"\s+", " ", title).strip(" -|｜_·•,，:：;；")

    if len(title) < 6 and content.strip():
        for line in content.splitlines():
            candidate = re.sub(r"\s+", " ", line).strip(" -|｜_·•,，:：;；")
            if len(candidate) >= 6:
                title = candidate
                break

    if not title:
        title = "网页内容"

    if len(title) > 36:
        for delimiter in ("｜", "|", " - ", "：", ":", "，", ",", "。"):
            head = title.split(delimiter, 1)[0].strip()
            if 6 <= len(head) <= 30:
                title = head
                break

    if len(title) > 36:
        title = f"{title[:35].rstrip()}…"

    return title


@router.get("/runtime")
async def browser_runtime():
    return await get_browser_session_manager().runtime_status()


@router.get("/sessions")
async def list_sessions(db: AsyncSession = Depends(get_db)):
    manager = get_browser_session_manager()
    try:
        details = await manager.list_sessions()
        await upsert_browser_sessions(db, details)
        return details
    except BrowserSessionError as exc:
        raise _map_error(exc) from exc


@router.post("/sessions")
async def create_session(db: AsyncSession = Depends(get_db)):
    manager = get_browser_session_manager()
    try:
        detail = await manager.create_session()
        await upsert_browser_session(db, detail)
        return detail
    except BrowserSessionError as exc:
        raise _map_error(exc) from exc


@router.get("/sessions/{session_id}")
async def get_session(session_id: str, db: AsyncSession = Depends(get_db)):
    manager = get_browser_session_manager()
    try:
        detail = await manager.get_session_detail(session_id)
        await upsert_browser_session(db, detail)
        return detail
    except BrowserSessionError as exc:
        raise _map_error(exc) from exc


@router.delete("/sessions/{session_id}")
async def close_session(session_id: str, db: AsyncSession = Depends(get_db)):
    manager = get_browser_session_manager()
    try:
        await manager.close_session(session_id)
        await mark_browser_session_closed(db, session_id)
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
async def import_storage_state(
    session_id: str,
    req: StorageStateRequest,
    db: AsyncSession = Depends(get_db),
):
    manager = get_browser_session_manager()
    try:
        detail = await manager.import_storage_state(session_id, req.state)
        await upsert_browser_session(db, detail)
        return detail
    except BrowserSessionError as exc:
        raise _map_error(exc) from exc


@router.post("/sessions/{session_id}/cookies")
async def import_cookie_header(
    session_id: str,
    req: CookieImportRequest,
    db: AsyncSession = Depends(get_db),
):
    manager = get_browser_session_manager()
    try:
        detail = await manager.import_cookie_header(
            session_id,
            req.site_url,
            req.cookie_header,
            req.cookie_json,
        )
        await upsert_browser_session(db, detail)
        return detail
    except BrowserSessionError as exc:
        raise _map_error(exc) from exc


@router.post("/sessions/{session_id}/request-human")
async def request_human(
    session_id: str,
    req: RequestHumanRequest,
    db: AsyncSession = Depends(get_db),
):
    manager = get_browser_session_manager()
    try:
        detail = await manager.request_human(
            session_id,
            req.reason,
            req.wait_for_resume,
            req.timeout_ms,
        )
        await upsert_browser_session(db, detail)
        return detail
    except BrowserSessionError as exc:
        raise _map_error(exc) from exc


@router.post("/sessions/{session_id}/resume")
async def resume_ai(session_id: str, db: AsyncSession = Depends(get_db)):
    manager = get_browser_session_manager()
    try:
        detail = await manager.resume(session_id)
        await upsert_browser_session(db, detail)
        return detail
    except BrowserSessionError as exc:
        raise _map_error(exc) from exc


@router.get("/profiles")
async def get_login_profiles(
    site_url: str | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
):
    site_host = None
    if site_url:
        site_host = (urlparse(site_url).hostname or "").lower() or None
    profiles = await list_login_profiles(db, site_host)
    return [_serialize_login_profile(profile) for profile in profiles]


@router.delete("/profiles/{profile_id}")
async def remove_login_profile(profile_id: str, db: AsyncSession = Depends(get_db)):
    deleted = await delete_login_profile(db, profile_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="登录态资料不存在。")
    return {"status": "ok"}


@router.get("/history-sessions")
async def get_history_sessions(
    limit: int = Query(default=40, ge=1, le=200),
    status: str | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
):
    records = await list_browser_session_records(db, limit=limit, status=status)
    return [_serialize_browser_session_record(record) for record in records]


@router.get("/history-sessions/{session_id}")
async def get_history_session(session_id: str, db: AsyncSession = Depends(get_db)):
    record = await get_browser_session_record(db, session_id)
    if record is None:
        raise HTTPException(status_code=404, detail="历史会话不存在。")
    return _serialize_browser_session_record(record)


@router.post("/sessions/{session_id}/profiles")
async def save_current_login_profile(
    session_id: str,
    req: SaveLoginProfileRequest,
    db: AsyncSession = Depends(get_db),
):
    manager = get_browser_session_manager()
    try:
        detail = await manager.get_session_detail(session_id)
        state = await manager.export_storage_state(session_id)
    except BrowserSessionError as exc:
        raise _map_error(exc) from exc

    site_url = req.site_url or detail.get("current_url") or ""
    if not site_url or site_url == "about:blank":
        raise HTTPException(status_code=400, detail="当前页面还没有可保存的站点地址。")

    label = (req.label or detail.get("current_title") or site_url).strip()
    profile = await save_login_profile(
        db,
        label=label,
        site_url=site_url,
        storage_state=state,
        source_session_id=session_id,
    )
    await upsert_browser_session(db, detail)
    return _serialize_login_profile(profile)


@router.post("/sessions/{session_id}/profiles/apply")
async def apply_login_profile(
    session_id: str,
    req: ApplyLoginProfileRequest,
    db: AsyncSession = Depends(get_db),
):
    profile = await db.get(BrowserLoginProfile, req.profile_id)
    if profile is None:
        raise HTTPException(status_code=404, detail="登录态资料不存在。")

    manager = get_browser_session_manager()
    try:
        detail = await manager.import_storage_state(session_id, profile.storage_state)
        target_url = (profile.site_url or "").strip()
        if target_url and detail.get("current_url") != target_url:
            detail = await manager.navigate(session_id, target_url)
    except BrowserSessionError as exc:
        raise _map_error(exc) from exc

    await touch_login_profile(db, profile)
    await upsert_browser_session(db, detail)
    return {
        "profile": _serialize_login_profile(profile),
        "session": detail,
    }


@router.post("/sessions/{session_id}/save-page")
async def save_page_to_knowledge(
    session_id: str,
    req: SavePageToKnowledgeRequest,
    db: AsyncSession = Depends(get_db),
):
    knowledge_manager = get_knowledge_manager()
    if not knowledge_manager:
        raise HTTPException(status_code=400, detail="知识库未初始化，请先完成知识库初始化。")

    browser_manager = get_browser_session_manager()
    try:
        detail = await browser_manager.get_session_detail(session_id)
        page = await browser_manager.extract_text(
            session_id,
            selector=None,
            max_chars=req.max_chars,
        )
    except BrowserSessionError as exc:
        raise _map_error(exc) from exc

    title = (req.title or page.get("title") or detail.get("current_title") or "网页内容").strip()
    content = str(page.get("content") or "").strip()
    if not content:
        raise HTTPException(status_code=400, detail="当前页面没有可保存的正文内容。")

    source_url = str(page.get("url") or detail.get("current_url") or "").strip()
    title = _clean_knowledge_title(title, source_url=source_url, content=content)

    doc_id, document = await knowledge_manager.create_document(
        title=title,
        content=content,
        source_type="text",
        source_url=source_url,
        db=db,
    )
    await knowledge_manager.enqueue_document_processing(
        doc_id=doc_id,
        title=title,
        content=content,
    )
    await upsert_browser_session(db, detail)
    return {
        "id": document.id,
        "title": document.title,
        "status": document.status,
        "source_url": document.source_url,
    }


@router.post("/sessions/{session_id}/navigate")
async def navigate(
    session_id: str,
    req: NavigateRequest,
    db: AsyncSession = Depends(get_db),
):
    manager = get_browser_session_manager()
    try:
        detail = await manager.navigate(session_id, req.url)
        await upsert_browser_session(db, detail)
        return detail
    except BrowserSessionError as exc:
        raise _map_error(exc) from exc


@router.post("/sessions/{session_id}/reload")
async def reload_page(session_id: str, db: AsyncSession = Depends(get_db)):
    manager = get_browser_session_manager()
    try:
        detail = await manager.reload(session_id)
        await upsert_browser_session(db, detail)
        return detail
    except BrowserSessionError as exc:
        raise _map_error(exc) from exc


@router.post("/sessions/{session_id}/back")
async def go_back(session_id: str, db: AsyncSession = Depends(get_db)):
    manager = get_browser_session_manager()
    try:
        detail = await manager.go_back(session_id)
        await upsert_browser_session(db, detail)
        return detail
    except BrowserSessionError as exc:
        raise _map_error(exc) from exc


@router.post("/sessions/{session_id}/forward")
async def go_forward(session_id: str, db: AsyncSession = Depends(get_db)):
    manager = get_browser_session_manager()
    try:
        detail = await manager.go_forward(session_id)
        await upsert_browser_session(db, detail)
        return detail
    except BrowserSessionError as exc:
        raise _map_error(exc) from exc


@router.post("/sessions/{session_id}/activate-tab")
async def activate_tab(
    session_id: str,
    req: SwitchTabRequest,
    db: AsyncSession = Depends(get_db),
):
    manager = get_browser_session_manager()
    try:
        detail = await manager.activate_tab(session_id, req.tab_id)
        await upsert_browser_session(db, detail)
        return detail
    except BrowserSessionError as exc:
        raise _map_error(exc) from exc


@router.post("/sessions/{session_id}/tabs")
async def create_tab(session_id: str, db: AsyncSession = Depends(get_db)):
    manager = get_browser_session_manager()
    try:
        detail = await manager.create_tab(session_id)
        await upsert_browser_session(db, detail)
        return detail
    except BrowserSessionError as exc:
        raise _map_error(exc) from exc


@router.delete("/sessions/{session_id}/tabs/{tab_id}")
async def close_tab(session_id: str, tab_id: str, db: AsyncSession = Depends(get_db)):
    manager = get_browser_session_manager()
    try:
        detail = await manager.close_tab(session_id, tab_id)
        await upsert_browser_session(db, detail)
        return detail
    except BrowserSessionError as exc:
        raise _map_error(exc) from exc


@router.post("/sessions/{session_id}/focus")
async def focus_session(session_id: str, db: AsyncSession = Depends(get_db)):
    manager = get_browser_session_manager()
    try:
        detail = await manager.focus_session(session_id)
        await upsert_browser_session(db, detail)
        return detail
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
async def type_text_to_focus(session_id: str, req: TypeTextRequest):
    manager = get_browser_session_manager()
    try:
        return {"message": await manager.type_text(session_id, req.text)}
    except BrowserSessionError as exc:
        raise _map_error(exc) from exc


@router.post("/sessions/{session_id}/click")
async def click_page_element(session_id: str, req: ClickRequest):
    manager = get_browser_session_manager()
    try:
        return {"message": await manager.click(session_id, req.selector)}
    except BrowserSessionError as exc:
        raise _map_error(exc) from exc


@router.post("/sessions/{session_id}/type")
async def type_into_element(session_id: str, req: TypeRequest):
    manager = get_browser_session_manager()
    try:
        return {
            "message": await manager.type(
                session_id,
                req.selector,
                req.text,
                req.press_enter,
            )
        }
    except BrowserSessionError as exc:
        raise _map_error(exc) from exc


@router.post("/sessions/{session_id}/press")
async def press_key(session_id: str, req: PressRequest):
    manager = get_browser_session_manager()
    try:
        return {"message": await manager.press(session_id, req.key)}
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
