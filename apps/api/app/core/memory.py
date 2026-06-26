"""Compatibility entry points for the markdown-backed memory manager."""
from __future__ import annotations

import logging
from typing import Any

from app.core.markdown_memory import MarkdownMemoryManager
from app.core.memory_dreaming import maybe_run_scheduled_dreaming

logger = logging.getLogger(__name__)
_manager: MarkdownMemoryManager | None = None


def get_memory_manager() -> MarkdownMemoryManager | None:
    return _manager


async def ensure_memory_manager(
    *,
    llm_model: str,
    llm_api_key: str | None = None,
    llm_api_base: str | None = None,
    embedding_config: dict[str, Any] | None = None,
    embedder_dims: int | None = None,
) -> MarkdownMemoryManager:
    """Return the process-wide markdown memory manager.

    Markdown memory does not require model, key, or embedder configuration, so
    those values are intentionally ignored.
    """
    del (
        llm_model,
        llm_api_key,
        llm_api_base,
        embedding_config,
        embedder_dims,
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
) -> MarkdownMemoryManager:
    """Create and install a markdown-backed manager."""
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
    )

    global _manager
    if _manager is not None:
        _manager.stop()
    _manager = MarkdownMemoryManager()
    _manager.normalize_memory_markdown()
    return _manager


def _maybe_run_scheduled_dreaming(manager: MarkdownMemoryManager) -> None:
    try:
        maybe_run_scheduled_dreaming(manager)
    except Exception as exc:
        logger.warning("scheduled dreaming sweep skipped: %s", exc)
