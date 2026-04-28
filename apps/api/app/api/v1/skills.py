from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.core.app_registry import get_app_registry

router = APIRouter()


class UpdateSkillApiKeyRequest(BaseModel):
    api_key: str = ""


class SkillUpsertRequest(BaseModel):
    name: str
    description: str = ""
    content: str = ""
    enabled: bool = True


@router.get("")
async def list_skills():
    registry = get_app_registry()
    return registry.list_user_skills()


@router.get("/{skill_id}")
async def get_skill(skill_id: str):
    registry = get_app_registry()
    try:
        return registry.get_user_skill(skill_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/{skill_id}")
async def create_skill(skill_id: str, data: SkillUpsertRequest):
    registry = get_app_registry()
    try:
        return registry.upsert_user_skill(
            skill_id,
            name=data.name,
            description=data.description,
            content=data.content,
            enabled=data.enabled,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.put("/{skill_id}")
async def update_skill(skill_id: str, data: SkillUpsertRequest):
    registry = get_app_registry()
    try:
        return registry.upsert_user_skill(
            skill_id,
            name=data.name,
            description=data.description,
            content=data.content,
            enabled=data.enabled,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/{skill_id}")
async def delete_skill(skill_id: str):
    registry = get_app_registry()
    try:
        registry.delete_user_skill(skill_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"status": "deleted"}


@router.put("/{skill_id}/api-key")
async def update_skill_api_key(skill_id: str, data: UpdateSkillApiKeyRequest):
    registry = get_app_registry()
    try:
        return registry.update_user_skill_api_key(skill_id, data.api_key)
    except ValueError as exc:
        detail = str(exc)
        raise HTTPException(status_code=404 if "does not exist" in detail else 400, detail=detail) from exc
