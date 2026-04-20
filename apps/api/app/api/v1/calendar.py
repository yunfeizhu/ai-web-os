from __future__ import annotations

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.calendar import CalendarEvent

router = APIRouter()


class CalendarEventPayload(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    description: str | None = None
    location: str | None = None
    start_at: datetime
    end_at: datetime
    all_day: bool = False
    color: str = "#2563eb"
    tags: list[str] = Field(default_factory=list)


def _serialize_event(event: CalendarEvent) -> dict:
    return {
        "id": event.id,
        "title": event.title,
        "description": event.description or "",
        "location": event.location or "",
        "start_at": event.start_at.isoformat(),
        "end_at": event.end_at.isoformat(),
        "all_day": event.all_day,
        "color": event.color,
        "tags": event.tags or [],
        "created_at": event.created_at.isoformat(),
        "updated_at": event.updated_at.isoformat(),
    }


@router.get("/events")
async def list_events(
    start: datetime | None = Query(default=None),
    end: datetime | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(CalendarEvent).order_by(CalendarEvent.start_at.asc())
    if start is not None:
        stmt = stmt.where(CalendarEvent.end_at >= start)
    if end is not None:
        stmt = stmt.where(CalendarEvent.start_at <= end)
    result = await db.execute(stmt)
    return [_serialize_event(item) for item in result.scalars().all()]


@router.post("/events")
async def create_event(payload: CalendarEventPayload, db: AsyncSession = Depends(get_db)):
    if payload.end_at < payload.start_at:
        raise HTTPException(status_code=400, detail="end_at must be after start_at")
    event = CalendarEvent(id=str(uuid.uuid4()), **payload.model_dump())
    db.add(event)
    await db.flush()
    return _serialize_event(event)


@router.put("/events/{event_id}")
async def update_event(
    event_id: str,
    payload: CalendarEventPayload,
    db: AsyncSession = Depends(get_db),
):
    event = await db.get(CalendarEvent, event_id)
    if event is None:
        raise HTTPException(status_code=404, detail="Event not found")
    if payload.end_at < payload.start_at:
        raise HTTPException(status_code=400, detail="end_at must be after start_at")
    for key, value in payload.model_dump().items():
        setattr(event, key, value)
    await db.flush()
    return _serialize_event(event)


@router.delete("/events/{event_id}")
async def delete_event(event_id: str, db: AsyncSession = Depends(get_db)):
    event = await db.get(CalendarEvent, event_id)
    if event is None:
        raise HTTPException(status_code=404, detail="Event not found")
    await db.delete(event)
    return {"status": "deleted"}
