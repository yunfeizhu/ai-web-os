from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.desktop_layout import DesktopLayout
from app.models.user_settings import UserSettings
from app.schemas.settings import (
    DesktopLayoutResponse,
    DesktopLayoutUpdate,
    UserSettingsResponse,
    UserSettingsUpdate,
)

router = APIRouter()

DEFAULT_USER_ID = "default"


async def _get_or_create_settings(db: AsyncSession) -> UserSettings:
    result = await db.execute(
        select(UserSettings).where(UserSettings.user_id == DEFAULT_USER_ID)
    )
    settings = result.scalar_one_or_none()
    if settings is None:
        settings = UserSettings(user_id=DEFAULT_USER_ID)
        db.add(settings)
        await db.flush()
    return settings


async def _get_or_create_layout(db: AsyncSession) -> DesktopLayout:
    result = await db.execute(
        select(DesktopLayout).where(DesktopLayout.user_id == DEFAULT_USER_ID)
    )
    layout = result.scalar_one_or_none()
    if layout is None:
        layout = DesktopLayout(user_id=DEFAULT_USER_ID)
        db.add(layout)
        await db.flush()
    return layout


@router.get("", response_model=UserSettingsResponse)
async def get_settings(db: AsyncSession = Depends(get_db)):
    """Return non-sensitive user preferences only."""
    settings = await _get_or_create_settings(db)
    return UserSettingsResponse(
        user_id=settings.user_id,
        theme=settings.theme,
        language=settings.language,
    )


@router.put("", response_model=UserSettingsResponse)
async def update_settings(
    data: UserSettingsUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Persist only lightweight UI settings."""
    settings = await _get_or_create_settings(db)

    if data.theme is not None:
        settings.theme = data.theme
    if data.language is not None:
        settings.language = data.language

    return UserSettingsResponse(
        user_id=settings.user_id,
        theme=settings.theme,
        language=settings.language,
    )


@router.get("/desktop", response_model=DesktopLayoutResponse)
async def get_desktop_layout(db: AsyncSession = Depends(get_db)):
    """Return desktop layout settings."""
    layout = await _get_or_create_layout(db)
    return DesktopLayoutResponse(
        user_id=layout.user_id,
        icons=layout.icons or [],
        taskbar_pins=layout.taskbar_pins or [],
        wallpaper=layout.wallpaper or "",
        theme=layout.theme,
    )


@router.put("/desktop", response_model=DesktopLayoutResponse)
async def update_desktop_layout(
    data: DesktopLayoutUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Persist desktop layout settings."""
    layout = await _get_or_create_layout(db)

    if data.icons is not None:
        layout.icons = data.icons
    if data.taskbar_pins is not None:
        layout.taskbar_pins = data.taskbar_pins
    if data.wallpaper is not None:
        layout.wallpaper = data.wallpaper
    if data.theme is not None:
        layout.theme = data.theme

    return DesktopLayoutResponse(
        user_id=layout.user_id,
        icons=layout.icons or [],
        taskbar_pins=layout.taskbar_pins or [],
        wallpaper=layout.wallpaper or "",
        theme=layout.theme,
    )
