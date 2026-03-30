from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.models.user_settings import UserSettings
from app.models.desktop_layout import DesktopLayout
from app.schemas.settings import (
    UserSettingsUpdate,
    UserSettingsResponse,
    DesktopLayoutUpdate,
    DesktopLayoutResponse,
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
    """获取用户设置"""
    settings = await _get_or_create_settings(db)
    api_keys = settings.api_keys or {}
    return UserSettingsResponse(
        user_id=settings.user_id,
        theme=settings.theme,
        language=settings.language,
        default_model=settings.default_model,
        api_keys_configured={k: bool(v) for k, v in api_keys.items()},
    )


@router.put("", response_model=UserSettingsResponse)
async def update_settings(
    data: UserSettingsUpdate,
    db: AsyncSession = Depends(get_db),
):
    """更新用户设置"""
    settings = await _get_or_create_settings(db)

    if data.theme is not None:
        settings.theme = data.theme
    if data.language is not None:
        settings.language = data.language
    if data.default_model is not None:
        settings.default_model = data.default_model
    if data.api_keys is not None:
        # 合并（不覆盖未提交的 key）
        current = dict(settings.api_keys or {})
        current.update(data.api_keys)
        settings.api_keys = current

    api_keys = settings.api_keys or {}
    return UserSettingsResponse(
        user_id=settings.user_id,
        theme=settings.theme,
        language=settings.language,
        default_model=settings.default_model,
        api_keys_configured={k: bool(v) for k, v in api_keys.items()},
    )


@router.delete("/api-keys/{provider}")
async def delete_api_key(
    provider: str,
    db: AsyncSession = Depends(get_db),
):
    """删除指定提供商的 API Key"""
    settings = await _get_or_create_settings(db)
    keys = dict(settings.api_keys or {})
    if provider not in keys:
        raise HTTPException(status_code=404, detail=f"API key for '{provider}' not found")
    keys.pop(provider)
    settings.api_keys = keys
    return {"status": "ok"}


@router.get("/desktop", response_model=DesktopLayoutResponse)
async def get_desktop_layout(db: AsyncSession = Depends(get_db)):
    """获取桌面布局"""
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
    """更新桌面布局"""
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
