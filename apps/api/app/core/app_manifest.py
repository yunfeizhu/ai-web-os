from __future__ import annotations

import re
from copy import deepcopy
from typing import Any

ALLOWED_APP_PERMISSIONS = {
    "network",
    "filesystem",
    "subprocess",
    "storage",
    "browser",
    "knowledge",
    "memory",
}
ALLOWED_MCP_TRANSPORTS = {"builtin", "stdio", "streamable-http", "http", "remote-http"}
APP_ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9_-]{0,127}$")


def normalize_manifest(
    raw_manifest: dict[str, Any],
    *,
    source_path: str | None = None,
    builtin: bool = False,
) -> dict[str, Any]:
    if not isinstance(raw_manifest, dict):
        raise ValueError("manifest must be an object")

    manifest = deepcopy(raw_manifest)
    app_id = str(manifest.get("id") or "").strip().lower()
    if not APP_ID_PATTERN.fullmatch(app_id):
        raise ValueError(
            "manifest.id is required and must match ^[a-z0-9][a-z0-9_-]{0,127}$"
        )

    manifest["id"] = app_id
    manifest["name"] = _normalize_non_empty_string(manifest.get("name"), "manifest.name", fallback=app_id)
    manifest["version"] = _normalize_non_empty_string(
        manifest.get("version"), "manifest.version", fallback="1.0.0"
    )
    manifest["description"] = str(manifest.get("description") or "").strip()
    manifest["category"] = str(manifest.get("category") or "utility").strip() or "utility"
    manifest["mcp"] = _normalize_mcp(manifest.get("mcp"))
    manifest["permissions"] = _apply_transport_permissions(
        _normalize_permissions(manifest.get("permissions")),
        manifest["mcp"],
    )
    manifest["tools"] = _normalize_tools(manifest.get("tools"))
    manifest["skill"] = _normalize_skill(manifest.get("skill"))
    manifest["routing_hints"] = _normalize_routing_hints(manifest.get("routing_hints"))

    if source_path:
        manifest["source_path"] = source_path

    if not builtin:
        _validate_transport_permission_contract(manifest)

    return manifest


def _normalize_non_empty_string(value: Any, field_name: str, *, fallback: str | None = None) -> str:
    normalized = str(value or fallback or "").strip()
    if not normalized:
        raise ValueError(f"{field_name} is required")
    return normalized


def _normalize_permissions(raw_permissions: Any) -> list[str]:
    if raw_permissions is None:
        return []
    if not isinstance(raw_permissions, list):
        raise ValueError("manifest.permissions must be an array")

    permissions: list[str] = []
    seen: set[str] = set()
    for item in raw_permissions:
        permission = str(item or "").strip().lower()
        if not permission:
            continue
        if permission not in ALLOWED_APP_PERMISSIONS:
            allowed = ", ".join(sorted(ALLOWED_APP_PERMISSIONS))
            raise ValueError(f"unsupported permission `{permission}`; allowed: {allowed}")
        if permission not in seen:
            permissions.append(permission)
            seen.add(permission)
    return permissions


def _apply_transport_permissions(
    permissions: list[str],
    mcp: dict[str, Any],
) -> list[str]:
    normalized = list(permissions)
    transport = str((mcp or {}).get("transport") or "builtin").strip().lower()

    if transport == "stdio" and "subprocess" not in normalized:
        normalized.append("subprocess")
    if transport in {"streamable-http", "http", "remote-http"} and "network" not in normalized:
        normalized.append("network")

    return normalized


def _normalize_tools(raw_tools: Any) -> list[dict[str, Any]]:
    if raw_tools is None:
        return []
    if not isinstance(raw_tools, list):
        raise ValueError("manifest.tools must be an array")

    tools: list[dict[str, Any]] = []
    seen_names: set[str] = set()
    for item in raw_tools:
        if not isinstance(item, dict):
            raise ValueError("manifest.tools entries must be objects")
        name = str(item.get("name") or "").strip()
        if not name:
            raise ValueError("manifest.tools[].name is required")
        if name in seen_names:
            raise ValueError(f"duplicated tool name `{name}`")
        seen_names.add(name)
        tools.append(
            {
                "name": name,
                "description": str(item.get("description") or "").strip(),
            }
        )
    return tools


def _normalize_mcp(raw_mcp: Any) -> dict[str, Any]:
    if raw_mcp is None:
        return {"transport": "builtin"}
    if not isinstance(raw_mcp, dict):
        raise ValueError("manifest.mcp must be an object")

    transport = str(raw_mcp.get("transport") or "builtin").strip().lower()
    if transport not in ALLOWED_MCP_TRANSPORTS:
        allowed = ", ".join(sorted(ALLOWED_MCP_TRANSPORTS))
        raise ValueError(f"unsupported MCP transport `{transport}`; allowed: {allowed}")

    mcp: dict[str, Any] = {"transport": transport}
    if transport == "stdio":
        command = str(raw_mcp.get("command") or "").strip()
        if not command:
            raise ValueError("stdio MCP requires manifest.mcp.command")
        args = raw_mcp.get("args") or []
        if not isinstance(args, list):
            raise ValueError("manifest.mcp.args must be an array")
        mcp["command"] = command
        mcp["args"] = [str(arg) for arg in args]
    elif transport in {"streamable-http", "http", "remote-http"}:
        url = str(raw_mcp.get("url") or "").strip()
        if not url:
            raise ValueError("HTTP MCP requires manifest.mcp.url")
        headers = raw_mcp.get("headers") or {}
        if not isinstance(headers, dict):
            raise ValueError("manifest.mcp.headers must be an object")
        mcp["url"] = url
        mcp["headers"] = {str(key): str(value) for key, value in headers.items()}

    return mcp


def _normalize_skill(raw_skill: Any) -> dict[str, Any]:
    if raw_skill is None:
        return {}
    if not isinstance(raw_skill, dict):
        raise ValueError("manifest.skill must be an object")

    normalized: dict[str, Any] = {}
    entrypoint = str(raw_skill.get("entrypoint") or "").strip()
    if entrypoint:
        normalized["entrypoint"] = entrypoint
    skill_format = str(raw_skill.get("format") or "").strip()
    if skill_format:
        normalized["format"] = skill_format
    return normalized


def _normalize_routing_hints(raw_hints: Any) -> dict[str, Any]:
    if raw_hints is None:
        return {}
    if not isinstance(raw_hints, dict):
        raise ValueError("manifest.routing_hints must be an object")

    normalized: dict[str, Any] = {}
    for key in ("aliases", "keywords", "extensions", "paths", "support_skills"):
        value = raw_hints.get(key) or []
        if value and not isinstance(value, list):
            raise ValueError(f"manifest.routing_hints.{key} must be an array")
        cleaned = [str(item).strip().lower() for item in value if str(item).strip()]
        if cleaned:
            normalized[key] = cleaned
    return normalized


def _validate_transport_permission_contract(manifest: dict[str, Any]) -> None:
    transport = ((manifest.get("mcp") or {}).get("transport")) or "builtin"
    permissions = set(manifest.get("permissions") or [])

    if transport == "stdio" and "subprocess" not in permissions:
        raise ValueError("stdio MCP apps must declare the `subprocess` permission")
    if transport in {"streamable-http", "http", "remote-http"} and "network" not in permissions:
        raise ValueError("HTTP MCP apps must declare the `network` permission")
