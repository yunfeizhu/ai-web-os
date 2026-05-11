from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.v1 import memory as memory_api
from app.core import memory as core_memory


@pytest.fixture
def client(monkeypatch, tmp_path):
    home = tmp_path / "home"
    monkeypatch.setenv("AI_NATIVE_OS_HOME", str(home))
    monkeypatch.setattr(core_memory, "_manager", None)

    app = FastAPI()
    app.include_router(memory_api.router, prefix="/api/v1")

    with TestClient(app) as test_client:
        yield test_client, home

    manager = core_memory.get_memory_manager()
    if manager is not None:
        manager.stop()
    monkeypatch.setattr(core_memory, "_manager", None)


def _assert_markdown_metadata(payload: dict, home: Path) -> None:
    assert payload["backend"] == "markdown"
    assert payload["initialized"] is True
    assert payload["collection"] == "markdown:default"
    assert payload["memory_file"] == str(home / "memory" / "MEMORY.md")
    assert payload["dreams_file"] == str(home / "memory" / "DREAMS.md")
    assert payload["daily_dir"] == str(home / "memory" / "daily")


def test_init_accepts_llm_model_only_and_returns_markdown_metadata(client):
    test_client, home = client

    response = test_client.post("/api/v1/memory/init", json={"llm_model": "test-llm"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    _assert_markdown_metadata(payload, home)


def test_status_lazily_initializes_markdown_manager(client):
    test_client, home = client
    assert core_memory.get_memory_manager() is None

    response = test_client.get("/api/v1/memory/status")

    assert response.status_code == 200
    payload = response.json()
    _assert_markdown_metadata(payload, home)
    assert core_memory.get_memory_manager() is not None


def test_files_endpoint_updates_memory_and_list_search_read_it(client):
    test_client, home = client
    content = (
        "# Memory\n\n"
        "- User prefers concise status updates "
        "<!-- memory:id=concise_updates; confidence=0.9 -->\n"
    )

    put_response = test_client.put(
        "/api/v1/memory/files/memory",
        json={"content": content},
    )
    get_file_response = test_client.get("/api/v1/memory/files/memory")
    list_response = test_client.get("/api/v1/memory")
    search_response = test_client.get("/api/v1/memory/search", params={"q": "concise"})

    assert put_response.status_code == 200
    assert put_response.json()["status"] == "ok"
    assert put_response.json()["path"] == str(home / "memory" / "MEMORY.md")
    assert get_file_response.status_code == 200
    assert get_file_response.json()["kind"] == "memory"
    assert get_file_response.json()["content"] == content
    assert get_file_response.json()["path"] == str(home / "memory" / "MEMORY.md")
    assert list_response.status_code == 200
    list_payload = list_response.json()
    _assert_markdown_metadata(list_payload, home)
    assert [memory["id"] for memory in list_payload["memories"]] == ["concise_updates"]
    assert list_payload["memories"][0]["memory"] == "User prefers concise status updates"
    assert search_response.status_code == 200
    search_payload = search_response.json()
    _assert_markdown_metadata(search_payload, home)
    assert search_payload["memories"][0]["id"] == "concise_updates"
    assert search_payload["memories"][0]["score"] > 0


@pytest.mark.parametrize(
    ("kind", "params", "relative_path", "backup_glob"),
    [
        ("dreams", {}, Path("DREAMS.md"), "DREAMS-*.md"),
        (
            "daily",
            {"date": "2026-04-28"},
            Path("daily") / "2026-04-28.md",
            "daily-20260428-*.md",
        ),
    ],
)
def test_files_endpoint_backs_up_existing_dreams_and_daily_before_overwrite(
    client,
    kind,
    params,
    relative_path,
    backup_glob,
):
    test_client, home = client
    existing_path = home / "memory" / relative_path
    old_content = f"old {kind} content\n"
    new_content = f"new {kind} content\n"
    existing_path.parent.mkdir(parents=True, exist_ok=True)
    existing_path.write_text(old_content, encoding="utf-8")

    response = test_client.put(
        f"/api/v1/memory/files/{kind}",
        params=params,
        json={"content": new_content},
    )

    backups = list((home / "memory" / ".dreams" / "backups").glob(backup_glob))
    assert response.status_code == 200
    assert existing_path.read_text(encoding="utf-8") == new_content
    assert backups
    assert any(backup.read_text(encoding="utf-8") == old_content for backup in backups)


def test_read_unknown_memory_file_kind_returns_404(client):
    test_client, _home = client

    response = test_client.get("/api/v1/memory/files/unknown")

    assert response.status_code == 404
    assert response.json()["detail"] == "Unsupported memory file kind"


def test_read_daily_memory_file_with_invalid_date_returns_400(client):
    test_client, _home = client

    response = test_client.get(
        "/api/v1/memory/files/daily",
        params={"date": "not-a-date"},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Invalid daily memory date"


def test_test_write_creates_daily_candidate_and_consolidate_promotes_it(client):
    test_client, home = client
    init_response = test_client.post("/api/v1/memory/init", json={"llm_model": "test-llm"})
    assert init_response.status_code == 200

    write_response = test_client.post("/api/v1/memory/test-write")
    candidates_response = test_client.get("/api/v1/memory/candidates")
    consolidate_response = test_client.post("/api/v1/memory/consolidate")

    assert write_response.status_code == 200
    assert write_response.json()["status"] == "ok"
    assert candidates_response.status_code == 200
    candidates_payload = candidates_response.json()
    _assert_markdown_metadata(candidates_payload, home)
    assert len(candidates_payload["candidates"]) == 1
    assert candidates_payload["candidates"][0]["kind"] == "candidate"
    assert "Task 5 API test memory" in candidates_payload["candidates"][0]["memory"]
    assert consolidate_response.status_code == 200
    consolidate_payload = consolidate_response.json()
    _assert_markdown_metadata(consolidate_payload, home)
    assert len(consolidate_payload["promoted"]) == 1
    assert consolidate_payload["skipped"] == []
    assert consolidate_payload["duplicate"] == []
    assert consolidate_payload["report_path"] == str(home / "memory" / "DREAMS.md")
    assert consolidate_payload["memory_path"] == str(home / "memory" / "MEMORY.md")
    assert "Task 5 API test memory" in Path(consolidate_payload["memory_path"]).read_text(
        encoding="utf-8"
    )
    assert consolidate_payload["state_path"] == str(
        home / "memory" / ".dreams" / "short-term.json"
    )
    assert consolidate_payload["phase_signal_path"] == str(
        home / "memory" / ".dreams" / "phase-signals.json"
    )


def test_dreaming_status_and_sweep_endpoints(client):
    test_client, home = client
    init_response = test_client.post("/api/v1/memory/init", json={"llm_model": "test-llm"})
    write_response = test_client.post("/api/v1/memory/test-write")
    status_before = test_client.get("/api/v1/memory/dreaming/status")
    sweep_response = test_client.post("/api/v1/memory/dreaming/sweep")
    status_after = test_client.get("/api/v1/memory/dreaming/status")

    assert init_response.status_code == 200
    assert write_response.status_code == 200
    assert status_before.status_code == 200
    assert status_before.json()["short_term_entries"] == 0
    assert status_before.json()["runtime"]["enabled"] is False
    assert status_before.json()["runtime"]["interval_seconds"] == 86400
    assert sweep_response.status_code == 200
    sweep_payload = sweep_response.json()
    assert sweep_payload["promoted"]
    assert sweep_payload["state_path"] == str(home / "memory" / ".dreams" / "short-term.json")
    assert sweep_payload["phase_signal_path"] == str(
        home / "memory" / ".dreams" / "phase-signals.json"
    )
    assert status_after.status_code == 200
    status_payload = status_after.json()
    assert status_payload["short_term_entries"] == 1
    assert status_payload["phase_signals"]["deep"]["promoted"] == 1


def test_reindex_reports_current_long_term_count_and_deletes_are_lazy(client):
    test_client, home = client

    missing_delete_response = test_client.delete("/api/v1/memory/not_present")
    put_response = test_client.put(
        "/api/v1/memory/files/memory",
        json={
            "content": (
                "# Memory\n\n"
                "- Keep this durable memory <!-- memory:id=durable_one -->\n"
            )
        },
    )
    reindex_response = test_client.post("/api/v1/memory/reindex")
    delete_response = test_client.delete("/api/v1/memory/durable_one")
    after_delete_response = test_client.get("/api/v1/memory")
    clear_response = test_client.delete("/api/v1/memory")

    assert missing_delete_response.status_code == 200
    assert put_response.status_code == 200
    assert reindex_response.status_code == 200
    reindex_payload = reindex_response.json()
    assert reindex_payload["status"] == "ok"
    assert reindex_payload["backend"] == "markdown"
    assert reindex_payload["indexed"] == 1
    _assert_markdown_metadata(reindex_payload, home)
    assert delete_response.status_code == 200
    assert after_delete_response.status_code == 200
    assert after_delete_response.json()["memories"] == []
    assert clear_response.status_code == 200
