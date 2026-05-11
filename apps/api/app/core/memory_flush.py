"""Automatic memory flush helpers used around context compaction."""

from __future__ import annotations

import hashlib
from datetime import date
from typing import Any

from app.core.markdown_memory import MarkdownMemoryManager
from app.core.memory_redaction import redact_memory_text

_FLUSH_TERMS = (
    "记住",
    "记录",
    "以后",
    "偏好",
    "喜欢",
    "默认",
    "职业",
    "我叫",
    "我是",
    "计划",
    "remember",
    "prefer",
)


def flush_memory_before_compaction(
    manager: MarkdownMemoryManager,
    messages: list[dict[str, Any]],
) -> dict[str, Any]:
    """Stage durable-looking facts before older context is compacted."""
    staged = 0
    skipped = 0
    daily_file = manager.paths.daily_dir / f"{date.today().isoformat()}.md"
    with manager.write_lock():
        existing = daily_file.read_text(encoding="utf-8") if daily_file.exists() else ""
        content = _ensure_flush_section(existing)
        for memory in _extract_flush_candidates(messages):
            candidate_id = _flush_candidate_id(memory)
            if f"candidate:id={candidate_id}" in content:
                skipped += 1
                continue
            content = _append_flush_candidate(content, memory, candidate_id)
            staged += 1
        if staged:
            manager.locked_write(daily_file, content)

    return {"staged": staged, "skipped": skipped, "path": str(daily_file)}


def _extract_flush_candidates(messages: list[dict[str, Any]]) -> list[str]:
    candidates: list[str] = []
    seen: set[str] = set()
    for message in messages:
        if message.get("role") != "user":
            continue
        content = redact_memory_text(str(message.get("content") or ""))
        if not content or not _has_flush_signal(content):
            continue
        normalized = " ".join(content.split())
        if normalized in seen:
            continue
        seen.add(normalized)
        candidates.append(normalized)
    return candidates


def _has_flush_signal(text: str) -> bool:
    lowered = text.lower()
    return any(term in lowered for term in _FLUSH_TERMS)


def _ensure_flush_section(content: str) -> str:
    today = date.today().isoformat()
    if not content.strip():
        return f"# Daily Memory {today}\n\n## 自动记忆刷新\n\n"
    if "## 自动记忆刷新" in content:
        return content
    separator = "" if content.endswith("\n") else "\n"
    return f"{content}{separator}\n## 自动记忆刷新\n\n"


def _append_flush_candidate(content: str, memory: str, candidate_id: str) -> str:
    line = (
        f"- {memory} "
        f"<!-- candidate:id={candidate_id}; status=pending; source=compaction_flush -->"
    )
    return f"{content.rstrip()}\n\n{line}\n"


def _flush_candidate_id(memory: str) -> str:
    digest = hashlib.sha1(memory.encode("utf-8")).hexdigest()[:10]
    return f"flush_{date.today().strftime('%Y%m%d')}_{digest}"
