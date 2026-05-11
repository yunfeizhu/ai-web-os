"""Small command handler for memory maintenance commands."""

from __future__ import annotations

from app.core.markdown_memory import MarkdownMemoryManager
from app.core.memory_backfill import (
    preview_grounded_backfill,
    rollback_grounded_backfill,
    stage_grounded_backfill,
)
from app.core.memory_consolidation import consolidate_memory, get_dreaming_status


def run_memory_cli(argv: list[str], manager: MarkdownMemoryManager) -> str:
    command = [str(part).strip().lower() for part in argv if str(part).strip()]
    if command == ["dreaming", "status"]:
        status = get_dreaming_status(manager)
        runtime = status.get("runtime") or {}
        return (
            "Dreaming status\n"
            f"- enabled: {bool(runtime.get('enabled'))}\n"
            f"- short-term: {status.get('short_term_entries', 0)}\n"
            f"- pending: {status.get('pending_candidates', 0)}"
        )
    if command == ["dreaming", "sweep"]:
        result = consolidate_memory(manager)
        return (
            "Dreaming sweep complete\n"
            f"- promoted: {len(result.promoted)}\n"
            f"- skipped: {len(result.skipped)}\n"
            f"- duplicate: {len(result.duplicate)}"
        )
    if command == ["backfill", "preview"]:
        result = preview_grounded_backfill(manager)
        lines = [f"Grounded backfill preview: {result['count']} candidates"]
        lines.extend(f"- {item['memory']}" for item in result["candidates"][:20])
        return "\n".join(lines)
    if command == ["backfill", "stage"]:
        result = stage_grounded_backfill(manager)
        return f"Grounded backfill staged: {result['staged']}"
    if command == ["backfill", "rollback"]:
        result = rollback_grounded_backfill(manager)
        return f"Grounded backfill rollback removed: {result['removed']}"
    return (
        "Memory commands:\n"
        "- dreaming status\n"
        "- dreaming sweep\n"
        "- backfill preview\n"
        "- backfill stage\n"
        "- backfill rollback"
    )
