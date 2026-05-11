"""Compatibility entry points for the markdown-backed memory manager."""
from __future__ import annotations

import logging
import os
from typing import Any

from app.core.legacy_memory_import import import_legacy_qdrant_memories
from app.core.markdown_memory import MarkdownMemoryManager
from app.core.memory_dreaming import maybe_run_scheduled_dreaming
from app.core.memory_paths import AI_NATIVE_OS_HOME_ENV

logger = logging.getLogger(__name__)
_manager: MarkdownMemoryManager | None = None
LEGACY_MEMORY_IMPORT_ENV = "AI_NATIVE_OS_IMPORT_LEGACY_MEMORY"


def collection_name_for_embedding(model: str, dims: int | None) -> str:
    """Generate a dimension-specific legacy collection name for memories."""
    slug = str(model or "").lower().split("/")[-1]
    slug = "".join(c if c.isalnum() else "_" for c in slug).strip("_")
    suffix = f"_{dims}" if dims else ""
    return f"ai_os_mem_{slug or 'default'}{suffix}"


def _normalize_dims(value: Any) -> int | None:
    try:
        dims = int(value)
    except (TypeError, ValueError):
        return None
    return dims if dims > 0 else None


def get_memory_manager() -> MarkdownMemoryManager | None:
    return _manager


async def ensure_memory_manager(
    *,
    llm_model: str,
    llm_api_key: str | None = None,
    llm_api_base: str | None = None,
    embedding_config: dict[str, Any] | None = None,
    embedder_dims: int | None = None,
    qdrant_host: str = "127.0.0.1",
    qdrant_port: int = 16333,
) -> MarkdownMemoryManager:
    """Return the process-wide markdown memory manager.

    The parameters are retained for compatibility with the previous mem0/Qdrant
    initialization path. Markdown memory does not require model, key, embedder,
    or vector-store configuration, so those values are intentionally ignored.
    """
    del (
        llm_model,
        llm_api_key,
        llm_api_base,
        embedding_config,
        embedder_dims,
        qdrant_host,
        qdrant_port,
    )

    current = get_memory_manager()
    if current is not None:
        _maybe_run_scheduled_dreaming(current)
        return current

    manager = init_memory_manager(llm_model="")
    manager.start()
    _maybe_run_scheduled_dreaming(manager)
    return manager


def init_memory_manager(
    *,
    # LLM 配置（保留旧签名兼容）
    llm_provider: str = "litellm",
    llm_model: str,
    llm_api_key: str | None = None,
    llm_api_base: str | None = None,
    # Embedder 配置（旧 mem0 参数，markdown backend 忽略）
    embedder_provider: str = "ollama",
    embedder_model: str = "nomic-embed-text",
    embedder_api_key: str | None = None,
    embedder_base_url: str | None = None,
    embedder_dims: int | None = None,
    # Qdrant 配置（旧 mem0 参数，markdown backend 忽略）
    qdrant_host: str = "127.0.0.1",
    qdrant_port: int = 16333,
    collection_name: str = "ai_os_memories",
) -> MarkdownMemoryManager:
    """Create and install a markdown-backed manager using the legacy signature."""
    del (
        llm_provider,
        llm_model,
        llm_api_key,
        llm_api_base,
        embedder_provider,
        embedder_model,
        embedder_api_key,
        embedder_base_url,
        embedder_dims,
        collection_name,
    )

    global _manager
    if _manager is not None:
        _manager.stop()
    _manager = MarkdownMemoryManager()
    _manager.normalize_memory_markdown()
    if _should_import_legacy_memory():
        try:
            result = import_legacy_qdrant_memories(
                _manager,
                qdrant_host=qdrant_host,
                qdrant_port=qdrant_port,
            )
            _manager.normalize_memory_markdown()
            if result.imported:
                logger.info(
                    "imported %s legacy memory records into Markdown",
                    result.imported,
                )
        except Exception as exc:
            logger.warning("legacy memory import skipped: %s", exc)
    return _manager


def _should_import_legacy_memory() -> bool:
    configured = os.getenv(LEGACY_MEMORY_IMPORT_ENV)
    if configured is not None:
        return configured.strip().lower() in {"1", "true", "yes", "on"}

    # A custom AI_NATIVE_OS_HOME is commonly used by tests and isolated profiles.
    # Avoid pulling the user's live Qdrant memories into those separate homes.
    return os.getenv(AI_NATIVE_OS_HOME_ENV) is None


def _maybe_run_scheduled_dreaming(manager: MarkdownMemoryManager) -> None:
    try:
        maybe_run_scheduled_dreaming(manager)
    except Exception as exc:
        logger.warning("scheduled dreaming sweep skipped: %s", exc)
