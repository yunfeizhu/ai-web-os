"""Local dreaming scheduler for Markdown memory.

The scheduler is cooperative: callers invoke ``maybe_run_scheduled_dreaming``
from normal request paths, and the function runs a deterministic sweep only
when the opt-in interval is due.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.core.markdown_memory import MarkdownMemoryManager
from app.core.memory_consolidation import consolidate_memory

DREAMING_ENABLED_ENV = "AI_NATIVE_OS_DREAMING_ENABLED"
DREAMING_INTERVAL_SECONDS_ENV = "AI_NATIVE_OS_DREAMING_INTERVAL_SECONDS"
DEFAULT_DREAMING_INTERVAL_SECONDS = 24 * 60 * 60


def maybe_run_scheduled_dreaming(manager: MarkdownMemoryManager) -> dict[str, Any]:
    config = _dreaming_config()
    if not config["enabled"]:
        return {"ran": False, "reason": "disabled", **config}

    scheduler_path = _scheduler_path(manager)
    scheduler = _read_json_file(scheduler_path, default={"version": 1})
    now = _utc_now()
    last_run_at = _parse_time(scheduler.get("lastRunAt"))
    if last_run_at is not None:
        elapsed = (now - last_run_at).total_seconds()
        if elapsed < config["interval_seconds"]:
            return {
                "ran": False,
                "reason": "not_due",
                "lastRunAt": scheduler.get("lastRunAt"),
                **config,
            }

    result = consolidate_memory(manager)
    payload = {
        "version": 1,
        "enabled": True,
        "intervalSeconds": config["interval_seconds"],
        "lastRunAt": now.isoformat(),
        "lastResult": {
            "promoted": len(result.promoted),
            "skipped": len(result.skipped),
            "duplicate": len(result.duplicate),
            "reportPath": result.report_path,
            "statePath": result.state_path,
            "phaseSignalPath": result.phase_signal_path,
        },
    }
    manager.locked_write(
        scheduler_path,
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        backup=False,
    )
    return {
        "ran": True,
        "promoted": len(result.promoted),
        "skipped": len(result.skipped),
        "duplicate": len(result.duplicate),
        "lastRunAt": payload["lastRunAt"],
        **config,
    }


def get_dreaming_runtime_status(manager: MarkdownMemoryManager) -> dict[str, Any]:
    config = _dreaming_config()
    scheduler_path = _scheduler_path(manager)
    scheduler = _read_json_file(scheduler_path, default={"version": 1})
    return {
        **config,
        "scheduler_path": str(scheduler_path),
        "scheduler": scheduler,
    }


def _dreaming_config() -> dict[str, Any]:
    return {
        "enabled": _env_truthy(os.getenv(DREAMING_ENABLED_ENV)),
        "interval_seconds": _env_int(
            os.getenv(DREAMING_INTERVAL_SECONDS_ENV),
            DEFAULT_DREAMING_INTERVAL_SECONDS,
        ),
    }


def _env_truthy(value: str | None) -> bool:
    if value is None:
        return False
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _env_int(value: str | None, default: int) -> int:
    try:
        parsed = int(str(value or "").strip())
    except ValueError:
        return default
    return max(parsed, 0)


def _scheduler_path(manager: MarkdownMemoryManager) -> Path:
    return manager.paths.dreams_state_dir / "scheduler.json"


def _read_json_file(path: Path, *, default: dict[str, Any]) -> dict[str, Any]:
    if not path.exists():
        return default
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return default
    return data if isinstance(data, dict) else default


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_time(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)
