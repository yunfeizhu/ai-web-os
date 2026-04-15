from __future__ import annotations

import asyncio
import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import AsyncSessionLocal
from app.core.file_manager import get_entry_by_path, list_entries, read_entry_text, save_text_file
from app.core.mcp_manager import MCPManager
from app.models.app import App

APPS_ROOT = Path(__file__).resolve().parents[2] / "apps_registry"
SKILL_ENTRYPOINTS = ("SKILL.md", "workflow.md")
MCP_CONFIG_VERSION = 1
USER_CONFIG_DIR = Path(
    os.getenv("AI_NATIVE_OS_HOME", str(Path.home() / ".ai-native-os"))
).expanduser()
MCP_CONFIG_PATH = USER_CONFIG_DIR / "mcp.json"
SKILLS_ROOT = USER_CONFIG_DIR / "skills"
SKILL_NAMESPACES = (".system", "user")

_registry: AppRegistry | None = None


@dataclass
class ManagedAppRecord:
    id: str
    name: str
    version: str
    description: str
    status: str
    enabled: bool
    is_builtin: bool
    source_path: str
    manifest: dict[str, Any] = field(default_factory=dict)
    settings: dict[str, Any] = field(default_factory=dict)
    last_error: str | None = None


def _parse_skill_frontmatter(content: str) -> tuple[dict[str, str], str]:
    if not content.startswith("---"):
        return {}, content

    lines = content.splitlines()
    if not lines or lines[0].strip() != "---":
        return {}, content

    closing_index: int | None = None
    for index in range(1, len(lines)):
        if lines[index].strip() == "---":
            closing_index = index
            break

    if closing_index is None:
        return {}, content

    metadata: dict[str, str] = {}
    for raw_line in lines[1:closing_index]:
        line = raw_line.strip()
        if not line or line.startswith("#") or ":" not in line:
            continue
        key, value = line.split(":", 1)
        metadata[key.strip()] = value.strip().strip("\"'")

    body = "\n".join(lines[closing_index + 1 :]).lstrip("\n")
    return metadata, body


def get_app_registry() -> "AppRegistry":
    global _registry
    if _registry is None:
        _registry = AppRegistry(APPS_ROOT)
    return _registry


async def shutdown_app_registry() -> None:
    global _registry
    if _registry is None:
        return
    await _registry.shutdown()
    _registry = None


class AppRegistry:
    def __init__(self, root_dir: Path) -> None:
        self.root_dir = root_dir
        self.user_config_dir = USER_CONFIG_DIR.resolve()
        self.mcp_config_path = MCP_CONFIG_PATH.resolve()
        self.skills_root = SKILLS_ROOT.resolve()
        self.mcp_manager = MCPManager()
        self._mcp_config_lock = asyncio.Lock()
        self._external_last_error: dict[str, str | None] = {}
        self._register_builtin_handlers()

    def _register_builtin_handlers(self) -> None:
        self.mcp_manager.register_builtin_tool("file-manager", "list_files", self._tool_list_files)
        self.mcp_manager.register_builtin_tool("file-manager", "read_file", self._tool_read_file)
        self.mcp_manager.register_builtin_tool("file-manager", "write_file", self._tool_write_file)
        self.mcp_manager.register_builtin_tool("text-editor", "read_file", self._tool_read_file)
        self.mcp_manager.register_builtin_tool("text-editor", "write_file", self._tool_write_file)
        self.mcp_manager.register_builtin_tool("notes", "list_notes", self._tool_list_notes)
        self.mcp_manager.register_builtin_tool("notes", "save_note", self._tool_save_note)

    def _ensure_user_config_structure(self) -> None:
        self.user_config_dir.mkdir(parents=True, exist_ok=True)
        self.skills_root.mkdir(parents=True, exist_ok=True)
        for namespace in SKILL_NAMESPACES:
            (self.skills_root / namespace).mkdir(parents=True, exist_ok=True)

    def _default_mcp_payload(self) -> dict[str, Any]:
        return {"version": MCP_CONFIG_VERSION, "servers": []}

    def _read_mcp_payload_unlocked(self) -> dict[str, Any]:
        self._ensure_user_config_structure()
        if not self.mcp_config_path.exists():
            payload = self._default_mcp_payload()
            self._write_mcp_payload_unlocked(payload)
            return payload

        raw = json.loads(self.mcp_config_path.read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            return self._default_mcp_payload()

        payload = {
            "version": raw.get("version", MCP_CONFIG_VERSION),
            "servers": raw.get("servers", []),
        }
        if not isinstance(payload["servers"], list):
            payload["servers"] = []
        return payload

    def _write_mcp_payload_unlocked(self, payload: dict[str, Any]) -> None:
        self._ensure_user_config_structure()
        normalized = {
            "version": MCP_CONFIG_VERSION,
            "servers": [self._normalize_external_record(record) for record in payload.get("servers", [])],
        }
        temp_path = self.mcp_config_path.with_suffix(".json.tmp")
        temp_path.write_text(
            json.dumps(normalized, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        temp_path.replace(self.mcp_config_path)

    def _normalize_external_record(self, raw: dict[str, Any]) -> dict[str, Any]:
        manifest = dict(raw.get("manifest") or {})
        app_id = str(manifest.get("id") or raw.get("id") or "").strip()
        if not app_id:
            raise ValueError("MCP config entry is missing an id")

        manifest["id"] = app_id
        manifest["name"] = str(manifest.get("name") or raw.get("name") or app_id)
        manifest["version"] = str(manifest.get("version") or "1.0.0")
        manifest["description"] = str(manifest.get("description") or "")

        permissions = manifest.get("permissions") or []
        manifest["permissions"] = [str(item) for item in permissions if str(item).strip()]

        tools = manifest.get("tools") or []
        manifest["tools"] = [tool for tool in tools if isinstance(tool, dict)]

        settings = raw.get("settings") or {}
        if not isinstance(settings, dict):
            settings = {}

        return {
            "id": app_id,
            "name": manifest["name"],
            "enabled": bool(raw.get("enabled", True)),
            "settings": settings,
            "manifest": manifest,
        }

    async def _bootstrap_external_config_from_db(self, db: AsyncSession) -> None:
        self._ensure_user_config_structure()
        if self.mcp_config_path.exists():
            return

        result = await db.execute(
            select(App).where(App.is_builtin.is_(False)).order_by(App.name.asc())
        )
        apps = list(result.scalars().all())
        payload = self._default_mcp_payload()

        if apps:
            payload["servers"] = [
                self._normalize_external_record(
                    {
                        "id": app.id,
                        "name": app.name,
                        "enabled": app.enabled,
                        "settings": app.settings or {},
                        "manifest": app.manifest or {},
                    }
                )
                for app in apps
            ]

        self._write_mcp_payload_unlocked(payload)

    async def _cleanup_legacy_external_apps(self, db: AsyncSession) -> None:
        result = await db.execute(select(App).where(App.is_builtin.is_(False)))
        legacy_apps = list(result.scalars().all())
        if not legacy_apps:
            return

        for app in legacy_apps:
            await self.mcp_manager.stop_server(app.id)
            await db.delete(app)
        await db.flush()

    async def _load_external_records(self, db: AsyncSession) -> list[dict[str, Any]]:
        async with self._mcp_config_lock:
            await self._bootstrap_external_config_from_db(db)
            payload = self._read_mcp_payload_unlocked()
        return [self._normalize_external_record(record) for record in payload.get("servers", [])]

    async def _update_external_records(self, db: AsyncSession, updater) -> list[dict[str, Any]]:
        async with self._mcp_config_lock:
            await self._bootstrap_external_config_from_db(db)
            payload = self._read_mcp_payload_unlocked()
            records = [self._normalize_external_record(record) for record in payload.get("servers", [])]
            records = updater(records)
            self._write_mcp_payload_unlocked({"version": MCP_CONFIG_VERSION, "servers": records})
        return records

    def _build_external_app(self, record: dict[str, Any]) -> ManagedAppRecord:
        app_id = record["id"]
        runtime = self.runtime_status(app_id)
        enabled = bool(record.get("enabled", True))
        last_error = self._external_last_error.get(app_id)

        if not enabled:
            status = "disabled"
        elif runtime.get("status"):
            status = str(runtime["status"])
        elif last_error:
            status = "error"
        else:
            status = "inactive"

        manifest = dict(record.get("manifest") or {})
        settings = dict(record.get("settings") or {})

        return ManagedAppRecord(
            id=app_id,
            name=str(manifest.get("name") or record.get("name") or app_id),
            version=str(manifest.get("version") or "1.0.0"),
            description=str(manifest.get("description") or ""),
            status=status,
            enabled=enabled,
            is_builtin=False,
            source_path=str(self.mcp_config_path),
            manifest=manifest,
            settings=settings,
            last_error=last_error,
        )

    async def sync_builtin_apps(self, db: AsyncSession) -> list[App]:
        manifests: list[dict[str, Any]] = []
        for manifest_path in sorted(self.root_dir.glob("*/manifest.json")):
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            manifest["source_path"] = str(manifest_path)
            manifest["skill"] = self._build_skill_descriptor(manifest_path, manifest.get("skill"))
            manifests.append(manifest)

        found_ids = {manifest["id"] for manifest in manifests}

        for manifest in manifests:
            existing = await db.get(App, manifest["id"])
            if existing is None:
                db.add(
                    App(
                        id=manifest["id"],
                        name=manifest.get("name", manifest["id"]),
                        version=manifest.get("version", "0.1.0"),
                        description=manifest.get("description", ""),
                        status="inactive",
                        enabled=True,
                        is_builtin=True,
                        source_path=manifest["source_path"],
                        manifest=manifest,
                    )
                )
                continue

            existing.name = manifest.get("name", existing.name)
            existing.version = manifest.get("version", existing.version)
            existing.description = manifest.get("description", existing.description)
            existing.is_builtin = True
            existing.source_path = manifest["source_path"]
            existing.manifest = manifest

        result = await db.execute(select(App).where(App.is_builtin.is_(True)))
        for app in result.scalars().all():
            if app.id not in found_ids:
                app.enabled = False
                app.status = "missing"
                app.last_error = "manifest.json is missing"

        await db.flush()
        result = await db.execute(select(App).where(App.is_builtin.is_(True)).order_by(App.name.asc()))
        return list(result.scalars().all())

    async def list_apps(self, db: AsyncSession) -> list[App | ManagedAppRecord]:
        await self._cleanup_legacy_external_apps(db)
        builtin_apps = await self.sync_builtin_apps(db)
        external_records = await self._load_external_records(db)
        external_apps = [self._build_external_app(record) for record in external_records]
        return sorted([*builtin_apps, *external_apps], key=lambda app: app.name.lower())

    async def get_app(self, db: AsyncSession, app_id: str) -> App | ManagedAppRecord | None:
        await self._cleanup_legacy_external_apps(db)

        app = await db.get(App, app_id)
        if app is not None and app.is_builtin:
            return app

        await self.sync_builtin_apps(db)
        app = await db.get(App, app_id)
        if app is not None and app.is_builtin:
            return app

        records = await self._load_external_records(db)
        for record in records:
            if record["id"] == app_id:
                return self._build_external_app(record)
        return None

    async def install_external_app(
        self,
        db: AsyncSession,
        manifest: dict[str, Any],
        enabled: bool = True,
    ) -> ManagedAppRecord:
        await self._cleanup_legacy_external_apps(db)
        record = self._normalize_external_record(
            {
                "id": manifest.get("id"),
                "enabled": enabled,
                "settings": {},
                "manifest": manifest,
            }
        )

        def updater(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
            next_records: list[dict[str, Any]] = []
            replaced = False
            for item in records:
                if item["id"] == record["id"]:
                    next_records.append(record)
                    replaced = True
                else:
                    next_records.append(item)
            if not replaced:
                next_records.append(record)
            return next_records

        await self._update_external_records(db, updater)
        self._external_last_error.pop(record["id"], None)
        return self._build_external_app(record)

    async def update_external_manifest(
        self,
        db: AsyncSession,
        app_id: str,
        manifest: dict[str, Any],
    ) -> ManagedAppRecord:
        await self._cleanup_legacy_external_apps(db)
        app = await self.get_app(db, app_id)
        if app is None:
            raise ValueError("App does not exist")
        if app.is_builtin:
            raise ValueError("Built-in app does not support manifest editing")

        normalized = self._normalize_external_record(
            {
                "id": app_id,
                "enabled": app.enabled,
                "settings": app.settings,
                "manifest": manifest,
            }
        )
        if normalized["id"] != app_id:
            raise ValueError("Editing app id is not supported")

        was_active = self.runtime_status(app_id).get("status") == "active"
        if was_active:
            await self.deactivate_app(db, app_id)

        def updater(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
            next_records: list[dict[str, Any]] = []
            updated = False
            for item in records:
                if item["id"] == app_id:
                    next_records.append(normalized)
                    updated = True
                else:
                    next_records.append(item)
            if not updated:
                raise ValueError("App does not exist")
            return next_records

        await self._update_external_records(db, updater)
        self._external_last_error.pop(app_id, None)

        if was_active and normalized["enabled"]:
            return await self.activate_app(db, app_id)
        return self._build_external_app(normalized)

    async def update_app_settings(
        self,
        db: AsyncSession,
        app_id: str,
        settings: dict[str, Any],
    ) -> App | ManagedAppRecord:
        app = await self.get_app(db, app_id)
        if app is None:
            raise ValueError("App does not exist")

        if app.is_builtin:
            app.settings = settings
            await db.flush()
            return app

        def updater(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
            next_records: list[dict[str, Any]] = []
            updated = False
            for item in records:
                if item["id"] == app_id:
                    next_item = dict(item)
                    next_item["settings"] = settings
                    next_records.append(self._normalize_external_record(next_item))
                    updated = True
                else:
                    next_records.append(item)
            if not updated:
                raise ValueError("App does not exist")
            return next_records

        records = await self._update_external_records(db, updater)
        for record in records:
            if record["id"] == app_id:
                return self._build_external_app(record)
        raise ValueError("App does not exist")

    async def remove_app(self, db: AsyncSession, app_id: str) -> None:
        await self._cleanup_legacy_external_apps(db)
        app = await self.get_app(db, app_id)
        if app is None:
            raise ValueError("App does not exist")
        if app.is_builtin:
            raise ValueError("Built-in app cannot be removed")

        await self.mcp_manager.stop_server(app_id)

        def updater(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
            return [item for item in records if item["id"] != app_id]

        await self._update_external_records(db, updater)
        self._external_last_error.pop(app_id, None)

    async def activate_app(self, db: AsyncSession, app_id: str) -> App | ManagedAppRecord:
        app = await self.get_app(db, app_id)
        if app is None:
            raise ValueError("App does not exist")
        if not app.enabled:
            raise ValueError("App is disabled")

        try:
            active = await self.mcp_manager.start_server(app_id, app.manifest or {})
        except Exception as exc:
            if app.is_builtin:
                app.status = "error"
                app.last_error = str(exc)
                await db.flush()
            else:
                self._external_last_error[app_id] = str(exc)
            raise

        if app.is_builtin:
            app.status = active.status
            app.last_error = None
            await db.flush()
            return app

        self._external_last_error.pop(app_id, None)
        return await self.get_app(db, app_id) or self._build_external_app(
            {
                "id": app_id,
                "enabled": app.enabled,
                "settings": app.settings,
                "manifest": app.manifest,
            }
        )

    async def deactivate_app(self, db: AsyncSession, app_id: str) -> App | ManagedAppRecord:
        app = await self.get_app(db, app_id)
        if app is None:
            raise ValueError("App does not exist")
        await self.mcp_manager.stop_server(app_id)

        if app.is_builtin:
            app.status = "inactive" if app.enabled else "disabled"
            await db.flush()
            return app

        return await self.get_app(db, app_id) or self._build_external_app(
            {
                "id": app_id,
                "enabled": app.enabled,
                "settings": app.settings,
                "manifest": app.manifest,
            }
        )

    async def set_enabled(self, db: AsyncSession, app_id: str, enabled: bool) -> App | ManagedAppRecord:
        app = await self.get_app(db, app_id)
        if app is None:
            raise ValueError("App does not exist")

        if app.is_builtin:
            app.enabled = enabled
            if not enabled:
                await self.mcp_manager.stop_server(app_id)
                app.status = "disabled"
            elif app.status == "disabled":
                app.status = "inactive"
            await db.flush()
            return app

        def updater(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
            next_records: list[dict[str, Any]] = []
            updated = False
            for item in records:
                if item["id"] == app_id:
                    next_item = dict(item)
                    next_item["enabled"] = enabled
                    next_records.append(self._normalize_external_record(next_item))
                    updated = True
                else:
                    next_records.append(item)
            if not updated:
                raise ValueError("App does not exist")
            return next_records

        records = await self._update_external_records(db, updater)
        if not enabled:
            await self.mcp_manager.stop_server(app_id)
        self._external_last_error.pop(app_id, None)

        for record in records:
            if record["id"] == app_id:
                return self._build_external_app(record)
        raise ValueError("App does not exist")

    async def call_tool(self, db: AsyncSession, app_id: str, tool_name: str, arguments: dict) -> Any:
        app = await self.get_app(db, app_id)
        if app is None:
            raise ValueError("App does not exist")
        if app.status not in ("active", "builtin"):
            await self.activate_app(db, app_id)
        return await self.mcp_manager.call_tool(app_id, tool_name, arguments)

    async def get_tools(self, db: AsyncSession, app_id: str) -> list[dict]:
        app = await self.get_app(db, app_id)
        if app is None:
            raise ValueError("App does not exist")

        manifest = app.manifest or {}
        transport = (manifest.get("mcp") or {}).get("transport", "builtin")
        if transport == "builtin":
            return manifest.get("tools", [])

        if self.runtime_status(app_id).get("status") != "active":
            await self.activate_app(db, app_id)
        return await self.mcp_manager.list_tools(app_id)

    async def get_skill(self, db: AsyncSession, app_id: str) -> dict:
        app = await self.get_app(db, app_id)
        if app is None:
            raise ValueError("App does not exist")

        manifest = app.manifest or {}
        skill_path = self._resolve_skill_path(manifest)
        if skill_path is None or not skill_path.exists():
            raise ValueError("App does not provide SKILL.md")

        raw_content = skill_path.read_text(encoding="utf-8")
        metadata, body = _parse_skill_frontmatter(raw_content)
        descriptor = self._build_skill_descriptor(skill_path.parent / "manifest.json", manifest.get("skill"))

        return {
            "app_id": app.id,
            "metadata": metadata,
            "content": body,
            "raw_content": raw_content,
            "skill": descriptor,
        }

    def runtime_status(self, app_id: str) -> dict:
        return self.mcp_manager.get_status(app_id)

    async def shutdown(self) -> None:
        await self.mcp_manager.stop_all()

    async def _tool_list_files(self, arguments: dict) -> dict:
        path = arguments.get("path", "/")
        async with AsyncSessionLocal() as db:
            rows = await list_entries(db, path)
            return {"entries": [self._public_file_item(row) for row in rows]}

    async def _tool_read_file(self, arguments: dict) -> dict:
        path = arguments.get("path", "/")
        async with AsyncSessionLocal() as db:
            entry = await get_entry_by_path(db, path)
            if entry is None or entry.kind != "file":
                raise ValueError("File does not exist")
            return {"path": entry.path, "content": await read_entry_text(entry)}

    async def _tool_write_file(self, arguments: dict) -> dict:
        path = arguments.get("path")
        content = arguments.get("content", "")
        if not path:
            raise ValueError("Missing path")
        async with AsyncSessionLocal() as db:
            entry = await save_text_file(db, str(path), str(content), mime_type="text/plain")
            await db.commit()
            return {"path": entry.path, "size": entry.size}

    async def _tool_list_notes(self, arguments: dict) -> dict:
        async with AsyncSessionLocal() as db:
            rows = await list_entries(db, "/Notes")
            notes = [
                self._public_file_item(row)
                for row in rows
                if row.kind == "file" and row.name.endswith(".md")
            ]
            return {"entries": notes}

    async def _tool_save_note(self, arguments: dict) -> dict:
        title = str(arguments.get("title", "Untitled")).strip() or "Untitled"
        content = str(arguments.get("content", ""))
        safe_name = f"{title.removesuffix('.md')}.md"
        async with AsyncSessionLocal() as db:
            entry = await save_text_file(db, f"/Notes/{safe_name}", content, mime_type="text/markdown")
            await db.commit()
            return {"path": entry.path, "size": entry.size}

    def _public_file_item(self, entry: Any) -> dict:
        return {
            "id": entry.id,
            "name": entry.name,
            "path": entry.path,
            "kind": entry.kind,
            "mime_type": entry.mime_type,
            "size": entry.size,
        }

    def _build_skill_descriptor(self, manifest_path: Path, configured: dict | None = None) -> dict | None:
        skill_path = self._resolve_skill_path(
            {
                "source_path": str(manifest_path),
                "skill": configured or {},
            }
        )
        if skill_path is None or not skill_path.exists():
            return None

        metadata, _ = _parse_skill_frontmatter(skill_path.read_text(encoding="utf-8"))
        entrypoint = skill_path.name
        return {
            "format": (configured or {}).get("format", "skill-md"),
            "entrypoint": entrypoint,
            "path": str(skill_path),
            "name": metadata.get("name") or manifest_path.parent.name,
            "description": metadata.get("description", ""),
            "legacy": entrypoint == "workflow.md",
        }

    def _resolve_skill_path(self, manifest: dict) -> Path | None:
        configured = manifest.get("skill") or {}
        source_path = manifest.get("source_path")
        if not source_path:
            return None

        app_dir = Path(source_path).parent
        configured_entrypoint = configured.get("entrypoint")
        if configured_entrypoint:
            configured_path = app_dir / str(configured_entrypoint)
            if configured_path.exists():
                return configured_path

        for name in SKILL_ENTRYPOINTS:
            candidate = app_dir / name
            if candidate.exists():
                return candidate
        return None
