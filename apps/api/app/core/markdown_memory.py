import hashlib
import json
import re
import threading
import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

from app.core.memory_paths import MemoryPaths, ensure_memory_profile


_LONG_TERM_COMMENT_RE = re.compile(r"<!--\s*memory:(?P<meta>.*?)\s*-->")
_CANDIDATE_COMMENT_RE = re.compile(r"<!--\s*candidate:(?P<meta>.*?)\s*-->")
_BULLET_RE = re.compile(r"^(?P<prefix>\s*[-*]\s+)(?P<body>.*)$")
_HEADING_RE = re.compile(r"^#{1,6}\s+(?P<title>.+?)\s*$")
_PROFILE_WRITE_LOCKS_GUARD = threading.Lock()
_PROFILE_WRITE_LOCKS: dict[str, Any] = {}
_MEMORY_KEYWORDS = (
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
_MEMORY_SECTIONS = {
    "memory",
    "用户画像",
    "用户偏好",
    "项目与长期目标",
    "事实与背景",
    "兴趣与关注",
    "工作方式",
    "长期记忆",
    "从旧版记忆导入",
    "profile",
    "preferences",
    "projects",
    "facts",
    "long-term memory",
    "imported memory",
}
_ASCII_TERM_RE = re.compile(r"[a-z0-9][a-z0-9_.:-]*")
_CJK_TEXT_RE = re.compile(r"[\u3400-\u9fff]+")
_IDENTITY_QUERY_TERMS = (
    "我是谁",
    "我是什么人",
    "我叫什么",
    "我的名字",
    "姓名",
    "名字",
    "关于我",
    "了解我",
    "记得我",
    "你记得我",
    "who am i",
    "what is my name",
    "what do you know about me",
)
_PROFILE_MEMORY_TERMS = (
    "name is",
    "姓名",
    "名字",
    "我叫",
    "我是",
    "职业",
    "所在",
    "城市",
    "最近在做",
    "正在做",
)
_GAME_QUERY_TERMS = ("游戏", "玩什么", "在玩", "玩过")
_GAME_MEMORY_TERMS = ("游戏", "在玩", "玩过", "通关", "魂类", "rpg")
_IMPLICIT_RECENT_ACTIVITY_RE = re.compile(
    r"^(?:我)?(?:最近|现在|目前|这段时间|这阵子|这几天|最近这段时间)"
    r"(?:一直|主要|正在|也|还|又|会|可能|打算|准备|计划|很)?"
    r"(?:在)?(?:玩|看|学|做|用|关注|研究|准备|计划|尝试|练|写|读|追|打|折腾)"
)
_QUESTION_OR_LOOKUP_TERMS = (
    "?",
    "？",
    "什么",
    "怎么",
    "如何",
    "为什么",
    "多少",
    "哪里",
    "哪儿",
    "哪个",
    "哪些",
    "吗",
    "是否",
    "能不能",
    "有没有",
)
_TASK_REQUEST_PREFIXES = (
    "帮我",
    "请帮",
    "查一下",
    "搜一下",
    "搜索",
    "推荐",
    "列出",
    "生成",
    "解释",
)
_SEMANTIC_GROUPS = (
    ("语言", "中文", "回复", "回答", "沟通", "language", "answer", "response", "reply", "chinese"),
    ("职业", "工作", "前端", "工程师", "job", "work", "profession", "engineer", "developer"),
    ("游戏", "玩", "通关", "game", "play", "gaming"),
    ("偏好", "喜欢", "默认", "prefer", "preference", "default"),
    ("项目", "计划", "目标", "project", "plan", "goal"),
)


@dataclass(frozen=True)
class MemoryRecord:
    id: str
    memory: str
    kind: str
    source_path: str
    line: int | None = None
    score: float | None = None
    confidence: float | None = None
    status: str | None = None
    created_at: str | None = None
    match_mode: str | None = None

    def to_compat_dict(self) -> dict[str, Any]:
        result: dict[str, Any] = {
            "id": self.id,
            "memory": self.memory,
            "kind": self.kind,
            "sourcePath": self.source_path,
        }
        if self.line is not None:
            result["line"] = self.line
        if self.score is not None:
            result["score"] = self.score
        if self.confidence is not None:
            result["confidence"] = self.confidence
        if self.status is not None:
            result["status"] = self.status
        if self.created_at is not None:
            result["created_at"] = self.created_at
        if self.match_mode is not None:
            result["matchMode"] = self.match_mode
        return result


class MarkdownMemoryManager:
    def __init__(self, profile_id: str | None = None, *, paths: MemoryPaths | None = None):
        self.paths = paths or ensure_memory_profile(profile_id)
        self._write_lock = _profile_write_lock(self.paths.profile_root)
        self._started = False

    def start(self) -> None:
        self._started = True

    def stop(self) -> None:
        self._started = False

    def metadata(self) -> dict[str, Any]:
        return {
            "backend": "markdown",
            "collection": f"markdown:{self.paths.profile_id}",
            "profile_id": self.paths.profile_id,
            "memory_root": str(self.paths.memory_root),
            "memory_file": str(self.paths.memory_file),
            "dreams_file": str(self.paths.dreams_file),
            "daily_dir": str(self.paths.daily_dir),
            "initialized": True,
        }

    async def get_all(self, user_id: str = "default") -> list[dict[str, Any]]:
        return [record.to_compat_dict() for record in self._read_long_term_records()]

    async def search(
        self,
        query: str,
        user_id: str = "default",
        limit: int = 5,
    ) -> list[dict[str, Any]]:
        scored_records: list[MemoryRecord] = []
        for record in [
            *self._read_long_term_records(),
            *self._read_candidate_records(),
            *self._read_transcript_records(),
        ]:
            score = _score_text(query, record.memory)
            if score > 0:
                scored_records.append(
                    MemoryRecord(
                        id=record.id,
                        memory=record.memory,
                        kind=record.kind,
                        source_path=record.source_path,
                        line=record.line,
                        score=score,
                        confidence=record.confidence,
                        status=record.status,
                        created_at=record.created_at,
                        match_mode="hybrid",
                    )
                )

        scored_records.sort(key=lambda record: record.score or 0, reverse=True)
        return [record.to_compat_dict() for record in scored_records[:limit]]

    async def recall_context(
        self,
        query: str,
        user_id: str = "default",
        limit: int = 5,
        *,
        min_score: float = 0.45,
    ) -> dict[str, Any]:
        daily_notes = self.list_recent_daily_context()
        raw_recalled = [
            memory
            for memory in await self.search(query=query, user_id=user_id, limit=limit)
            if isinstance(memory, dict)
            and memory.get("memory")
            and (memory.get("score") or 0) >= min_score
        ]
        self._record_recall_trace(query, raw_recalled, daily_notes)
        recalled = raw_recalled
        recalled = _dedupe_recalled_against_daily(recalled, daily_notes)
        return {
            "recalled": recalled,
            "dailyNotes": daily_notes,
            "prompt": _format_recall_context(recalled, daily_notes),
        }

    async def add_async(self, user_id: str, messages: list[dict[str, Any]]) -> None:
        candidate = _extract_candidate_memory(messages)
        if not candidate:
            return

        with self.write_lock():
            today = date.today().isoformat()
            candidate_id = _candidate_id(today, candidate)
            daily_file = self.paths.daily_dir / f"{today}.md"
            existing = daily_file.read_text(encoding="utf-8") if daily_file.exists() else ""
            if f"candidate:id={candidate_id}" in existing:
                return

            content = _ensure_candidate_section(existing, today)
            line = (
                f"- {candidate} "
                f"<!-- candidate:id={candidate_id}; status=pending; user_id={user_id} -->"
            )
            content = _insert_into_candidate_section(content, line)
            self.locked_write(daily_file, content)

    async def delete(self, memory_id: str) -> None:
        with self.write_lock():
            lines = self.read_memory_markdown().splitlines(keepends=True)
            kept_lines: list[str] = []
            current_heading: str | None = None
            for index, line in enumerate(lines, start=1):
                current_heading = _next_heading(current_heading, line)
                record_id = self._parse_long_term_line(
                    line,
                    self.paths.memory_file,
                    index,
                    current_heading,
                )
                if record_id and record_id.id == memory_id:
                    continue
                kept_lines.append(line)
            self.locked_write(self.paths.memory_file, "".join(kept_lines))

    async def delete_all(self, user_id: str = "default") -> None:
        with self.write_lock():
            lines = self.read_memory_markdown().splitlines(keepends=True)
            kept_lines: list[str] = []
            current_heading: str | None = None
            for index, line in enumerate(lines, start=1):
                current_heading = _next_heading(current_heading, line)
                if (
                    self._parse_long_term_line(
                        line,
                        self.paths.memory_file,
                        index,
                        current_heading,
                    )
                    is None
                ):
                    kept_lines.append(line)
            self.locked_write(self.paths.memory_file, "".join(kept_lines))

    def list_candidates(self, *, include_resolved: bool = False) -> list[dict[str, Any]]:
        records = [record.to_compat_dict() for record in self._read_candidate_records()]
        if include_resolved:
            return records
        return [
            record
            for record in records
            if str(record.get("status") or "pending").lower() == "pending"
        ]

    def list_transcript_candidates(self) -> list[dict[str, Any]]:
        from app.core.memory_transcripts import list_transcript_candidates

        return list_transcript_candidates(self)

    def rebuild_search_index(self) -> dict[str, Any]:
        records = [
            *self._read_long_term_records(),
            *self._read_candidate_records(),
            *self._read_transcript_records(),
        ]
        payload = {
            "version": 1,
            "updatedAt": datetime.now().isoformat(timespec="seconds"),
            "records": [record.to_compat_dict() for record in records],
        }
        index_path = self.paths.dreams_state_dir / "search-index.json"
        self.locked_write(
            index_path,
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
            backup=False,
        )
        return {"indexed": len(records), "index_path": str(index_path)}

    def update_candidate_status(self, candidate_ids: set[str], status: str) -> None:
        if not candidate_ids:
            return
        normalized_status = status.strip().lower()
        if not normalized_status:
            return

        with self.write_lock():
            for _, daily_file in _recent_daily_files(self.paths.daily_dir, date.today(), 2):
                if not daily_file.exists():
                    continue
                content = daily_file.read_text(encoding="utf-8")
                updated = _update_candidate_status_content(
                    content,
                    candidate_ids,
                    normalized_status,
                )
                if updated != content:
                    self.locked_write(daily_file, updated)

    def list_recent_daily_context(
        self,
        *,
        today: date | None = None,
        days: int = 2,
        max_chars_per_file: int = 4000,
    ) -> list[dict[str, Any]]:
        reference_day = today or date.today()
        notes: list[dict[str, Any]] = []
        for daily_day, daily_file in _recent_daily_files(
            self.paths.daily_dir,
            reference_day,
            days,
        ):
            if not daily_file.exists():
                continue
            content = _clean_daily_context_content(
                daily_file.read_text(encoding="utf-8"),
                max_chars=max_chars_per_file,
            )
            if not _has_daily_signal(content):
                continue
            notes.append(
                {
                    "kind": "daily",
                    "day": daily_day.isoformat(),
                    "content": content,
                    "sourcePath": str(daily_file),
                }
            )
        return notes

    def read_memory_markdown(self) -> str:
        return self.paths.memory_file.read_text(encoding="utf-8")

    def write_memory_markdown(self, content: str) -> None:
        self.locked_write(self.paths.memory_file, content)

    def normalize_memory_markdown(self) -> bool:
        with self.write_lock():
            content = self.read_memory_markdown()
            normalized = _normalize_memory_markdown_content(content)
            if normalized == content:
                return False
            self.locked_write(self.paths.memory_file, normalized)
            return True

    def write_lock(self):
        return self._write_lock

    def locked_write(self, path: Path, content: str, *, backup: bool = True) -> None:
        with self.write_lock():
            path.parent.mkdir(parents=True, exist_ok=True)
            if backup and path.exists():
                self._backup_existing_file(path)
            self._atomic_replace(path, content)

    def _read_long_term_records(self) -> list[MemoryRecord]:
        lines = self.read_memory_markdown().splitlines()
        records: list[MemoryRecord] = []
        current_heading: str | None = None
        for index, line in enumerate(lines, start=1):
            current_heading = _next_heading(current_heading, line)
            record = self._parse_long_term_line(
                line,
                self.paths.memory_file,
                index,
                current_heading,
            )
            if record is not None:
                records.append(record)
        return records

    def _read_candidate_records(self) -> list[MemoryRecord]:
        records: list[MemoryRecord] = []
        for _, daily_file in _recent_daily_files(self.paths.daily_dir, date.today(), 2):
            if not daily_file.exists():
                continue
            for index, line in enumerate(
                daily_file.read_text(encoding="utf-8").splitlines(),
                start=1,
            ):
                record = self._parse_candidate_line(line, daily_file, index)
                if record is not None:
                    records.append(record)
        return records

    def _read_transcript_records(self) -> list[MemoryRecord]:
        return [
            MemoryRecord(
                id=str(candidate.get("id") or ""),
                memory=str(candidate.get("memory") or ""),
                kind=str(candidate.get("kind") or "transcript_candidate"),
                source_path=str(candidate.get("sourcePath") or ""),
                status=str(candidate.get("status") or "pending"),
            )
            for candidate in self.list_transcript_candidates()
            if str(candidate.get("id") or "").strip()
            and str(candidate.get("memory") or "").strip()
        ]

    def _parse_long_term_line(
        self,
        line: str,
        source_path: Path,
        line_number: int,
        section_heading: str | None = None,
    ) -> MemoryRecord | None:
        bullet = _BULLET_RE.match(line)
        if not bullet:
            return None

        body = bullet.group("body").strip()
        comment = _LONG_TERM_COMMENT_RE.search(body)
        if comment is None and not _is_memory_section(section_heading):
            return None

        metadata = _parse_metadata(comment.group("meta")) if comment else {}
        memory = _strip_html_comment(body).strip()
        if not memory:
            return None

        memory_id = metadata.get("id") or _manual_id(line_number, memory)
        return MemoryRecord(
            id=memory_id,
            memory=memory,
            kind="long_term",
            source_path=str(source_path),
            line=line_number or None,
            confidence=_parse_float(metadata.get("confidence")),
            status=metadata.get("status"),
            created_at=metadata.get("created_at"),
        )

    def _backup_daily_file(self, daily_file: Path) -> None:
        with self.write_lock():
            if daily_file.exists():
                self._backup_existing_file(daily_file)

    def _parse_candidate_line(
        self,
        line: str,
        source_path: Path,
        line_number: int,
    ) -> MemoryRecord | None:
        bullet = _BULLET_RE.match(line)
        if not bullet:
            return None

        body = bullet.group("body").strip()
        comment = _CANDIDATE_COMMENT_RE.search(body)
        if not comment:
            return None

        metadata = _parse_metadata(comment.group("meta"))
        candidate_id = metadata.get("id")
        memory = _strip_html_comment(body).strip()
        if not candidate_id or not memory:
            return None
        if _is_legacy_conversation_transcript(memory):
            return None

        return MemoryRecord(
            id=candidate_id,
            memory=memory,
            kind="candidate",
            source_path=str(source_path),
            line=line_number,
            status=metadata.get("status"),
            created_at=metadata.get("created_at"),
        )

    def _backup_memory_file(self) -> None:
        with self.write_lock():
            if self.paths.memory_file.exists():
                self._backup_existing_file(self.paths.memory_file)

    def _backup_existing_file(self, path: Path) -> None:
        self.paths.backups_dir.mkdir(parents=True, exist_ok=True)
        backup_file = self.paths.backups_dir / self._backup_filename(path)
        backup_file.write_text(path.read_text(encoding="utf-8"), encoding="utf-8")

    def _backup_filename(self, path: Path) -> str:
        timestamp = datetime.now().strftime("%Y%m%d%H%M%S%f")
        if _same_path(path, self.paths.memory_file):
            return f"MEMORY-{timestamp}.md"
        if _same_path(path, self.paths.dreams_file):
            return f"DREAMS-{timestamp}.md"
        if _same_path(path.parent, self.paths.daily_dir):
            day_stamp = path.stem.replace("-", "")
            return f"daily-{day_stamp}-{timestamp}.md"
        return f"{path.stem}-{timestamp}{path.suffix}"

    def _atomic_replace(self, path: Path, content: str) -> None:
        temp_file = path.with_name(
            f".{path.name}.{threading.get_ident()}.{uuid.uuid4().hex}.tmp"
        )
        try:
            temp_file.write_text(content, encoding="utf-8")
            temp_file.replace(path)
        finally:
            temp_file.unlink(missing_ok=True)

    def _record_recall_trace(
        self,
        query: str,
        recalled: list[dict[str, Any]],
        daily_notes: list[dict[str, Any]],
    ) -> None:
        hit_ids = [
            str(memory.get("id"))
            for memory in recalled
            if str(memory.get("id") or "").strip()
        ]
        daily_days = [
            str(note.get("day"))
            for note in daily_notes
            if str(note.get("day") or "").strip()
        ]
        if not hit_ids and not daily_days:
            return

        trace_path = self.paths.dreams_state_dir / "recall-traces.json"
        payload = _read_json_dict(trace_path, default={"version": 1, "traces": []})
        traces = payload.get("traces") if isinstance(payload.get("traces"), list) else []
        traces.append(
            {
                "at": datetime.now().isoformat(timespec="seconds"),
                "queryHash": hashlib.sha1(query.encode("utf-8")).hexdigest()[:16],
                "hitIds": hit_ids,
                "dailyDays": daily_days,
            }
        )
        payload = {"version": 1, "traces": traces[-100:]}
        self.locked_write(
            trace_path,
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
            backup=False,
        )


def _profile_write_lock(profile_root: Path):
    key = str(profile_root.resolve())
    with _PROFILE_WRITE_LOCKS_GUARD:
        lock = _PROFILE_WRITE_LOCKS.get(key)
        if lock is None:
            lock = threading.RLock()
            _PROFILE_WRITE_LOCKS[key] = lock
        return lock


def _same_path(left: Path, right: Path) -> bool:
    return left.resolve() == right.resolve()


def _read_json_dict(path: Path, *, default: dict[str, Any]) -> dict[str, Any]:
    if not path.exists():
        return default
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return default
    return data if isinstance(data, dict) else default


def _recent_daily_files(
    daily_dir: Path,
    today: date,
    days: int,
) -> list[tuple[date, Path]]:
    window = max(days, 0)
    daily_days = [today - timedelta(days=offset) for offset in range(window)]
    return [(day, daily_dir / f"{day.isoformat()}.md") for day in reversed(daily_days)]


def _clean_daily_context_content(content: str, *, max_chars: int) -> str:
    cleaned_lines: list[str] = []
    for line in content.splitlines():
        cleaned_line = _strip_html_comment(line).rstrip()
        if cleaned_line.strip():
            cleaned_lines.append(cleaned_line)

    cleaned = "\n".join(cleaned_lines).strip()
    if max_chars > 0 and len(cleaned) > max_chars:
        return cleaned[-max_chars:].lstrip()
    return cleaned


def _has_daily_signal(content: str) -> bool:
    for line in content.splitlines():
        stripped = line.strip()
        if stripped and not stripped.startswith("#"):
            return True
    return False


def _format_recall_context(
    recalled: list[dict[str, Any]],
    daily_notes: list[dict[str, Any]],
) -> str:
    sections: list[str] = []
    if recalled:
        facts = "\n".join(f"- {memory['memory']}" for memory in recalled)
        sections.append(f"## 关于用户的已知信息（来自记忆）\n{facts}")

    if daily_notes:
        day_blocks = [
            f"### {note['day']}\n{note['content']}"
            for note in daily_notes
            if note.get("content")
        ]
        if day_blocks:
            sections.append("## 近期记忆上下文\n" + "\n\n".join(day_blocks))

    return "\n\n".join(sections)


def _dedupe_recalled_against_daily(
    recalled: list[dict[str, Any]],
    daily_notes: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    daily_text = "\n".join(str(note.get("content") or "") for note in daily_notes)
    if not daily_text:
        return recalled
    return [
        memory
        for memory in recalled
        if str(memory.get("memory") or "").strip() not in daily_text
    ]


def _extract_candidate_memory(messages: list[dict[str, Any]]) -> str | None:
    last_user = _last_message_text(messages, "user")
    if not last_user:
        return None
    if _has_memory_intent(last_user):
        return last_user
    if _is_memory_clarification_followup(messages, last_user):
        return last_user
    if _is_implicit_recent_status(last_user):
        return last_user
    return None


def _has_memory_intent(text: str) -> bool:
    normalized = text.lower()
    return any(keyword in normalized for keyword in _MEMORY_KEYWORDS)


def _is_implicit_recent_status(text: str) -> bool:
    normalized = " ".join(str(text or "").split())
    if not normalized or len(normalized) > 160:
        return False
    if _is_question_or_task_like(normalized):
        return False
    return bool(_IMPLICIT_RECENT_ACTIVITY_RE.search(normalized))


def _is_question_or_task_like(text: str) -> bool:
    normalized = text.strip().lower()
    if any(normalized.startswith(prefix) for prefix in _TASK_REQUEST_PREFIXES):
        return True
    return any(term in normalized for term in _QUESTION_OR_LOOKUP_TERMS)


def _is_legacy_conversation_transcript(text: str) -> bool:
    normalized = text.strip().lower()
    return normalized.startswith("user:") and " / assistant:" in normalized


def _is_memory_clarification_followup(
    messages: list[dict[str, Any]],
    last_user: str,
) -> bool:
    if _is_negative_memory_reply(last_user):
        return False

    previous_assistant = _previous_message_text_before_last_user(messages, "assistant")
    previous_user = _previous_message_text_before_last_user(messages, "user")
    if not previous_assistant or not previous_user:
        return False
    if not _has_memory_intent(previous_user):
        return False

    assistant_text = previous_assistant.lower()
    asks_clarification = any(term in assistant_text for term in ("确认", "澄清", "具体"))
    mentions_memory = any(term in assistant_text for term in ("记录", "记住", "记忆", "保存"))
    if not asks_clarification or not mentions_memory:
        return False

    normalized_user = last_user.strip()
    if not normalized_user or len(normalized_user) > 160:
        return False
    return not normalized_user.endswith(("?", "？"))


def _is_negative_memory_reply(text: str) -> bool:
    normalized = text.strip().lower()
    return any(term in normalized for term in ("不用", "不要", "算了", "取消", "no", "cancel"))


def _previous_message_text_before_last_user(messages: list[dict[str, Any]], role: str) -> str:
    last_user_index: int | None = None
    for index in range(len(messages) - 1, -1, -1):
        if messages[index].get("role") == "user":
            last_user_index = index
            break
    if last_user_index is None:
        return ""

    for message in reversed(messages[:last_user_index]):
        if message.get("role") != role:
            continue
        content = message.get("content")
        if isinstance(content, str) and content.strip():
            return " ".join(content.split())
    return ""


def _last_message_text(messages: list[dict[str, Any]], role: str) -> str:
    for message in reversed(messages):
        if message.get("role") != role:
            continue
        content = message.get("content")
        if isinstance(content, str) and content.strip():
            return " ".join(content.split())
    return ""


def _ensure_candidate_section(content: str, today: str) -> str:
    if not content.strip():
        return f"# Daily Memory {today}\n\n## 候选记忆\n\n"
    if "## 候选记忆" in content:
        return content
    separator = "" if content.endswith("\n") else "\n"
    return f"{content}{separator}\n## 候选记忆\n\n"


def _insert_into_candidate_section(content: str, line: str) -> str:
    section_match = re.search(r"^## 候选记忆\s*$", content, flags=re.MULTILINE)
    if section_match is None:
        separator = "" if content.endswith("\n") else "\n"
        return f"{content}{separator}\n## 候选记忆\n\n{line}\n"

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

    before = content[:insert_at].rstrip("\n")
    after = content[insert_at:].lstrip("\n")
    inserted = f"{before}\n\n{line}\n"
    if after:
        inserted += f"\n{after}"
    return inserted


def _parse_metadata(raw: str) -> dict[str, str]:
    metadata: dict[str, str] = {}
    for part in raw.split(";"):
        if "=" not in part:
            continue
        key, value = part.split("=", 1)
        key = key.strip()
        value = value.strip()
        if key:
            metadata[key] = value
    return metadata


def _update_candidate_status_content(
    content: str,
    candidate_ids: set[str],
    status: str,
) -> str:
    def replace_comment(match: re.Match[str]) -> str:
        metadata = _parse_metadata(match.group("meta"))
        candidate_id = metadata.get("id")
        if candidate_id not in candidate_ids:
            return match.group(0)
        metadata["status"] = status
        raw_metadata = "; ".join(f"{key}={value}" for key, value in metadata.items())
        return f"<!-- candidate:{raw_metadata} -->"

    return _CANDIDATE_COMMENT_RE.sub(replace_comment, content)


def _strip_html_comment(text: str) -> str:
    return re.sub(r"\s*<!--.*?-->\s*", "", text).strip()


def _normalize_memory_markdown_content(content: str) -> str:
    normalized_lines: list[str] = []
    for line in content.splitlines(keepends=True):
        newline = "\n" if line.endswith("\n") else ""
        raw_line = line[:-1] if newline else line
        bullet = _BULLET_RE.match(raw_line)
        if bullet is None:
            normalized_lines.append(line)
            continue

        memory = _strip_html_comment(bullet.group("body")).strip()
        normalized_lines.append(f"{bullet.group('prefix')}{memory}{newline}")
    return "".join(normalized_lines)


def _manual_id(line_number: int, memory: str) -> str:
    digest = hashlib.sha1(f"{line_number}:{memory}".encode("utf-8")).hexdigest()[:12]
    return f"manual_{digest}"


def _next_heading(current_heading: str | None, line: str) -> str | None:
    heading = _HEADING_RE.match(line.strip())
    if not heading:
        return current_heading
    return heading.group("title").strip()


def _is_memory_section(section_heading: str | None) -> bool:
    if section_heading is None:
        return False
    normalized = section_heading.strip().lower()
    return normalized in _MEMORY_SECTIONS


def _candidate_id(today: str, memory: str) -> str:
    digest = hashlib.sha1(memory.encode("utf-8")).hexdigest()[:8]
    return f"cand_{today.replace('-', '')}_{digest}"


def _parse_float(value: str | None) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except ValueError:
        return None


def _score_text(query: str, text: str) -> float:
    normalized_query = query.strip().lower()
    normalized_text = text.lower()
    if not normalized_query:
        return 0

    score = 0.0
    if normalized_query in normalized_text:
        score += float(len(normalized_query))

    for term in _search_terms(normalized_query):
        if term in normalized_text:
            score += _term_weight(term)

    score += _intent_score(normalized_query, normalized_text)
    score += _semantic_group_score(normalized_query, normalized_text)
    return score


def _search_terms(normalized_query: str) -> set[str]:
    terms = set(_ASCII_TERM_RE.findall(normalized_query))
    for segment in _CJK_TEXT_RE.findall(normalized_query):
        segment_length = len(segment)
        for size in range(2, min(4, segment_length) + 1):
            for start in range(0, segment_length - size + 1):
                terms.add(segment[start : start + size])
    return terms


def _term_weight(term: str) -> float:
    if _CJK_TEXT_RE.fullmatch(term):
        return min(len(term), 4) * 0.4
    return 1.0


def _intent_score(normalized_query: str, normalized_text: str) -> float:
    score = 0.0
    if _contains_any(normalized_query, _IDENTITY_QUERY_TERMS):
        score += _identity_profile_score(normalized_text)

    if _contains_any(normalized_query, _GAME_QUERY_TERMS):
        hits = _count_matches(normalized_text, _GAME_MEMORY_TERMS)
        if hits:
            score += 2.0 + min(hits, 3) * 0.5
    return score


def _contains_any(text: str, terms: tuple[str, ...]) -> bool:
    return any(term in text for term in terms)


def _identity_profile_score(normalized_text: str) -> float:
    if _contains_any(normalized_text, ("name is", "姓名", "名字", "我叫", "我是")):
        return 5.0
    if "职业" in normalized_text:
        return 4.5
    if _contains_any(normalized_text, ("最近在做", "正在做")):
        return 4.0
    if _contains_any(normalized_text, ("所在", "城市")):
        return 3.0
    if _contains_any(normalized_text, _PROFILE_MEMORY_TERMS):
        return 2.5
    return 0.0


def _count_matches(text: str, terms: tuple[str, ...]) -> int:
    return sum(1 for term in terms if term in text)


def _semantic_group_score(normalized_query: str, normalized_text: str) -> float:
    score = 0.0
    for group in _SEMANTIC_GROUPS:
        query_hits = _count_matches(normalized_query, group)
        text_hits = _count_matches(normalized_text, group)
        if query_hits and text_hits:
            score += min(query_hits, 2) * min(text_hits, 2) * 0.8
    return score
