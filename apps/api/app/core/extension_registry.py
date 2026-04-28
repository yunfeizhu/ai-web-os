from __future__ import annotations

import re
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.app_manifest import ALLOWED_APP_PERMISSIONS
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


def _overall_validation_status(validation: dict[str, dict[str, Any]]) -> str:
    statuses = {str(section.get("status") or "ok") for section in validation.values()}
    if "error" in statuses:
        return "error"
    if "warning" in statuses:
        return "warning"
    return "ok"


def _validation_status_for(validation: dict[str, dict[str, Any]], sections: tuple[str, ...]) -> str:
    scoped = {
        section: validation[section]
        for section in sections
        if section in validation
    }
    return _overall_validation_status(scoped)


def _merge_status(runtime_status: str, validation_status: str) -> str:
    if runtime_status == "disabled":
        return "disabled"
    if runtime_status == "error" or validation_status == "error":
        return "error"
    if runtime_status == "warning" or validation_status == "warning":
        return "warning"
    return runtime_status


def _required_transport_permissions(transport: str | None) -> list[str]:
    normalized = str(transport or "builtin").strip().lower()
    if normalized == "stdio":
        return ["subprocess"]
    if normalized in {"streamable-http", "http", "remote-http"}:
        return ["network"]
    return []


def _runtime_status_for_display(
    app: Any,
    runtime_status: str,
    runtime: dict[str, Any],
    manifest: dict[str, Any],
) -> str:
    if not bool(app.enabled):
        return "disabled"
    if app.last_error or runtime_status in {"error", "failed"}:
        return "error"

    transport = str(((manifest.get("mcp") or {}).get("transport")) or "builtin").strip().lower()
    if bool(app.is_builtin) and transport == "builtin" and runtime_status == "inactive":
        return "available"

    return runtime_status


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


def validate_app_extension(app: Any, runtime: dict[str, Any] | None = None) -> dict[str, Any]:
    manifest = app.manifest or {}
    runtime = runtime or {}
    is_builtin = bool(app.is_builtin)
    source_path = str(app.source_path or "").strip()
    version = str(app.version or "").strip()
    permissions = [str(item) for item in manifest.get("permissions") or []]
    transport = ((manifest.get("mcp") or {}).get("transport")) or ("builtin" if is_builtin else "")
    required_permissions = _required_transport_permissions(transport)
    missing_permissions = [
        permission for permission in required_permissions if permission not in permissions
    ]
    unknown_permissions = [] if is_builtin else [
        permission for permission in permissions if permission not in ALLOWED_APP_PERMISSIONS
    ]

    install_issues: list[str] = []
    if not is_builtin and not source_path:
        install_issues.append("本地 App/MCP 缺少 source_path，无法追溯安装来源。")
    if app.last_error:
        install_issues.append(str(app.last_error))
    runtime_status = str(runtime.get("status") or app.status or "inactive")
    if runtime_status in {"error", "failed"}:
        install_issues.append("运行时健康检查失败，请在管理面板重新连接或查看日志。")

    update_issues: list[str] = []
    if not version:
        update_issues.append("未声明版本，无法判断本地更新状态。")

    permission_issues: list[str] = []
    if missing_permissions:
        permission_issues.append(
            "权限声明缺少传输层必需项：" + ", ".join(missing_permissions)
        )
    if unknown_permissions:
        permission_issues.append(
            "权限声明包含未知项：" + ", ".join(unknown_permissions)
        )

    validation = {
        "install": {
            "status": "warning" if install_issues else "ok",
            "label": "安装来源",
            "issues": install_issues,
            "sourcePath": source_path,
        },
        "update": {
            "status": "warning" if update_issues else "ok",
            "label": "版本更新",
            "issues": update_issues,
            "currentVersion": version or "unknown",
            "updateAvailable": False,
            "updateMode": "local-manifest",
        },
        "permissions": {
            "status": "warning" if permission_issues else "ok",
            "label": "权限声明",
            "issues": permission_issues,
            "declared": permissions,
            "required": required_permissions,
            "missing": missing_permissions,
            "unknown": unknown_permissions,
        },
    }
    validation["overallStatus"] = _overall_validation_status(validation)
    return validation


def validate_skill_extension(skill: dict[str, Any]) -> dict[str, Any]:
    source_path = str(skill.get("path") or "").strip()
    entrypoint = str(skill.get("entrypoint") or "").strip()
    version = str(skill.get("version") or "").strip()
    primary_env = str(skill.get("primary_env") or "").strip()
    primary_env_source = str(skill.get("primary_env_source") or "none").strip()
    has_api_key = bool(skill.get("has_api_key"))

    install_issues: list[str] = []
    if not source_path:
        install_issues.append("本地 Skill 缺少 source_path，无法追溯安装来源。")
    if not entrypoint:
        install_issues.append("本地 Skill 缺少入口文件，无法加载。")

    update_issues: list[str] = []
    if not version:
        update_issues.append("未声明版本，无法判断本地更新状态。")

    permission_issues: list[str] = []
    declared_permissions = [f"env:{primary_env}"] if primary_env else []
    if primary_env and primary_env_source != "declared":
        permission_issues.append(f"{primary_env} 来自内容推断，建议在 Skill 元数据中显式声明。")
    if primary_env and not has_api_key:
        permission_issues.append(f"{primary_env} 未配置 API Key，调用时可能失败。")

    validation = {
        "install": {
            "status": "error" if install_issues else "ok",
            "label": "安装来源",
            "issues": install_issues,
            "sourcePath": source_path,
            "entrypoint": entrypoint,
        },
        "update": {
            "status": "warning" if update_issues else "ok",
            "label": "版本更新",
            "issues": update_issues,
            "currentVersion": version or "local",
            "updateAvailable": False,
            "updateMode": "local-skill",
        },
        "permissions": {
            "status": "warning" if permission_issues else "ok",
            "label": "权限声明",
            "issues": permission_issues,
            "declared": declared_permissions,
            "primaryEnv": primary_env or None,
            "primaryEnvSource": primary_env_source,
            "hasApiKey": has_api_key,
        },
    }
    validation["overallStatus"] = _overall_validation_status(validation)
    return validation


def extension_validation_summary(extensions: list[dict[str, Any]]) -> dict[str, int]:
    totals = {"installIssues": 0, "updateIssues": 0, "permissionIssues": 0}
    for extension in extensions:
        validation = extension.get("validation") or {}
        if str((validation.get("install") or {}).get("status") or "ok") != "ok":
            totals["installIssues"] += 1
        if str((validation.get("update") or {}).get("status") or "ok") != "ok":
            totals["updateIssues"] += 1
        if str((validation.get("permissions") or {}).get("status") or "ok") != "ok":
            totals["permissionIssues"] += 1
    return totals


def serialize_app_extension(app: Any, runtime: dict[str, Any] | None = None) -> dict[str, Any]:
    manifest = app.manifest or {}
    runtime = runtime or {}
    is_builtin = bool(app.is_builtin)
    runtime_status = str(runtime.get("status") or app.status or "inactive")
    display_runtime_status = _runtime_status_for_display(app, runtime_status, runtime, manifest)
    mcp_config = manifest.get("mcp") or {}
    kind = "app" if is_builtin else "mcp"
    validation = validate_app_extension(app, runtime)
    status = _extension_status(bool(app.enabled), display_runtime_status, app.last_error)

    return {
        "id": app.id,
        "kind": kind,
        "name": app.name,
        "description": app.description,
        "version": app.version,
        "source": "builtin" if is_builtin else "local",
        "sourcePath": app.source_path or "",
        "enabled": bool(app.enabled),
        "status": status,
        "runtimeStatus": display_runtime_status,
        "category": manifest.get("category") or ("builtin" if is_builtin else "mcp"),
        "permissions": list(manifest.get("permissions") or []),
        "tools": _manifest_tools(manifest),
        "runtime": runtime,
        "transport": mcp_config.get("transport"),
        "lastError": app.last_error,
        "validation": validation,
        "actions": {
            "install": "/api/v1/apps/install",
            "update": f"/api/v1/apps/{app.id}",
            "remove": None if is_builtin else f"/api/v1/apps/{app.id}",
            "configure": f"/api/v1/apps/{app.id}",
        },
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
    validation = validate_skill_extension(skill)
    status = "ok" if enabled else "disabled"

    return {
        "id": str(skill.get("id") or ""),
        "kind": "skill",
        "name": str(skill.get("name") or skill.get("id") or "Unnamed Skill"),
        "description": str(skill.get("description") or ""),
        "version": str(skill.get("version") or "local"),
        "source": "local",
        "sourcePath": str(skill.get("path") or ""),
        "enabled": enabled,
        "status": status,
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
        "validation": validation,
        "actions": {
            "install": f"/api/v1/skills/{skill.get('id') or skill_key}",
            "update": f"/api/v1/skills/{skill.get('id') or skill_key}",
            "remove": f"/api/v1/skills/{skill.get('id') or skill_key}",
            "configure": f"/api/v1/skills/{skill.get('id') or skill_key}/api-key",
        },
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
