from __future__ import annotations

import re
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.app_registry import get_app_registry


def _slug_tool_segment(value: str) -> str:
    segment = re.sub(r"[^a-zA-Z0-9_]+", "_", str(value or "").strip().lower())
    segment = re.sub(r"_+", "_", segment).strip("_")
    return segment or "skill"


def _extension_status(enabled: bool, runtime_status: str, last_error: str | None = None) -> str:
    if not enabled:
        return "disabled"
    if last_error:
        return "error"
    if runtime_status in {"error", "failed"}:
        return "error"
    if runtime_status in {"warning", "degraded"}:
        return "warning"
    return "ok"


def _manifest_tools(manifest: dict[str, Any]) -> list[dict[str, str]]:
    tools: list[dict[str, str]] = []
    for tool in manifest.get("tools") or []:
        if not isinstance(tool, dict):
            continue
        name = str(tool.get("name") or "").strip()
        if not name:
            continue
        tools.append({
            "name": name,
            "description": str(tool.get("description") or ""),
        })
    return tools


def serialize_app_extension(app: Any, runtime: dict[str, Any] | None = None) -> dict[str, Any]:
    manifest = app.manifest or {}
    runtime = runtime or {}
    is_builtin = bool(app.is_builtin)
    runtime_status = str(runtime.get("status") or app.status or "inactive")
    mcp_config = manifest.get("mcp") or {}
    kind = "app" if is_builtin else "mcp"

    return {
        "id": app.id,
        "kind": kind,
        "name": app.name,
        "description": app.description,
        "version": app.version,
        "source": "builtin" if is_builtin else "local",
        "sourcePath": app.source_path or "",
        "enabled": bool(app.enabled),
        "status": _extension_status(bool(app.enabled), runtime_status, app.last_error),
        "runtimeStatus": runtime_status,
        "category": manifest.get("category") or ("builtin" if is_builtin else "mcp"),
        "permissions": list(manifest.get("permissions") or []),
        "tools": _manifest_tools(manifest),
        "runtime": runtime,
        "transport": mcp_config.get("transport"),
        "lastError": app.last_error,
    }


def serialize_skill_extension(skill: dict[str, Any]) -> dict[str, Any]:
    enabled = bool(skill.get("enabled", True))
    skill_key = str(skill.get("skill_key") or skill.get("id") or "skill")
    primary_env = str(skill.get("primary_env") or "").strip()
    permissions = [f"env:{primary_env}"] if primary_env else []
    tools = [
        {
            "name": f"skill_{_slug_tool_segment(skill_key)}",
            "description": str(skill.get("description") or ""),
        }
    ]

    return {
        "id": str(skill.get("id") or ""),
        "kind": "skill",
        "name": str(skill.get("name") or skill.get("id") or "Unnamed Skill"),
        "description": str(skill.get("description") or ""),
        "version": str(skill.get("version") or "local"),
        "source": "local",
        "sourcePath": str(skill.get("path") or ""),
        "enabled": enabled,
        "status": "ok" if enabled else "disabled",
        "runtimeStatus": "available" if enabled else "disabled",
        "category": "skill",
        "permissions": permissions,
        "tools": tools,
        "runtime": {
            "entrypoint": skill.get("entrypoint"),
            "skillKey": skill_key,
            "hasApiKey": bool(skill.get("has_api_key")),
            "updatedAt": skill.get("updated_at"),
        },
        "transport": None,
        "lastError": None,
    }


async def list_extension_summaries(db: AsyncSession) -> list[dict[str, Any]]:
    registry = get_app_registry()
    apps = await registry.list_apps(db)
    summaries = [
        serialize_app_extension(app, registry.runtime_status(app.id))
        for app in apps
    ]
    summaries.extend(
        serialize_skill_extension(skill)
        for skill in registry.list_user_skills()
    )
    return sorted(summaries, key=lambda item: (item["kind"], item["name"].lower()))
