from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any
from urllib.parse import quote

import httpx

from app.core.markdown_memory import MarkdownMemoryManager

_LEGACY_IMPORT_HEADING = "## 事实与背景"
_BULLET_RE = re.compile(r"^\s*[-*]\s+(?P<body>.*)$")
_HTML_COMMENT_RE = re.compile(r"\s*<!--.*?-->\s*")


@dataclass(frozen=True)
class LegacyImportResult:
    imported: int
    duplicates: int
    skipped: int
    collections: list[str]
    failed_collections: list[str]


@dataclass(frozen=True)
class _LegacyMemory:
    collection: str
    point_id: str
    memory: str
    created_at: str | None = None


def import_legacy_qdrant_memories(
    manager: MarkdownMemoryManager,
    *,
    qdrant_host: str = "127.0.0.1",
    qdrant_port: int = 16333,
    qdrant_url: str | None = None,
    user_id: str = "default",
    timeout: float = 1.5,
    page_limit: int = 256,
    transport: httpx.BaseTransport | None = None,
) -> LegacyImportResult:
    """Import old mem0/Qdrant memory points into the local Markdown memory file.

    This keeps the new Markdown backend as the source of truth while preserving
    existing memories created before the migration.
    """
    base_url = qdrant_url or f"http://{qdrant_host}:{qdrant_port}"
    imported = 0
    duplicates = 0
    skipped = 0
    failed_collections: list[str] = []

    try:
        with httpx.Client(
            base_url=base_url,
            timeout=timeout,
            transport=transport,
        ) as client:
            collections = _list_legacy_collections(client)
            legacy_memories: list[_LegacyMemory] = []
            for collection in collections:
                try:
                    memories, collection_skipped = _scroll_collection(
                        client,
                        collection,
                        user_id=user_id,
                        page_limit=page_limit,
                    )
                    legacy_memories.extend(memories)
                    skipped += collection_skipped
                except (httpx.HTTPError, ValueError, KeyError):
                    failed_collections.append(collection)
    except (httpx.HTTPError, ValueError, KeyError):
        return LegacyImportResult(
            imported=0,
            duplicates=0,
            skipped=0,
            collections=[],
            failed_collections=[],
        )

    if not legacy_memories:
        return LegacyImportResult(
            imported=0,
            duplicates=duplicates,
            skipped=skipped,
            collections=collections,
            failed_collections=failed_collections,
        )

    with manager.write_lock():
        memory_content = manager.read_memory_markdown()
        existing_texts = _existing_memory_texts(memory_content)
        imported_lines: list[str] = []

        for legacy_memory in legacy_memories:
            if legacy_memory.memory in existing_texts:
                duplicates += 1
                continue
            imported_lines.append(_format_memory_line(legacy_memory))
            existing_texts.add(legacy_memory.memory)
            imported += 1

        if imported_lines:
            updated = _insert_import_section(memory_content, imported_lines)
            manager.locked_write(manager.paths.memory_file, updated)

    return LegacyImportResult(
        imported=imported,
        duplicates=duplicates,
        skipped=skipped,
        collections=collections,
        failed_collections=failed_collections,
    )


def _list_legacy_collections(client: httpx.Client) -> list[str]:
    response = client.get("/collections")
    response.raise_for_status()
    payload = response.json()
    collections = (payload.get("result") or {}).get("collections") or []
    names = [str(item.get("name") or "") for item in collections if isinstance(item, dict)]
    return sorted(name for name in names if _is_legacy_memory_collection(name))


def _is_legacy_memory_collection(name: str) -> bool:
    return name.startswith("ai_os_mem")


def _scroll_collection(
    client: httpx.Client,
    collection: str,
    *,
    user_id: str,
    page_limit: int,
) -> tuple[list[_LegacyMemory], int]:
    memories: list[_LegacyMemory] = []
    skipped = 0
    offset: Any = None
    path = f"/collections/{quote(collection, safe='')}/points/scroll"

    while True:
        body: dict[str, Any] = {
            "limit": page_limit,
            "with_payload": True,
            "with_vector": False,
        }
        if offset is not None:
            body["offset"] = offset

        response = client.post(path, json=body)
        response.raise_for_status()
        result = response.json().get("result") or {}
        points = result.get("points") or []

        for point in points:
            memory = _memory_from_point(collection, point, user_id=user_id)
            if memory is None:
                skipped += 1
                continue
            memories.append(memory)

        offset = result.get("next_page_offset")
        if offset in (None, ""):
            break

    return memories, skipped


def _memory_from_point(
    collection: str,
    point: dict[str, Any],
    *,
    user_id: str,
) -> _LegacyMemory | None:
    payload = point.get("payload") or {}
    if not isinstance(payload, dict):
        return None
    if str(payload.get("user_id") or user_id) != user_id:
        return None

    raw_memory = _first_text_value(payload, ("memory", "data", "text", "content"))
    memory = _normalize_memory_text(raw_memory)
    if not memory:
        return None

    return _LegacyMemory(
        collection=collection,
        point_id=str(point.get("id") or ""),
        memory=memory,
        created_at=_normalize_metadata_value(payload.get("created_at")),
    )


def _first_text_value(payload: dict[str, Any], keys: tuple[str, ...]) -> str:
    for key in keys:
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value
    return ""


def _normalize_memory_text(value: str) -> str:
    text = " ".join(str(value or "").split())
    return text.replace("<!--", "&lt;!--").replace("-->", "--&gt;").strip()


def _normalize_metadata_value(value: Any) -> str | None:
    if value is None:
        return None
    normalized = " ".join(str(value).split()).replace(";", ",")
    return normalized or None


def _existing_memory_texts(content: str) -> set[str]:
    texts: set[str] = set()
    for line in content.splitlines():
        bullet = _BULLET_RE.match(line)
        if not bullet:
            continue
        memory = _HTML_COMMENT_RE.sub("", bullet.group("body")).strip()
        if memory:
            texts.add(memory)
    return texts


def _format_memory_line(memory: _LegacyMemory) -> str:
    return f"- {memory.memory}"


def _insert_import_section(content: str, lines: list[str]) -> str:
    block = "\n".join(lines)
    section_match = re.search(
        rf"^{re.escape(_LEGACY_IMPORT_HEADING)}\s*$",
        content,
        flags=re.MULTILINE,
    )
    if section_match is None:
        base = content.rstrip()
        return f"{base}\n\n{_LEGACY_IMPORT_HEADING}\n\n{block}\n"

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
