import asyncio
import json
from datetime import date, timedelta

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.v1 import memory as memory_api
from app.core import memory as core_memory
from app.core.markdown_memory import MarkdownMemoryManager
from app.core.memory_backfill import (
    preview_grounded_backfill,
    rollback_grounded_backfill,
    stage_grounded_backfill,
)
from app.core.memory_flush import flush_memory_before_compaction
from app.core.memory_transcripts import ingest_redacted_transcript


def test_hybrid_memory_search_matches_semantic_response_language(monkeypatch, tmp_path):
    home = tmp_path / "home"
    monkeypatch.setenv("AI_NATIVE_OS_HOME", str(home))
    manager = MarkdownMemoryManager()
    manager.write_memory_markdown(
        "# Memory\n\n"
        "## 用户偏好\n\n"
        "- 默认回复语言：中文\n"
    )

    results = asyncio.run(manager.search("preferred answer language", limit=3))

    assert results
    assert results[0]["memory"] == "默认回复语言：中文"
    assert results[0]["score"] > 0
    assert results[0]["matchMode"] == "hybrid"


def test_memory_reindex_writes_local_search_index(monkeypatch, tmp_path):
    home = tmp_path / "home"
    monkeypatch.setenv("AI_NATIVE_OS_HOME", str(home))
    manager = MarkdownMemoryManager()
    manager.write_memory_markdown(
        "# Memory\n\n"
        "## 用户画像\n\n"
        "- 职业：前端工程师\n"
    )

    result = manager.rebuild_search_index()

    index_path = manager.paths.dreams_state_dir / "search-index.json"
    index = json.loads(index_path.read_text(encoding="utf-8"))
    assert result["indexed"] == 1
    assert result["index_path"] == str(index_path)
    assert index["records"][0]["memory"] == "职业：前端工程师"


def test_flush_before_compaction_stages_durable_memory_with_redaction(monkeypatch, tmp_path):
    home = tmp_path / "home"
    monkeypatch.setenv("AI_NATIVE_OS_HOME", str(home))
    manager = MarkdownMemoryManager()

    result = flush_memory_before_compaction(
        manager,
        [
            {"role": "user", "content": "请记住我的默认回复语言是中文，邮箱是 me@example.com"},
            {"role": "assistant", "content": "好的。"},
        ],
    )

    daily_file = manager.paths.daily_dir / f"{date.today().isoformat()}.md"
    content = daily_file.read_text(encoding="utf-8")
    assert result["staged"] == 1
    assert "默认回复语言是中文" in content
    assert "me@example.com" not in content
    assert "[redacted-email]" in content
    assert "source=compaction_flush" in content


def test_transcript_ingestion_redacts_sensitive_content_and_feeds_light_phase(
    monkeypatch,
    tmp_path,
):
    home = tmp_path / "home"
    monkeypatch.setenv("AI_NATIVE_OS_HOME", str(home))
    manager = MarkdownMemoryManager()

    result = ingest_redacted_transcript(
        manager,
        [
            {"role": "user", "content": "用户默认沟通语言是中文，OPENAI_API_KEY=sk-secret"},
            {"role": "assistant", "content": "已了解。"},
        ],
    )

    payload = json.loads((manager.paths.dreams_state_dir / "transcripts.json").read_text(encoding="utf-8"))
    candidates = manager.list_transcript_candidates()
    assert result["ingested"] == 1
    assert "sk-secret" not in json.dumps(payload, ensure_ascii=False)
    assert "[redacted-secret]" in json.dumps(payload, ensure_ascii=False)
    assert candidates[0]["memory"] == "用户默认沟通语言是中文，[redacted-secret]"
    assert candidates[0]["kind"] == "transcript_candidate"


def test_grounded_backfill_preview_stage_and_rollback(monkeypatch, tmp_path):
    home = tmp_path / "home"
    monkeypatch.setenv("AI_NATIVE_OS_HOME", str(home))
    manager = MarkdownMemoryManager()
    old_day = date.today() - timedelta(days=5)
    daily_file = manager.paths.daily_dir / f"{old_day.isoformat()}.md"
    daily_file.write_text(
        f"# Daily Memory {old_day.isoformat()}\n\n"
        "## 候选记忆\n\n"
        "- 用户偏好直接给结论 <!-- candidate:id=old_direct; status=pending; user_id=alice -->\n",
        encoding="utf-8",
    )

    preview = preview_grounded_backfill(manager)
    staged = stage_grounded_backfill(manager)

    assert preview["candidates"][0]["memory"] == "用户偏好直接给结论"
    assert staged["staged"] == 1
    short_term = json.loads((manager.paths.dreams_state_dir / "short-term.json").read_text(encoding="utf-8"))
    assert any(entry["source"] == "grounded_backfill" for entry in short_term["entries"].values())
    rolled_back = rollback_grounded_backfill(manager)
    assert rolled_back["removed"] == 1
    short_term_after = json.loads((manager.paths.dreams_state_dir / "short-term.json").read_text(encoding="utf-8"))
    assert short_term_after["entries"] == {}


def test_memory_api_exposes_backfill_and_search_index(monkeypatch, tmp_path):
    home = tmp_path / "home"
    monkeypatch.setenv("AI_NATIVE_OS_HOME", str(home))
    monkeypatch.setattr(core_memory, "_manager", None)
    app = FastAPI()
    app.include_router(memory_api.router, prefix="/api/v1")
    old_day = date.today() - timedelta(days=4)

    with TestClient(app) as client:
        assert client.post("/api/v1/memory/init", json={"llm_model": "test"}).status_code == 200
        manager = core_memory.get_memory_manager()
        assert manager is not None
        daily_file = manager.paths.daily_dir / f"{old_day.isoformat()}.md"
        daily_file.write_text(
            f"# Daily Memory {old_day.isoformat()}\n\n"
            "## 候选记忆\n\n"
            "- 用户偏好中文回复 <!-- candidate:id=old_lang; status=pending; user_id=alice -->\n",
            encoding="utf-8",
        )

        reindex = client.post("/api/v1/memory/reindex")
        preview = client.get("/api/v1/memory/backfill/preview")
        stage = client.post("/api/v1/memory/backfill/stage")
        rollback = client.post("/api/v1/memory/backfill/rollback")

    assert reindex.status_code == 200
    assert reindex.json()["indexed"] >= 0
    assert preview.status_code == 200
    assert preview.json()["candidates"][0]["memory"] == "用户偏好中文回复"
    assert stage.status_code == 200
    assert stage.json()["staged"] == 1
    assert rollback.status_code == 200
    assert rollback.json()["removed"] == 1
