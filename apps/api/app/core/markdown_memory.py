import hashlib
import re
import threading
import uuid
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Any

from app.core.memory_paths import MemoryPaths, ensure_memory_profile


_LONG_TERM_COMMENT_RE = re.compile(r"<!--\s*memory:(?P<meta>.*?)\s*-->")
_CANDIDATE_COMMENT_RE = re.compile(r"<!--\s*candidate:(?P<meta>.*?)\s*-->")
_BULLET_RE = re.compile(r"^(?P<prefix>\s*[-*]\s+)(?P<body>.*)$")
_HEADING_RE = re.compile(r"^#{1,6}\s+(?P<title>.+?)\s*$")
_PROFILE_WRITE_LOCKS_GUARD = threading.Lock()
_PROFILE_WRITE_LOCKS: dict[str, Any] = {}
_MEMORY_KEYWORDS = ("记住", "以后", "偏好", "喜欢", "希望", "决定", "确认")
_MEMORY_SECTIONS = {
    "memory",
    "用户偏好",
    "项目与长期目标",
    "事实与背景",
    "长期记忆",
    "从旧版记忆导入",
    "preferences",
    "projects",
    "facts",
    "long-term memory",
    "imported memory",
}


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
        for record in [*self._read_long_term_records(), *self._read_candidate_records()]:
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
                    )
                )

        scored_records.sort(key=lambda record: record.score or 0, reverse=True)
        return [record.to_compat_dict() for record in scored_records[:limit]]

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

    def list_candidates(self) -> list[dict[str, Any]]:
        return [record.to_compat_dict() for record in self._read_candidate_records()]

    def read_memory_markdown(self) -> str:
        return self.paths.memory_file.read_text(encoding="utf-8")

    def write_memory_markdown(self, content: str) -> None:
        self.locked_write(self.paths.memory_file, content)

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
        today_file = self.paths.daily_dir / f"{date.today().isoformat()}.md"
        if not today_file.exists():
            return []

        records: list[MemoryRecord] = []
        for index, line in enumerate(
            today_file.read_text(encoding="utf-8").splitlines(),
            start=1,
        ):
            record = self._parse_candidate_line(line, today_file, index)
            if record is not None:
                records.append(record)
        return records

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


def _extract_candidate_memory(messages: list[dict[str, Any]]) -> str | None:
    last_user = _last_message_text(messages, "user")
    last_assistant = _last_message_text(messages, "assistant")
    if not last_user and not last_assistant:
        return None
    if last_user and any(keyword in last_user for keyword in _MEMORY_KEYWORDS):
        return last_user
    if last_user and last_assistant:
        return f"user: {last_user} / assistant: {last_assistant}"
    return last_user or last_assistant


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


def _strip_html_comment(text: str) -> str:
    return re.sub(r"\s*<!--.*?-->\s*", "", text).strip()


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
    if normalized_query in normalized_text:
        return float(len(normalized_query))

    tokens = [token for token in re.split(r"\s+", normalized_query) if token]
    if not tokens:
        return 0
    return float(sum(1 for token in tokens if token in normalized_text))
