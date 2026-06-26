import asyncio
import builtins
from types import SimpleNamespace

from app.core import memory


def test_init_memory_manager_never_imports_legacy_qdrant_memories(
    monkeypatch,
    tmp_path,
):
    monkeypatch.setenv("AI_NATIVE_OS_HOME", str(tmp_path / "home"))
    monkeypatch.setenv("AI_NATIVE_OS_IMPORT_LEGACY_MEMORY", "true")
    monkeypatch.setattr(memory, "_manager", None)
    called = False

    def fake_import(manager, **kwargs):
        nonlocal called
        called = True
        manager.write_memory_markdown(
            manager.read_memory_markdown()
            + "\n## 事实与背景\n\n- 旧版 Qdrant 脏数据\n"
        )
        return SimpleNamespace(imported=1)

    monkeypatch.setattr(memory, "import_legacy_qdrant_memories", fake_import, raising=False)

    manager = memory.init_memory_manager(llm_model="x")

    assert called is False
    assert "旧版 Qdrant 脏数据" not in manager.read_memory_markdown()


def test_ensure_memory_manager_returns_markdown_without_embedding_or_api_key(
    monkeypatch,
    tmp_path,
):
    monkeypatch.setenv("AI_NATIVE_OS_HOME", str(tmp_path / "home"))
    monkeypatch.setattr(memory, "_manager", None)

    manager = asyncio.run(
        memory.ensure_memory_manager(
            llm_model="x",
            llm_api_key=None,
            llm_api_base=None,
            embedding_config=None,
        )
    )

    assert manager is not None
    assert manager.metadata()["backend"] == "markdown"
    assert manager.metadata()["collection"] == "markdown:default"
    assert memory.get_memory_manager() is manager


def test_ensure_memory_manager_accepts_llm_model_only(
    monkeypatch,
    tmp_path,
):
    monkeypatch.setenv("AI_NATIVE_OS_HOME", str(tmp_path / "home"))
    monkeypatch.setattr(memory, "_manager", None)

    manager = asyncio.run(memory.ensure_memory_manager(llm_model="x"))

    assert manager is not None
    assert manager.metadata()["backend"] == "markdown"
    assert manager.metadata()["collection"] == "markdown:default"
    assert memory.get_memory_manager() is manager


def test_ensure_memory_manager_ignores_legacy_embedder_dims(
    monkeypatch,
    tmp_path,
):
    monkeypatch.setenv("AI_NATIVE_OS_HOME", str(tmp_path / "home"))
    monkeypatch.setattr(memory, "_manager", None)
    manager = asyncio.run(
        memory.ensure_memory_manager(
            llm_model="x",
            llm_api_key=None,
            llm_api_base=None,
            embedding_config=None,
        )
    )

    same_manager = asyncio.run(
        memory.ensure_memory_manager(llm_model="x", embedder_dims=1024)
    )

    assert same_manager is manager
    assert same_manager.metadata()["backend"] == "markdown"
    assert same_manager.metadata()["collection"] == "markdown:default"
    assert asyncio.run(same_manager.get_all()) == []


def test_ensure_memory_manager_runs_due_dreaming_when_enabled(
    monkeypatch,
    tmp_path,
):
    monkeypatch.setenv("AI_NATIVE_OS_HOME", str(tmp_path / "home"))
    monkeypatch.setenv("AI_NATIVE_OS_DREAMING_ENABLED", "1")
    monkeypatch.setenv("AI_NATIVE_OS_DREAMING_INTERVAL_SECONDS", "0")
    monkeypatch.setattr(memory, "_manager", None)

    manager = asyncio.run(memory.ensure_memory_manager(llm_model="x"))
    asyncio.run(
        manager.add_async(
            "alice",
            [
                {"role": "user", "content": "请记住我喜欢番茄钟"},
                {"role": "assistant", "content": "好的。"},
            ],
        )
    )

    same_manager = asyncio.run(memory.ensure_memory_manager(llm_model="x"))

    assert same_manager is manager
    assert "请记住我喜欢番茄钟" in manager.read_memory_markdown()


def test_init_memory_manager_returns_usable_markdown_manager_without_mem0_import(
    monkeypatch,
    tmp_path,
):
    monkeypatch.setenv("AI_NATIVE_OS_HOME", str(tmp_path / "home"))
    monkeypatch.setattr(memory, "_manager", None)
    original_import = builtins.__import__

    def fail_on_mem0(name, *args, **kwargs):
        if name == "mem0" or name.startswith("mem0."):
            raise AssertionError("mem0 must not be imported")
        return original_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", fail_on_mem0)

    manager = memory.init_memory_manager(llm_model="x")

    assert manager.metadata()["backend"] == "markdown"
    assert manager.metadata()["collection"] == "markdown:default"
    assert asyncio.run(manager.get_all()) == []
    assert memory.get_memory_manager() is manager
