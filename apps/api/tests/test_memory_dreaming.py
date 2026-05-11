import asyncio
import json

from app.core.markdown_memory import MarkdownMemoryManager
from app.core.memory_dreaming import (
    get_dreaming_runtime_status,
    maybe_run_scheduled_dreaming,
)


def test_scheduled_dreaming_is_disabled_by_default(monkeypatch, tmp_path):
    home = tmp_path / "home"
    monkeypatch.setenv("AI_NATIVE_OS_HOME", str(home))
    monkeypatch.delenv("AI_NATIVE_OS_DREAMING_ENABLED", raising=False)
    manager = MarkdownMemoryManager()

    result = maybe_run_scheduled_dreaming(manager)

    assert result["ran"] is False
    assert result["reason"] == "disabled"
    assert get_dreaming_runtime_status(manager)["enabled"] is False


def test_scheduled_dreaming_runs_when_enabled_and_due(monkeypatch, tmp_path):
    home = tmp_path / "home"
    monkeypatch.setenv("AI_NATIVE_OS_HOME", str(home))
    monkeypatch.setenv("AI_NATIVE_OS_DREAMING_ENABLED", "1")
    monkeypatch.setenv("AI_NATIVE_OS_DREAMING_INTERVAL_SECONDS", "0")
    manager = MarkdownMemoryManager()
    asyncio.run(
        manager.add_async(
            "alice",
            [
                {"role": "user", "content": "请记住我喜欢番茄钟"},
                {"role": "assistant", "content": "好的。"},
            ],
        )
    )

    result = maybe_run_scheduled_dreaming(manager)

    state_path = manager.paths.dreams_state_dir / "scheduler.json"
    state = json.loads(state_path.read_text(encoding="utf-8"))
    assert result["ran"] is True
    assert result["promoted"] == 1
    assert state["lastRunAt"]
    assert state["lastResult"]["promoted"] == 1
    assert "请记住我喜欢番茄钟" in manager.read_memory_markdown()


def test_scheduled_dreaming_skips_until_next_due_time(monkeypatch, tmp_path):
    home = tmp_path / "home"
    monkeypatch.setenv("AI_NATIVE_OS_HOME", str(home))
    monkeypatch.setenv("AI_NATIVE_OS_DREAMING_ENABLED", "1")
    monkeypatch.setenv("AI_NATIVE_OS_DREAMING_INTERVAL_SECONDS", "3600")
    manager = MarkdownMemoryManager()

    first = maybe_run_scheduled_dreaming(manager)
    second = maybe_run_scheduled_dreaming(manager)

    assert first["ran"] is True
    assert second["ran"] is False
    assert second["reason"] == "not_due"
