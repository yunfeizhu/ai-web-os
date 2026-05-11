"""Redacted transcript ingestion for dreaming light phase."""

from __future__ import annotations

import hashlib
import json
from datetime import datetime
from typing import Any

from app.core.markdown_memory import MarkdownMemoryManager
from app.core.memory_redaction import redact_memory_text

_TRANSCRIPT_TERMS = (
    "用户",
    "默认",
    "偏好",
    "职业",
    "项目",
    "计划",
    "喜欢",
    "沟通",
    "语言",
    "remember",
    "prefer",
)


def ingest_redacted_transcript(
    manager: MarkdownMemoryManager,
    messages: list[dict[str, Any]],
) -> dict[str, Any]:
    entries = _extract_transcript_entries(messages)
    path = manager.paths.dreams_state_dir / "transcripts.json"
    with manager.write_lock():
        payload = _read_json(path, default={"version": 1, "entries": {}})
        stored = dict(payload.get("entries") or {})
        ingested = 0
        for text in entries:
            entry_id = _entry_id(text)
            if entry_id in stored:
                continue
            stored[entry_id] = {
                "id": entry_id,
                "memory": text,
                "kind": "transcript_candidate",
                "createdAt": datetime.now().isoformat(timespec="seconds"),
            }
            ingested += 1
        if ingested:
            manager.locked_write(
                path,
                json.dumps({"version": 1, "entries": stored}, ensure_ascii=False, indent=2)
                + "\n",
                backup=False,
            )
    return {"ingested": ingested, "path": str(path)}


def list_transcript_candidates(manager: MarkdownMemoryManager) -> list[dict[str, Any]]:
    path = manager.paths.dreams_state_dir / "transcripts.json"
    payload = _read_json(path, default={"version": 1, "entries": {}})
    entries = payload.get("entries") if isinstance(payload.get("entries"), dict) else {}
    return [
        {
            "id": str(entry.get("id") or key),
            "memory": str(entry.get("memory") or ""),
            "kind": "transcript_candidate",
            "sourcePath": str(path),
            "status": "pending",
        }
        for key, entry in entries.items()
        if isinstance(entry, dict) and str(entry.get("memory") or "").strip()
    ]


def _extract_transcript_entries(messages: list[dict[str, Any]]) -> list[str]:
    entries: list[str] = []
    seen: set[str] = set()
    for message in messages:
        if message.get("role") != "user":
            continue
        text = redact_memory_text(str(message.get("content") or ""))
        if not text or not _has_transcript_signal(text):
            continue
        normalized = " ".join(text.split())
        if normalized in seen:
            continue
        seen.add(normalized)
        entries.append(normalized)
    return entries


def _has_transcript_signal(text: str) -> bool:
    lowered = text.lower()
    return any(term in lowered for term in _TRANSCRIPT_TERMS)


def _entry_id(text: str) -> str:
    return "transcript_" + hashlib.sha1(text.encode("utf-8")).hexdigest()[:12]


def _read_json(path, *, default: dict[str, Any]) -> dict[str, Any]:
    if not path.exists():
        return default
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return default
    return data if isinstance(data, dict) else default
