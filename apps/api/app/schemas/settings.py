from typing import Any

from pydantic import BaseModel, Field


class UserSettingsUpdate(BaseModel):
    theme: str | None = None
    language: str | None = None


class UserSettingsResponse(BaseModel):
    user_id: str
    theme: str
    language: str

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
