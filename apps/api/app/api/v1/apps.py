from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.app_registry import ManagedAppRecord, get_app_registry
from app.core.database import get_db
router = APIRouter()


class InstallAppRequest(BaseModel):
    manifest: dict
    enabled: bool = True


class UpdateAppRequest(BaseModel):
    enabled: bool | None = None
    settings: dict | None = None
    manifest: dict | None = None


class ToolInvokeRequest(BaseModel):
    arguments: dict = {}


def serialize_app(app: ManagedAppRecord | object, runtime: dict) -> dict:
    manifest = app.manifest or {}
    return {
        "id": app.id,
        "name": app.name,
        "version": app.version,
        "description": app.description,
        "status": runtime.get("status", app.status),
        "enabled": app.enabled,
        "is_builtin": app.is_builtin,
        "settings": app.settings or {},
        "manifest": manifest,
        "skill": manifest.get("skill"),
        "tools": manifest.get("tools", []),
        "permissions": manifest.get("permissions", []),
        "runtime": runtime,
        "last_error": app.last_error,
    }


@router.get("")
async def list_apps(db: AsyncSession = Depends(get_db)):
    registry = get_app_registry()
    apps = await registry.list_apps(db)
    return [serialize_app(app, registry.runtime_status(app.id)) for app in apps]


@router.post("/rescan")
async def rescan_apps(db: AsyncSession = Depends(get_db)):
    registry = get_app_registry()
    apps = await registry.list_apps(db)
    return {"status": "ok", "count": len(apps)}


@router.post("/install")
async def install_app(data: InstallAppRequest, db: AsyncSession = Depends(get_db)):
    manifest = data.manifest
    app_id = manifest.get("id")
    if not app_id:
        raise HTTPException(status_code=400, detail="manifest.id is required")
    registry = get_app_registry()
    try:
        app = await registry.install_external_app(db, manifest, data.enabled)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return serialize_app(app, registry.runtime_status(app.id))


@router.delete("/{app_id}")
async def uninstall_app(app_id: str, db: AsyncSession = Depends(get_db)):
    registry = get_app_registry()
    try:
        await registry.remove_app(db, app_id)
    except ValueError as exc:
        detail = str(exc)
        raise HTTPException(status_code=404 if "does not exist" in detail else 400, detail=detail) from exc
    return {"status": "deleted"}


@router.put("/{app_id}")
async def update_app(app_id: str, data: UpdateAppRequest, db: AsyncSession = Depends(get_db)):
    registry = get_app_registry()
    app = await registry.get_app(db, app_id)
    if app is None:
        raise HTTPException(status_code=404, detail="App not found")

    if data.manifest is not None:
        try:
            app = await registry.update_external_manifest(db, app_id, dict(data.manifest))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc

    if data.enabled is not None:
        try:
            app = await registry.set_enabled(db, app_id, data.enabled)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc
    if data.settings is not None:
        try:
            app = await registry.update_app_settings(db, app_id, data.settings)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc

    return serialize_app(app, registry.runtime_status(app_id))


@router.post("/{app_id}/activate")
async def activate_app(app_id: str, db: AsyncSession = Depends(get_db)):
    registry = get_app_registry()
    try:
        app = await registry.activate_app(db, app_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return serialize_app(app, registry.runtime_status(app_id))


@router.post("/{app_id}/deactivate")
async def deactivate_app(app_id: str, db: AsyncSession = Depends(get_db)):
    registry = get_app_registry()
    try:
        app = await registry.deactivate_app(db, app_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return serialize_app(app, registry.runtime_status(app_id))


@router.get("/{app_id}/tools")
async def get_app_tools(app_id: str, db: AsyncSession = Depends(get_db)):
    registry = get_app_registry()
    app = await registry.get_app(db, app_id)
    if app is None:
        raise HTTPException(status_code=404, detail="App not found")
    manifest = app.manifest or {}
    try:
        tools = await registry.get_tools(db, app_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return {
        "app_id": app_id,
        "tools": tools,
        "permissions": manifest.get("permissions", []),
    }


@router.get("/{app_id}/skill")
async def get_app_skill(app_id: str, db: AsyncSession = Depends(get_db)):
    registry = get_app_registry()
    try:
        return await registry.get_skill(db, app_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/{app_id}/health")
async def check_app_health(app_id: str, db: AsyncSession = Depends(get_db)):
    registry = get_app_registry()
    try:
        return {"app_id": app_id, "runtime": await registry.check_app_health(db, app_id)}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/{app_id}/tools/{tool_name}")
async def invoke_app_tool(
    app_id: str,
    tool_name: str,
    data: ToolInvokeRequest,
    db: AsyncSession = Depends(get_db),
):
    registry = get_app_registry()
    try:
        result = await registry.call_tool(db, app_id, tool_name, data.arguments)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except NotImplementedError as exc:
        raise HTTPException(status_code=501, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return {"result": result}
