from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.extension_registry import list_extension_summaries

router = APIRouter()


@router.get("")
async def list_extensions(db: AsyncSession = Depends(get_db)):
    return await list_extension_summaries(db)
