import hashlib
import re
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any

from app.core.markdown_memory import MarkdownMemoryManager


_PROMOTION_KEYWORDS = ("记住", "以后", "偏好", "喜欢", "希望", "决定", "确认")
_USER_PREFERENCES_HEADING = "## 用户偏好"
_BULLET_RE = re.compile(r"^\s*[-*]\s+(?P<body>.*)$")
_HTML_COMMENT_RE = re.compile(r"\s*<!--.*?-->\s*")


@dataclass(frozen=True)
class ConsolidationResult:
    promoted: list[dict[str, Any]]
    skipped: list[dict[str, Any]]
    duplicate: list[dict[str, Any]]
    report_path: str
    memory_path: str


def consolidate_memory(
    manager: MarkdownMemoryManager | None = None,
    profile_id: str | None = None,
) -> ConsolidationResult:
    active_manager = manager or MarkdownMemoryManager(profile_id=profile_id)
    today = date.today().isoformat()
    with active_manager.write_lock():
        candidates = [
            candidate
            for candidate in active_manager.list_candidates()
            if not _is_dreams_source(candidate)
        ]

        memory_content = active_manager.read_memory_markdown()
        existing_texts = _existing_memory_texts(memory_content)
        promoted: list[dict[str, Any]] = []
        skipped: list[dict[str, Any]] = []
        duplicate: list[dict[str, Any]] = []
        promoted_lines: list[str] = []

        for candidate in candidates:
            memory = str(candidate.get("memory") or "").strip()
            candidate_id = str(candidate.get("id") or "").strip()
            if not memory or not candidate_id:
                skipped.append({**candidate, "reason": "invalid"})
                continue

            if not _is_promotable(memory):
                skipped.append({**candidate, "reason": "no_promotion_keyword"})
                continue

            if memory in existing_texts or f"candidate={candidate_id}" in memory_content:
                duplicate.append({**candidate, "reason": "already_promoted"})
                continue

            memory_id = _memory_id(today, candidate_id, memory)
            source = _source_for_report(active_manager, candidate)
            line = (
                f"- {memory} "
                f"<!-- memory:id={memory_id}; source={source}; "
                f"candidate={candidate_id}; confidence=0.8 -->"
            )
            promoted_lines.append(line)
            promoted.append(
                {
                    **candidate,
                    "memory_id": memory_id,
                    "source": source,
                    "confidence": 0.8,
                }
            )
            existing_texts.add(memory)

        if promoted_lines:
            updated_memory = _insert_user_preferences(memory_content, promoted_lines)
            active_manager.locked_write(active_manager.paths.memory_file, updated_memory)

        report = _build_report(today, candidates, promoted, skipped, duplicate)
        _append_dreams_report(active_manager, report)

    return ConsolidationResult(
        promoted=promoted,
        skipped=skipped,
        duplicate=duplicate,
        report_path=str(active_manager.paths.dreams_file),
        memory_path=str(active_manager.paths.memory_file),
    )


def _is_promotable(memory: str) -> bool:
    return any(keyword in memory for keyword in _PROMOTION_KEYWORDS)


def _is_dreams_source(candidate: dict[str, Any]) -> bool:
    source_path = str(candidate.get("sourcePath") or candidate.get("source_path") or "")
    return Path(source_path).name.lower() == "dreams.md"


def _memory_id(today: str, candidate_id: str, memory: str) -> str:
    digest = hashlib.sha1(f"{candidate_id}:{memory}".encode("utf-8")).hexdigest()[:8]
    return f"mem_{today.replace('-', '')}_{digest}"


def _source_for_report(
    manager: MarkdownMemoryManager,
    candidate: dict[str, Any],
) -> str:
    source_path = Path(str(candidate.get("sourcePath") or ""))
    if not source_path:
        return ""
    try:
        return source_path.relative_to(manager.paths.profile_root).as_posix()
    except ValueError:
        return source_path.as_posix()


def _existing_memory_texts(memory_content: str) -> set[str]:
    texts: set[str] = set()
    for line in memory_content.splitlines():
        bullet = _BULLET_RE.match(line)
        if not bullet:
            continue
        memory = _HTML_COMMENT_RE.sub("", bullet.group("body")).strip()
        if memory:
            texts.add(memory)
    return texts


def _insert_user_preferences(content: str, lines: list[str]) -> str:
    block = "\n".join(lines)
    section_match = re.search(
        rf"^{re.escape(_USER_PREFERENCES_HEADING)}\s*$",
        content,
        flags=re.MULTILINE,
    )
    if section_match is None:
        base = content.rstrip()
        return f"{base}\n\n{_USER_PREFERENCES_HEADING}\n\n{block}\n"

    search_start = section_match.end()
    next_heading_match = re.search(
        r"^#{1,6}\s+",
        content[search_start:],
        flags=re.MULTILINE,
    )
    insert_at = (
        search_start + next_heading_match.start()
        if next_heading_match is not None
        else len(content)
    )

    before = content[:insert_at].rstrip()
    after = content[insert_at:].lstrip("\n")
    updated = f"{before}\n\n{block}\n"
    if after:
        updated += f"\n{after}"
    return updated


def _build_report(
    today: str,
    candidates: list[dict[str, Any]],
    promoted: list[dict[str, Any]],
    skipped: list[dict[str, Any]],
    duplicate: list[dict[str, Any]],
) -> str:
    rem_summary = _rem_summary(candidates)
    deep_lines = [
        f"- promoted: {len(promoted)}",
        *_report_items(promoted),
        f"- skipped: {len(skipped)}",
        *_report_items(skipped),
        f"- duplicate: {len(duplicate)}",
        *_report_items(duplicate),
    ]
    return (
        f"## {today} 记忆整理\n\n"
        "### Light\n\n"
        f"- 候选数量: {len(candidates)}\n\n"
        "### REM\n\n"
        f"- 主题/摘要: {rem_summary}\n\n"
        "### Deep\n\n"
        f"{chr(10).join(deep_lines)}\n"
    )


def _rem_summary(candidates: list[dict[str, Any]]) -> str:
    if not candidates:
        return "本轮没有候选记忆。"
    snippets = [str(candidate.get("memory") or "").strip() for candidate in candidates]
    snippets = [snippet for snippet in snippets if snippet]
    if not snippets:
        return "候选记忆缺少可整理文本。"
    return "；".join(snippets[:3])


def _report_items(items: list[dict[str, Any]]) -> list[str]:
    lines: list[str] = []
    for item in items:
        memory = str(item.get("memory") or "").strip()
        candidate_id = str(item.get("id") or "").strip()
        reason = str(item.get("reason") or "").strip()
        suffix = f"; reason={reason}" if reason else ""
        lines.append(f"  - {candidate_id}: {memory}{suffix}")
    return lines


def _append_dreams_report(manager: MarkdownMemoryManager, report: str) -> None:
    with manager.write_lock():
        path = manager.paths.dreams_file
        existing = path.read_text(encoding="utf-8") if path.exists() else ""
        separator = "\n\n" if existing.strip() else ""
        manager.locked_write(path, f"{existing.rstrip()}{separator}{report}")
