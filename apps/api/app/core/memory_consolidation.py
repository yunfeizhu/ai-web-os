import hashlib
import json
import re
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Any

from app.core.markdown_memory import MarkdownMemoryManager


_PROMOTION_KEYWORDS = (
    "记住",
    "记录",
    "以后",
    "偏好",
    "喜欢",
    "希望",
    "决定",
    "确认",
    "remember",
    "note that",
)
_USER_PREFERENCES_HEADING = "## 用户偏好"
_BULLET_RE = re.compile(r"^\s*[-*]\s+(?P<body>.*)$")
_HTML_COMMENT_RE = re.compile(r"\s*<!--.*?-->\s*")
_DEEP_PROMOTION_MIN_SCORE = 0.8
_DEEP_MIN_RECALL_COUNT = 2
_DEEP_MIN_UNIQUE_QUERIES = 2


@dataclass(frozen=True)
class ConsolidationResult:
    promoted: list[dict[str, Any]]
    skipped: list[dict[str, Any]]
    duplicate: list[dict[str, Any]]
    report_path: str
    memory_path: str
    state_path: str = ""
    phase_signal_path: str = ""


@dataclass(frozen=True)
class LightPhaseResult:
    candidates: list[dict[str, Any]]
    recall_stats: dict[str, dict[str, Any]]
    signal_stats: dict[str, dict[str, Any]]
    candidate_count: int


@dataclass(frozen=True)
class RemPhaseResult:
    summary: str


def consolidate_memory(
    manager: MarkdownMemoryManager | None = None,
    profile_id: str | None = None,
) -> ConsolidationResult:
    active_manager = manager or MarkdownMemoryManager(profile_id=profile_id)
    with active_manager.write_lock():
        light = run_light_phase(active_manager)
        rem = run_rem_phase(light)
        return run_deep_phase(active_manager, light, rem)


def run_light_phase(manager: MarkdownMemoryManager) -> LightPhaseResult:
    candidates = [
        candidate
        for candidate in [*manager.list_candidates(), *manager.list_transcript_candidates()]
        if not _is_dreams_source(candidate)
    ]
    recall_stats = _recall_stats_by_id(manager.paths.dreams_state_dir / "recall-traces.json")
    signal_stats = _signal_stats_by_memory(candidates, recall_stats)
    return LightPhaseResult(
        candidates=candidates,
        recall_stats=recall_stats,
        signal_stats=signal_stats,
        candidate_count=len(candidates),
    )


def run_rem_phase(light: LightPhaseResult) -> RemPhaseResult:
    return RemPhaseResult(summary=_rem_summary(light.candidates))


def run_deep_phase(
    manager: MarkdownMemoryManager,
    light: LightPhaseResult,
    rem: RemPhaseResult,
) -> ConsolidationResult:
    today = date.today().isoformat()
    with manager.write_lock():
        candidates = light.candidates
        memory_content = manager.read_memory_markdown()
        existing_texts = _existing_memory_texts(memory_content)
        promoted: list[dict[str, Any]] = []
        skipped: list[dict[str, Any]] = []
        duplicate: list[dict[str, Any]] = []
        promoted_lines: list[str] = []
        signal_stats = light.signal_stats

        for candidate in candidates:
            memory = str(candidate.get("memory") or "").strip()
            candidate_id = str(candidate.get("id") or "").strip()
            if not memory or not candidate_id:
                skipped.append({**candidate, "reason": "invalid"})
                continue

            decision = _deep_promotion_decision(
                memory,
                signal_stats.get(_normalize_memory_text(memory)) or _empty_signal_stats(),
            )
            if not decision["promote"]:
                skipped.append(
                    {
                        **candidate,
                        "reason": "below_deep_threshold",
                        "score": decision["score"],
                        "reasons": decision["reasons"],
                    }
                )
                continue

            if memory in existing_texts or f"candidate={candidate_id}" in memory_content:
                duplicate.append(
                    {
                        **candidate,
                        "reason": "already_promoted",
                        "score": decision["score"],
                        "reasons": decision["reasons"],
                    }
                )
                continue

            memory_id = _memory_id(today, candidate_id, memory)
            source = _source_for_report(manager, candidate)
            line = f"- {memory}"
            promoted_lines.append(line)
            promoted.append(
                {
                    **candidate,
                    "memory_id": memory_id,
                    "source": source,
                    "confidence": 0.8,
                    "score": decision["score"],
                    "reasons": decision["reasons"],
                }
            )
            existing_texts.add(memory)

        if promoted_lines:
            updated_memory = _insert_user_preferences(memory_content, promoted_lines)
            manager.locked_write(manager.paths.memory_file, updated_memory)

        manager.update_candidate_status(
            {str(item.get("id")) for item in promoted if item.get("id")},
            "promoted",
        )
        manager.update_candidate_status(
            {str(item.get("id")) for item in duplicate if item.get("id")},
            "duplicate",
        )
        manager.update_candidate_status(
            {str(item.get("id")) for item in skipped if item.get("id")},
            "skipped",
        )

        state_path = manager.paths.dreams_state_dir / "short-term.json"
        phase_signal_path = manager.paths.dreams_state_dir / "phase-signals.json"
        _write_dreaming_state(
            manager,
            candidates,
            promoted=promoted,
            skipped=skipped,
            duplicate=duplicate,
            state_path=state_path,
            phase_signal_path=phase_signal_path,
        )

        report = _build_report(
            today,
            candidates,
            promoted,
            skipped,
            duplicate,
            rem_summary=rem.summary,
        )
        _append_dreams_report(manager, report)

        return ConsolidationResult(
            promoted=promoted,
            skipped=skipped,
            duplicate=duplicate,
            report_path=str(manager.paths.dreams_file),
            memory_path=str(manager.paths.memory_file),
            state_path=str(state_path),
            phase_signal_path=str(phase_signal_path),
        )


def get_dreaming_status(
    manager: MarkdownMemoryManager | None = None,
    profile_id: str | None = None,
) -> dict[str, Any]:
    from app.core.memory_dreaming import get_dreaming_runtime_status

    active_manager = manager or MarkdownMemoryManager(profile_id=profile_id)
    state_path = active_manager.paths.dreams_state_dir / "short-term.json"
    phase_signal_path = active_manager.paths.dreams_state_dir / "phase-signals.json"
    state = _read_json_file(state_path, default={"version": 1, "entries": {}})
    signals = _read_json_file(phase_signal_path, default={"version": 1})
    entries = state.get("entries") if isinstance(state.get("entries"), dict) else {}
    pending_candidates = active_manager.list_candidates()
    return {
        "state_path": str(state_path),
        "phase_signal_path": str(phase_signal_path),
        "short_term_entries": len(entries),
        "pending_candidates": len(pending_candidates),
        "short_term": state,
        "phase_signals": signals,
        "runtime": get_dreaming_runtime_status(active_manager),
    }


def _is_promotable(memory: str) -> bool:
    return any(keyword in memory for keyword in _PROMOTION_KEYWORDS)


def _deep_promotion_decision(memory: str, recall_stats: dict[str, Any]) -> dict[str, Any]:
    reasons: list[str] = []
    explicit = _is_promotable(memory)
    recall_count = int(recall_stats.get("recallCount") or 0)
    unique_query_hashes = [
        str(value)
        for value in recall_stats.get("uniqueQueryHashes", [])
        if str(value).strip()
    ]
    source_days = {
        str(value)
        for value in recall_stats.get("sourceDays", [])
        if str(value).strip()
    }
    source_count = int(recall_stats.get("sourceCount") or 0)
    unique_query_count = len(set(unique_query_hashes))

    frequency_signal = min(source_count / 2, 1.0) if source_count else 0.0
    relevance_signal = min(recall_count / _DEEP_MIN_RECALL_COUNT, 1.0)
    query_diversity_signal = min(unique_query_count / _DEEP_MIN_UNIQUE_QUERIES, 1.0)
    recency_signal = _recency_signal(source_days)
    consolidation_signal = 1.0 if len(source_days) >= 2 else 0.0
    richness_signal = _conceptual_richness(memory)

    score = (
        frequency_signal * 0.24
        + relevance_signal * 0.30
        + query_diversity_signal * 0.15
        + recency_signal * 0.15
        + consolidation_signal * 0.10
        + richness_signal * 0.06
    )

    if explicit:
        score = max(score, _DEEP_PROMOTION_MIN_SCORE)
        reasons.append("explicit_memory_intent")

    if recall_count:
        reasons.append(f"recall_count:{recall_count}")
    if unique_query_hashes:
        reasons.append(f"unique_queries:{unique_query_count}")

    if source_count:
        reasons.append(f"frequency:{source_count}")
    if source_days:
        reasons.append(f"recency:{recency_signal:.2f}")
        if len(source_days) >= 2:
            reasons.append(f"multi_day_recurrence:{len(source_days)}")
        else:
            reasons.append("single_day_signal")

    if richness_signal:
        reasons.append(f"conceptual_richness:{richness_signal:.2f}")

    if not explicit and recall_count < _DEEP_MIN_RECALL_COUNT:
        reasons.append(f"min_recall_not_met:{recall_count}<{_DEEP_MIN_RECALL_COUNT}")
    elif not explicit:
        reasons.append(f"recall_gate_passed:{recall_count}")

    if not explicit and unique_query_count < _DEEP_MIN_UNIQUE_QUERIES:
        reasons.append(
            f"min_unique_queries_not_met:{unique_query_count}<{_DEEP_MIN_UNIQUE_QUERIES}"
        )
    elif not explicit:
        reasons.append(f"query_diversity_gate_passed:{unique_query_count}")

    gates_pass = explicit or (
        recall_count >= _DEEP_MIN_RECALL_COUNT
        and unique_query_count >= _DEEP_MIN_UNIQUE_QUERIES
    )
    if score < _DEEP_PROMOTION_MIN_SCORE:
        reasons.append("below_min_score")
    if not gates_pass:
        reasons.append("below_signal_gates")

    return {
        "promote": gates_pass and score >= _DEEP_PROMOTION_MIN_SCORE,
        "score": round(score, 3),
        "reasons": reasons,
    }


def _empty_signal_stats() -> dict[str, Any]:
    return {
        "recallCount": 0,
        "uniqueQueryHashes": [],
        "sourceDays": [],
        "sourceCount": 0,
    }


def _signal_stats_by_memory(
    candidates: list[dict[str, Any]],
    recall_stats: dict[str, dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    grouped: dict[str, dict[str, Any]] = {}
    for candidate in candidates:
        memory = str(candidate.get("memory") or "").strip()
        candidate_id = str(candidate.get("id") or "").strip()
        if not memory or not candidate_id:
            continue
        key = _normalize_memory_text(memory)
        stats = grouped.setdefault(
            key,
            {
                "recallCount": 0,
                "uniqueQueryHashes": set(),
                "sourceDays": set(),
                "sourceCount": 0,
            },
        )
        candidate_recall = recall_stats.get(candidate_id) or {}
        stats["recallCount"] += int(candidate_recall.get("recallCount") or 0)
        stats["uniqueQueryHashes"].update(
            str(value)
            for value in candidate_recall.get("uniqueQueryHashes", [])
            if str(value).strip()
        )
        stats["sourceCount"] += 1
        day = _candidate_source_day(candidate)
        if day:
            stats["sourceDays"].add(day)

    return {
        key: {
            "recallCount": stats["recallCount"],
            "uniqueQueryHashes": sorted(stats["uniqueQueryHashes"]),
            "sourceDays": sorted(stats["sourceDays"]),
            "sourceCount": stats["sourceCount"],
        }
        for key, stats in grouped.items()
    }


def _candidate_source_day(candidate: dict[str, Any]) -> str:
    source_path = Path(str(candidate.get("sourcePath") or ""))
    try:
        parsed = date.fromisoformat(source_path.stem)
    except ValueError:
        return ""
    return parsed.isoformat()


def _recency_signal(source_days: set[str]) -> float:
    if not source_days:
        return 0.0
    today = date.today()
    best = 0.0
    for value in source_days:
        try:
            source_day = date.fromisoformat(value)
        except ValueError:
            continue
        age_days = max((today - source_day).days, 0)
        if age_days <= 1:
            best = max(best, 1.0)
        elif age_days <= 7:
            best = max(best, 0.6)
        else:
            best = max(best, 0.2)
    return best


def _normalize_memory_text(memory: str) -> str:
    return re.sub(r"\s+", "", memory.strip().lower())


def _conceptual_richness(memory: str) -> float:
    normalized = memory.strip()
    if not normalized:
        return 0.0
    score = 0.0
    if len(normalized) >= 12:
        score += 0.3
    if re.search(r"[:：()（）《》0-9]", normalized):
        score += 0.25
    if any(term in normalized for term in ("用户", "偏好", "默认", "职业", "项目", "决定", "计划")):
        score += 0.3
    if len(set(normalized)) >= 8:
        score += 0.15
    return min(score, 1.0)


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
    rem_summary: str | None = None,
) -> str:
    summary = rem_summary if rem_summary is not None else _rem_summary(candidates)
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
        f"- 主题/摘要: {summary}\n\n"
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
        score = item.get("score")
        reasons = item.get("reasons") if isinstance(item.get("reasons"), list) else []
        metadata_parts: list[str] = []
        if reason:
            metadata_parts.append(f"reason={reason}")
        if isinstance(score, int | float):
            metadata_parts.append(f"score={score:.3f}")
        if reasons:
            metadata_parts.append(
                "reasons=" + ",".join(str(value) for value in reasons)
            )
        suffix = f"; {'; '.join(metadata_parts)}" if metadata_parts else ""
        lines.append(f"  - {candidate_id}: {memory}{suffix}")
    return lines


def _append_dreams_report(manager: MarkdownMemoryManager, report: str) -> None:
    with manager.write_lock():
        path = manager.paths.dreams_file
        existing = path.read_text(encoding="utf-8") if path.exists() else ""
        separator = "\n\n" if existing.strip() else ""
        manager.locked_write(path, f"{existing.rstrip()}{separator}{report}")


def _write_dreaming_state(
    manager: MarkdownMemoryManager,
    candidates: list[dict[str, Any]],
    *,
    promoted: list[dict[str, Any]],
    skipped: list[dict[str, Any]],
    duplicate: list[dict[str, Any]],
    state_path: Path,
    phase_signal_path: Path,
) -> None:
    now = datetime.now().isoformat(timespec="seconds")
    state = _read_json_file(state_path, default={"version": 1, "entries": {}})
    recall_stats = _recall_stats_by_id(manager.paths.dreams_state_dir / "recall-traces.json")
    entries: dict[str, Any] = dict(state.get("entries") or {})

    status_by_id = {
        **{str(item.get("id")): "promoted" for item in promoted if item.get("id")},
        **{str(item.get("id")): "skipped" for item in skipped if item.get("id")},
        **{str(item.get("id")): "duplicate" for item in duplicate if item.get("id")},
    }
    decisions_by_id = {
        str(item.get("id")): {
            "score": item.get("score"),
            "reasons": item.get("reasons") or [],
            "reason": item.get("reason") or "",
        }
        for item in [*promoted, *skipped, *duplicate]
        if item.get("id")
    }
    source_paths_by_id: dict[str, set[str]] = {}
    for candidate in candidates:
        candidate_id = str(candidate.get("id") or "").strip()
        if not candidate_id:
            continue
        source_paths_by_id.setdefault(candidate_id, set()).add(
            str(candidate.get("sourcePath") or "")
        )
        existing = dict(entries.get(candidate_id) or {})
        previous_sources = {
            str(path)
            for path in existing.get("sourcePaths", [])
            if str(path).strip()
        }
        sources = sorted(previous_sources | source_paths_by_id[candidate_id])
        recall_stats_for_candidate = recall_stats.get(candidate_id) or {
            "recallCount": 0,
            "uniqueQueryHashes": [],
        }
        decision = decisions_by_id.get(candidate_id) or {}
        entries[candidate_id] = {
            "id": candidate_id,
            "text": str(candidate.get("memory") or "").strip(),
            "kind": "candidate",
            "status": status_by_id.get(candidate_id, existing.get("status") or "staged"),
            "firstSeen": existing.get("firstSeen") or now,
            "lastSeen": now,
            "sourcePaths": sources,
            "frequency": max(int(existing.get("frequency") or 0), len(sources), 1),
            "recallCount": recall_stats_for_candidate["recallCount"],
            "uniqueQueryHashes": recall_stats_for_candidate["uniqueQueryHashes"],
            "score": decision.get("score", existing.get("score", 0)),
            "reasons": decision.get("reasons", existing.get("reasons", [])),
            "reason": decision.get("reason", existing.get("reason", "")),
        }

    state_payload = {"version": 1, "updatedAt": now, "entries": entries}
    phase_payload = {
        "version": 1,
        "updatedAt": now,
        "light": {
            "candidates": len(candidates),
            "staged": sum(
                1
                for candidate in candidates
                if status_by_id.get(str(candidate.get("id") or "")) is None
            ),
        },
        "rem": {"summary": _rem_summary(candidates)},
        "deep": {
            "promoted": len(promoted),
            "skipped": len(skipped),
            "duplicate": len(duplicate),
        },
    }
    manager.locked_write(
        state_path,
        json.dumps(state_payload, ensure_ascii=False, indent=2) + "\n",
        backup=False,
    )
    manager.locked_write(
        phase_signal_path,
        json.dumps(phase_payload, ensure_ascii=False, indent=2) + "\n",
        backup=False,
    )


def _read_json_file(path: Path, *, default: dict[str, Any]) -> dict[str, Any]:
    if not path.exists():
        return default
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return default
    return data if isinstance(data, dict) else default


def _recall_stats_by_id(path: Path) -> dict[str, dict[str, Any]]:
    payload = _read_json_file(path, default={"version": 1, "traces": []})
    traces = payload.get("traces") if isinstance(payload.get("traces"), list) else []
    query_hashes: dict[str, set[str]] = {}
    recall_counts: dict[str, int] = {}
    for trace in traces:
        if not isinstance(trace, dict):
            continue
        query_hash = str(trace.get("queryHash") or "").strip()
        hit_ids = trace.get("hitIds") if isinstance(trace.get("hitIds"), list) else []
        for hit_id_value in hit_ids:
            hit_id = str(hit_id_value or "").strip()
            if not hit_id:
                continue
            recall_counts[hit_id] = recall_counts.get(hit_id, 0) + 1
            if query_hash:
                query_hashes.setdefault(hit_id, set()).add(query_hash)

    return {
        hit_id: {
            "recallCount": recall_counts.get(hit_id, 0),
            "uniqueQueryHashes": sorted(query_hashes.get(hit_id, set())),
        }
        for hit_id in recall_counts
    }
