"""Memory management API backed by local Markdown files."""
from __future__ import annotations

from datetime import date as calendar_date
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.core.markdown_memory import MarkdownMemoryManager
from app.core.memory import get_memory_manager, init_memory_manager
from app.core.memory_backfill import (
    preview_grounded_backfill,
    rollback_grounded_backfill,
    stage_grounded_backfill,
)
from app.core.memory_consolidation import consolidate_memory, get_dreaming_status
from app.core.memory_eval import run_memory_eval

router = APIRouter()

DEFAULT_USER_ID = "default"
_TEST_MEMORY_TEXT = "\u8bf7\u8bb0\u4f4f Task 5 API test memory"


class InitMemoryRequest(BaseModel):
    llm_provider: str = "litellm"
    llm_model: str
    llm_api_key: str | None = None
    llm_api_base: str | None = None
    embedder_provider: str = "ollama"
    embedder_model: str = "nomic-embed-text"
    embedder_api_key: str | None = None
    embedder_base_url: str | None = None
    embedder_dims: int | None = None
    qdrant_host: str = "127.0.0.1"
    qdrant_port: int = 16333


class MemoryFileUpdateRequest(BaseModel):
    content: str


def _ensure_manager() -> MarkdownMemoryManager:
    manager = get_memory_manager()
    if manager is None:
        manager = init_memory_manager(llm_model="")
    manager.start()
    return manager


def _metadata(manager: MarkdownMemoryManager) -> dict:
    return manager.metadata()


def _daily_filename(day: str | None) -> str:
    selected_day = day or calendar_date.today().isoformat()
    try:
        calendar_date.fromisoformat(selected_day)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid daily memory date") from exc
    return f"{selected_day}.md"


def _memory_file_for_kind(
    manager: MarkdownMemoryManager,
    kind: str,
    day: str | None = None,
) -> Path:
    if kind == "memory":
        return manager.paths.memory_file
    if kind == "dreams":
        return manager.paths.dreams_file
    if kind == "daily":
        return manager.paths.daily_dir / _daily_filename(day)
    raise HTTPException(status_code=404, detail="Unsupported memory file kind")


@router.post("/memory/init")
async def init_memory(req: InitMemoryRequest):
    """Initialize the process-wide markdown memory manager."""
    manager = init_memory_manager(
        llm_provider=req.llm_provider,
        llm_model=req.llm_model,
        llm_api_key=req.llm_api_key,
        llm_api_base=req.llm_api_base,
        embedder_provider=req.embedder_provider,
        embedder_model=req.embedder_model,
        embedder_api_key=req.embedder_api_key,
        embedder_base_url=req.embedder_base_url,
        embedder_dims=req.embedder_dims,
        qdrant_host=req.qdrant_host,
        qdrant_port=req.qdrant_port,
    )
    manager.start()
    return {"status": "ok", **_metadata(manager)}


@router.get("/memory/status")
async def memory_status():
    manager = _ensure_manager()
    return _metadata(manager)


@router.post("/memory/test-write")
async def test_write_memory():
    manager = _ensure_manager()
    await manager.add_async(
        user_id=DEFAULT_USER_ID,
        messages=[
            {"role": "user", "content": _TEST_MEMORY_TEXT},
            {"role": "assistant", "content": "Recorded."},
        ],
    )
    return {
        "status": "ok",
        "result": {"candidates": manager.list_candidates()},
        **_metadata(manager),
    }


@router.get("/memory")
async def list_memories(user_id: str = DEFAULT_USER_ID):
    manager = _ensure_manager()
    memories = await manager.get_all(user_id=user_id)
    return {"memories": memories, **_metadata(manager)}


@router.get("/memory/search")
async def search_memories(q: str, user_id: str = DEFAULT_USER_ID):
    manager = _ensure_manager()
    memories = await manager.search(query=q, user_id=user_id, limit=10)
    return {"memories": memories, **_metadata(manager)}


@router.get("/memory/candidates")
async def list_candidates():
    manager = _ensure_manager()
    return {"candidates": manager.list_candidates(), **_metadata(manager)}


@router.post("/memory/consolidate")
async def consolidate_memories():
    manager = _ensure_manager()
    result = consolidate_memory(manager)
    return {
        "promoted": result.promoted,
        "skipped": result.skipped,
        "duplicate": result.duplicate,
        "report_path": result.report_path,
        "memory_path": result.memory_path,
        "state_path": result.state_path,
        "phase_signal_path": result.phase_signal_path,
        **_metadata(manager),
    }


@router.get("/memory/dreaming/status")
async def dreaming_status():
    manager = _ensure_manager()
    return {**get_dreaming_status(manager), **_metadata(manager)}


@router.post("/memory/dreaming/sweep")
async def dreaming_sweep():
    manager = _ensure_manager()
    result = consolidate_memory(manager)
    return {
        "promoted": result.promoted,
        "skipped": result.skipped,
        "duplicate": result.duplicate,
        "report_path": result.report_path,
        "memory_path": result.memory_path,
        "state_path": result.state_path,
        "phase_signal_path": result.phase_signal_path,
        **_metadata(manager),
    }


@router.get("/memory/files/{kind}")
async def read_memory_file(kind: str, date: str | None = None):
    manager = _ensure_manager()
    path = _memory_file_for_kind(manager, kind, date)
    content = path.read_text(encoding="utf-8") if path.exists() else ""
    return {"kind": kind, "content": content, "path": str(path)}


@router.put("/memory/files/{kind}")
async def write_memory_file(
    kind: str,
    req: MemoryFileUpdateRequest,
    date: str | None = None,
):
    manager = _ensure_manager()
    path = _memory_file_for_kind(manager, kind, date)
    path.parent.mkdir(parents=True, exist_ok=True)
    if kind == "memory":
        manager.write_memory_markdown(req.content)
    else:
        manager.locked_write(path, req.content)
    return {"status": "ok", "kind": kind, "path": str(path)}


@router.post("/memory/reindex")
async def reindex_memory(user_id: str = DEFAULT_USER_ID):
    manager = _ensure_manager()
    del user_id
    result = manager.rebuild_search_index()
    return {"status": "ok", **result, **_metadata(manager)}


@router.get("/memory/backfill/preview")
async def preview_backfill():
    manager = _ensure_manager()
    return {**preview_grounded_backfill(manager), **_metadata(manager)}


@router.post("/memory/backfill/stage")
async def stage_backfill():
    manager = _ensure_manager()
    return {**stage_grounded_backfill(manager), **_metadata(manager)}


@router.post("/memory/backfill/rollback")
async def rollback_backfill():
    manager = _ensure_manager()
    return {**rollback_grounded_backfill(manager), **_metadata(manager)}


@router.post("/memory/eval")
async def evaluate_memory():
    return await run_memory_eval()


@router.delete("/memory/{memory_id}")
async def delete_memory(memory_id: str):
    manager = _ensure_manager()
    await manager.delete(memory_id=memory_id)
    return {"status": "ok", **_metadata(manager)}


@router.delete("/memory")
async def clear_memories(user_id: str = DEFAULT_USER_ID):
    manager = _ensure_manager()
    await manager.delete_all(user_id=user_id)
    return {"status": "ok", **_metadata(manager)}
