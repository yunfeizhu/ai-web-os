import asyncio
import builtins

from app.core import memory


def test_collection_name_for_embedding_keeps_legacy_format():
    assert memory.collection_name_for_embedding("BAAI/bge-m3", 1024) == "ai_os_mem_bge_m3_1024"


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
