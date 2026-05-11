"""Grounded historical backfill for Markdown daily memory notes."""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path
from typing import Any

from app.core.markdown_memory import MarkdownMemoryManager

_CANDIDATE_MARKER = "<!-- candidate:"


def preview_grounded_backfill(manager: MarkdownMemoryManager) -> dict[str, Any]:
    candidates = _read_grounded_candidates(manager)
    return {"candidates": candidates, "count": len(candidates)}


def stage_grounded_backfill(manager: MarkdownMemoryManager) -> dict[str, Any]:
    candidates = _read_grounded_candidates(manager)
    short_term_path = manager.paths.dreams_state_dir / "short-term.json"
    backfill_path = manager.paths.dreams_state_dir / "grounded-backfill.json"
    with manager.write_lock():
        state = _read_json(short_term_path, default={"version": 1, "entries": {}})
        entries = dict(state.get("entries") or {})
        staged = 0
        for candidate in candidates:
            entry_id = f"backfill_{candidate['id']}"
            if entry_id in entries:
                continue
            entries[entry_id] = {
                "id": entry_id,
                "text": candidate["memory"],
                "kind": "grounded_candidate",
                "status": "staged",
                "source": "grounded_backfill",
                "sourcePaths": [candidate["sourcePath"]],
                "day": candidate["day"],
            }
            staged += 1
        manager.locked_write(
            short_term_path,
            json.dumps({"version": 1, "entries": entries}, ensure_ascii=False, indent=2)
            + "\n",
            backup=False,
        )
        manager.locked_write(
            backfill_path,
            json.dumps({"version": 1, "candidates": candidates}, ensure_ascii=False, indent=2)
            + "\n",
            backup=False,
        )
    return {"staged": staged, "candidates": candidates, "state_path": str(short_term_path)}


def rollback_grounded_backfill(manager: MarkdownMemoryManager) -> dict[str, Any]:
    short_term_path = manager.paths.dreams_state_dir / "short-term.json"
    backfill_path = manager.paths.dreams_state_dir / "grounded-backfill.json"
    with manager.write_lock():
        state = _read_json(short_term_path, default={"version": 1, "entries": {}})
        entries = dict(state.get("entries") or {})
        kept = {
            key: entry
            for key, entry in entries.items()
            if not (isinstance(entry, dict) and entry.get("source") == "grounded_backfill")
        }
        removed = len(entries) - len(kept)
        manager.locked_write(
            short_term_path,
            json.dumps({"version": 1, "entries": kept}, ensure_ascii=False, indent=2)
            + "\n",
            backup=False,
        )
        if backfill_path.exists():
            backfill_path.unlink()
    return {"removed": removed, "state_path": str(short_term_path)}


def _read_grounded_candidates(manager: MarkdownMemoryManager) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    today = date.today().isoformat()
    for daily_file in sorted(manager.paths.daily_dir.glob("*.md")):
        if daily_file.stem >= today:
            continue
        candidates.extend(_read_daily_candidates(daily_file))
    return candidates


def _read_daily_candidates(path: Path) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if _CANDIDATE_MARKER not in line:
            continue
        memory = _strip_comment(line).lstrip("-* ").strip()
        candidate_id = _metadata_value(line, "id") or f"{path.stem}_{line_number}"
        status = _metadata_value(line, "status") or "pending"
        if not memory:
            continue
        results.append(
            {
                "id": candidate_id,
                "memory": memory,
                "status": status,
                "day": path.stem,
                "sourcePath": str(path),
                "line": line_number,
            }
        )
    return results


def _strip_comment(text: str) -> str:
    return text.split("<!--", 1)[0].strip()


def _metadata_value(text: str, key: str) -> str:
    marker = text.split("<!-- candidate:", 1)
    if len(marker) < 2:
        return ""
    raw = marker[1].split("-->", 1)[0]
    for part in raw.split(";"):
        if "=" not in part:
            continue
        left, right = part.split("=", 1)
        if left.strip() == key:
            return right.strip()
    return ""


def _read_json(path: Path, *, default: dict[str, Any]) -> dict[str, Any]:
    if not path.exists():
        return default
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return default
    return data if isinstance(data, dict) else default
