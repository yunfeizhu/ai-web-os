import asyncio

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.v1 import memory as memory_api
from app.core import memory as core_memory
from app.core.memory_eval import run_memory_eval


def test_memory_eval_runs_in_isolated_home(monkeypatch, tmp_path):
    real_home = tmp_path / "real-home"
    eval_home = tmp_path / "eval-home"
    monkeypatch.setenv("AI_NATIVE_OS_HOME", str(real_home))

    result = asyncio.run(run_memory_eval(home=eval_home))

    assert result["status"] == "passed"
    assert result["isolated"] is True
    assert result["summary"]["failed"] == 0
    assert result["summary"]["passed"] >= 4
    assert result["memory_root"] == str(eval_home / "memory")
    assert not (real_home / "memory").exists()
    assert {scenario["id"] for scenario in result["scenarios"]} >= {
        "long_term_recall",
        "daily_context",
        "redaction_pipeline",
        "tool_policy_boundary",
    }


def test_memory_eval_api_does_not_replace_process_manager(monkeypatch, tmp_path):
    real_home = tmp_path / "real-home"
    monkeypatch.setenv("AI_NATIVE_OS_HOME", str(real_home))
    monkeypatch.setattr(core_memory, "_manager", None)
    app = FastAPI()
    app.include_router(memory_api.router, prefix="/api/v1")

    with TestClient(app) as client:
        init_response = client.post("/api/v1/memory/init", json={"llm_model": "test"})
        manager_before = core_memory.get_memory_manager()
        eval_response = client.post("/api/v1/memory/eval")
        manager_after = core_memory.get_memory_manager()

    assert init_response.status_code == 200
    assert eval_response.status_code == 200
    payload = eval_response.json()
    assert payload["status"] == "passed"
    assert payload["isolated"] is True
    assert manager_after is manager_before
    assert manager_after is not None
    assert manager_after.paths.memory_root == real_home / "memory"
