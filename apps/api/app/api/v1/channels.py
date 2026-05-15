"""External chat channel configuration API."""

from fastapi import APIRouter, HTTPException

from app.core.channel_config import (
    QQBotConfigResponse,
    QQBotConfigUpdate,
    load_qqbot_config_for_api,
    save_qqbot_config_from_api,
)
from app.core.channel_runtime import restart_qqbot_runtime, qqbot_runtime_status

router = APIRouter()


@router.get("/qqbot/config", response_model=QQBotConfigResponse)
async def get_qqbot_config():
    try:
        return load_qqbot_config_for_api()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.put("/qqbot/config", response_model=QQBotConfigResponse)
async def update_qqbot_config(data: QQBotConfigUpdate):
    try:
        return save_qqbot_config_from_api(data)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/qqbot/restart")
async def restart_qqbot():
    await restart_qqbot_runtime()
    return qqbot_runtime_status()


@router.get("/qqbot/status")
async def get_qqbot_status():
    return qqbot_runtime_status()
