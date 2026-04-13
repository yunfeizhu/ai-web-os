from pydantic import BaseModel, Field
from typing import Any


class UserSettingsUpdate(BaseModel):
    theme: str | None = None
    language: str | None = None
    api_keys: dict[str, str] | None = None
    default_model: str | None = None


class UserSettingsResponse(BaseModel):
    user_id: str
    theme: str
    language: str
    default_model: str
    # api_keys 不在响应中返回完整 key，只返回是否已配置
    api_keys_configured: dict[str, bool]

    model_config = {"from_attributes": True}


class DesktopIconItem(BaseModel):
    app_id: str = Field()
    x: int
    y: int


class DesktopLayoutUpdate(BaseModel):
    icons: list[dict[str, Any]] | None = None
    taskbar_pins: list[str] | None = None
    wallpaper: str | None = None
    theme: str | None = None


class DesktopLayoutResponse(BaseModel):
    user_id: str
    icons: list[dict[str, Any]]
    taskbar_pins: list[str]
    wallpaper: str
    theme: str

    model_config = {"from_attributes": True}
