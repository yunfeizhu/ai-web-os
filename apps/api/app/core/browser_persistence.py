from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlparse

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.browser import BrowserLoginProfile, BrowserSessionRecord


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _host_matches(cookie_domain: str, host: str) -> bool:
    normalized_domain = cookie_domain.lstrip(".").lower()
    normalized_host = host.lower()
    return normalized_host == normalized_domain or normalized_host.endswith(f".{normalized_domain}")


def filter_storage_state_for_site(state: dict[str, Any], site_url: str) -> dict[str, Any]:
    parsed = urlparse(site_url)
    host = (parsed.hostname or "").lower()
    if not host:
        return {"cookies": list(state.get("cookies", [])), "origins": list(state.get("origins", []))}

    cookies = []
    for cookie in state.get("cookies", []):
        if not isinstance(cookie, dict):
            continue
        domain = str(cookie.get("domain", "")).strip()
        if domain and _host_matches(domain, host):
            cookies.append(cookie)

    origins = []
    for origin in state.get("origins", []):
        if not isinstance(origin, dict):
            continue
        origin_url = str(origin.get("origin", "")).strip()
        origin_host = (urlparse(origin_url).hostname or "").lower()
        if origin_host and _host_matches(origin_host, host):
            origins.append(origin)

    return {"cookies": cookies, "origins": origins}


async def upsert_browser_session(db: AsyncSession, detail: dict[str, Any]) -> BrowserSessionRecord:
    session_id = str(detail.get("id", "")).strip()
    if not session_id:
        raise ValueError("Browser session detail is missing id.")

    record = await db.get(BrowserSessionRecord, session_id)
    if record is None:
        record = BrowserSessionRecord(id=session_id)
        db.add(record)

    record.status = str(detail.get("status") or "active")
    record.current_url = str(detail.get("current_url") or "about:blank")
    record.current_title = str(detail.get("current_title") or "")
    record.tab_count = int(detail.get("tab_count") or 0)
    record.takeover_reason = (
        str(detail.get("takeover_reason")).strip()
        if detail.get("takeover_reason") is not None
        else None
    )
    record.last_error = (
        str(detail.get("last_error")).strip()
        if detail.get("last_error") is not None
        else None
    )
    record.action_log = detail.get("action_log") if isinstance(detail.get("action_log"), list) else []
    record.closed_at = None
    if created_at := detail.get("created_at"):
        try:
            record.created_at = datetime.fromisoformat(str(created_at))
        except ValueError:
            pass
    record.updated_at = _utc_now()
    await db.flush()
    return record


async def upsert_browser_sessions(db: AsyncSession, details: list[dict[str, Any]]) -> None:
    for detail in details:
        await upsert_browser_session(db, detail)
    await db.flush()


async def mark_browser_session_closed(db: AsyncSession, session_id: str) -> None:
    record = await db.get(BrowserSessionRecord, session_id)
    if record is None:
        return
    record.status = "closed"
    record.closed_at = _utc_now()
    record.updated_at = _utc_now()
    await db.flush()


async def save_login_profile(
    db: AsyncSession,
    *,
    label: str,
    site_url: str,
    storage_state: dict[str, Any],
    source_session_id: str | None = None,
) -> BrowserLoginProfile:
    filtered_state = filter_storage_state_for_site(storage_state, site_url)
    host = (urlparse(site_url).hostname or "").lower()
    profile = BrowserLoginProfile(
        id=str(uuid.uuid4()),
        label=label.strip(),
        site_url=site_url,
        site_host=host,
        source_session_id=source_session_id,
        cookie_count=len(filtered_state.get("cookies", [])),
        storage_state=filtered_state,
    )
    db.add(profile)
    await db.flush()
    return profile


async def list_login_profiles(
    db: AsyncSession,
    site_host: str | None = None,
) -> list[BrowserLoginProfile]:
    stmt = select(BrowserLoginProfile).order_by(BrowserLoginProfile.updated_at.desc())
    if site_host:
        stmt = stmt.where(BrowserLoginProfile.site_host == site_host.lower())
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def delete_login_profile(db: AsyncSession, profile_id: str) -> bool:
    profile = await db.get(BrowserLoginProfile, profile_id)
    if profile is None:
        return False
    await db.delete(profile)
    await db.flush()
    return True


async def list_browser_session_records(
    db: AsyncSession,
    *,
    limit: int = 40,
    status: str | None = None,
) -> list[BrowserSessionRecord]:
    stmt = select(BrowserSessionRecord).order_by(BrowserSessionRecord.updated_at.desc()).limit(limit)
    if status:
        stmt = stmt.where(BrowserSessionRecord.status == status)
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def get_browser_session_record(
    db: AsyncSession,
    session_id: str,
) -> BrowserSessionRecord | None:
    return await db.get(BrowserSessionRecord, session_id)


async def touch_login_profile(db: AsyncSession, profile: BrowserLoginProfile) -> BrowserLoginProfile:
    profile.last_used_at = _utc_now()
    profile.updated_at = _utc_now()
    await db.flush()
    return profile
