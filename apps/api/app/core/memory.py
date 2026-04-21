"""Mem0 长期记忆管理器

特性：
- 非阻塞 async 写入队列（不卡 SSE 流）
- 500ms debounce 合并快速写入
- 相似度 > 0.95 跳过重复记忆
- 支持任意 LLM / Embedder provider（LiteLLM、Ollama、OpenAI 等）
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any

logger = logging.getLogger(__name__)

_manager: MemoryManager | None = None


def collection_name_for_embedding(model: str, dims: int | None) -> str:
    """Generate a dimension-specific Qdrant collection name for memories."""
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


def get_memory_manager() -> MemoryManager | None:
    return _manager


def _memory_manager_matches(
    manager: MemoryManager,
    *,
    embedder_provider: str,
    embedder_model: str,
    embedder_base_url: str | None,
    embedder_dims: int,
    collection_name: str,
) -> bool:
    metadata = manager.metadata()
    return (
        metadata.get("collection") == collection_name
        and metadata.get("embedder_provider") == embedder_provider
        and metadata.get("embedder_model") == embedder_model
        and metadata.get("embedder_base_url") == embedder_base_url
        and int(metadata.get("embedder_dims") or 0) == embedder_dims
    )


async def ensure_memory_manager(
    *,
    llm_model: str,
    llm_api_key: str | None,
    llm_api_base: str | None,
    embedding_config: dict[str, Any] | None,
    qdrant_host: str = "127.0.0.1",
    qdrant_port: int = 16333,
) -> MemoryManager | None:
    """Return a memory manager matching the active embedding config.

    Qdrant collection dimensions are immutable. If the user switches from a
    1024-dimensional embedder to a 4096-dimensional embedder, reusing the old
    in-process MemoryManager will query the wrong collection and trigger
    `expected dim: 1024, got 4096`. This helper makes the active embedding
    config the source of truth for every chat request.
    """
    if not embedding_config or not llm_api_key:
        return None

    embedder_model = str(embedding_config.get("model") or "").strip()
    embedder_api_key = str(embedding_config.get("apiKey") or "").strip()
    embedder_base_url = str(embedding_config.get("baseUrl") or "").strip() or None
    embedder_dims = _normalize_dims(embedding_config.get("dims"))
    if not embedder_model or not embedder_api_key or not embedder_base_url or not embedder_dims:
        logger.warning("memory disabled: incomplete embedding config or missing dimensions")
        return None

    embedder_provider = "openai"
    collection_name = collection_name_for_embedding(embedder_model, embedder_dims)
    current = get_memory_manager()
    if current and _memory_manager_matches(
        current,
        embedder_provider=embedder_provider,
        embedder_model=embedder_model,
        embedder_base_url=embedder_base_url,
        embedder_dims=embedder_dims,
        collection_name=collection_name,
    ):
        return current

    loop = asyncio.get_event_loop()
    try:
        manager = await loop.run_in_executor(
            None,
            lambda: init_memory_manager(
                llm_provider="litellm",
                llm_model=llm_model,
                llm_api_key=llm_api_key,
                llm_api_base=llm_api_base,
                embedder_provider=embedder_provider,
                embedder_model=embedder_model,
                embedder_api_key=embedder_api_key,
                embedder_base_url=embedder_base_url,
                embedder_dims=embedder_dims,
                qdrant_host=qdrant_host,
                qdrant_port=qdrant_port,
                collection_name=collection_name,
            ),
        )
        manager.start()
        logger.info(
            "memory manager activated: collection=%s model=%s dims=%s",
            collection_name,
            embedder_model,
            embedder_dims,
        )
        return manager
    except Exception as exc:
        logger.error("memory init error: %s", exc)
        return None


def init_memory_manager(
    *,
    # LLM 配置（必须）
    llm_provider: str = "litellm",
    llm_model: str,
    llm_api_key: str | None = None,
    llm_api_base: str | None = None,
    # Embedder 配置（可选，默认用 ollama nomic-embed-text）
    embedder_provider: str = "ollama",
    embedder_model: str = "nomic-embed-text",
    embedder_api_key: str | None = None,
    embedder_base_url: str | None = None,
    embedder_dims: int | None = None,
    # Qdrant 配置
    qdrant_host: str = "127.0.0.1",
    qdrant_port: int = 16333,
    collection_name: str = "ai_os_memories",
) -> MemoryManager:
    global _manager
    if _manager is not None:
        _manager.stop()
    _manager = MemoryManager(
        llm_provider=llm_provider,
        llm_model=llm_model,
        llm_api_key=llm_api_key,
        llm_api_base=llm_api_base,
        embedder_provider=embedder_provider,
        embedder_model=embedder_model,
        embedder_api_key=embedder_api_key,
        embedder_base_url=embedder_base_url,
        embedder_dims=embedder_dims,
        qdrant_host=qdrant_host,
        qdrant_port=qdrant_port,
        collection_name=collection_name,
    )
    return _manager


class MemoryManager:
    """Mem0 记忆管理器，带异步写入队列和去重。"""

    def __init__(
        self,
        *,
        llm_provider: str,
        llm_model: str,
        llm_api_key: str | None,
        llm_api_base: str | None,
        embedder_provider: str,
        embedder_model: str,
        embedder_api_key: str | None,
        embedder_base_url: str | None,
        embedder_dims: int | None,
        qdrant_host: str,
        qdrant_port: int,
        collection_name: str,
    ):
        from mem0 import Memory

        self.llm_provider = llm_provider
        self.llm_model = llm_model
        self.llm_api_base = llm_api_base
        self.embedder_provider = embedder_provider
        self.embedder_model = embedder_model
        self.embedder_base_url = embedder_base_url
        self.embedder_dims = embedder_dims
        self.qdrant_host = qdrant_host
        self.qdrant_port = qdrant_port
        self.collection_name = collection_name

        # LLM 配置：用 openai provider（支持所有 OpenAI 兼容接口）
        llm_config: dict[str, Any] = {
            "provider": "openai",
            "config": {"model": llm_model, "temperature": 0.1, "max_tokens": 2000},
        }
        if llm_api_key:
            llm_config["config"]["api_key"] = llm_api_key
        if llm_api_base:
            llm_config["config"]["openai_base_url"] = llm_api_base

        # Embedder 配置
        embedder_config: dict[str, Any] = {
            "provider": embedder_provider,
            "config": {"model": embedder_model},
        }
        if embedder_provider == "ollama":
            if embedder_base_url:
                embedder_config["config"]["ollama_base_url"] = embedder_base_url
        elif embedder_provider == "openai":
            if embedder_api_key:
                embedder_config["config"]["api_key"] = embedder_api_key
            if embedder_base_url:
                embedder_config["config"]["openai_base_url"] = embedder_base_url
            # 注意：不传 embedding_dims 给 embedder，避免 mem0 向 API 发送 dimensions 参数
            # 对于 bge 等固定维度模型，dimensions 参数会被拒绝
            # 维度通过 vector_store 的 embedding_model_dims 告诉 Qdrant
        elif embedder_provider in ("huggingface", "azure", "vertexai", "lmstudio"):
            if embedder_base_url:
                embedder_config["config"]["base_url"] = embedder_base_url
            if embedder_api_key:
                embedder_config["config"]["api_key"] = embedder_api_key

        config: dict[str, Any] = {
            "llm": llm_config,
            "embedder": embedder_config,
            "vector_store": {
                "provider": "qdrant",
                "config": {
                    "collection_name": collection_name,
                    "host": qdrant_host,
                    "port": qdrant_port,
                    **({"embedding_model_dims": embedder_dims} if embedder_dims else {}),
                },
            },
            "custom_fact_extraction_prompt": (
                "从以下对话中提取关于用户的重要事实和偏好，用中文表述。\n"
                "只提取有实质意义的信息（如姓名、职业、技能、喜好、观点、目标等）。\n"
                "忽略闲聊、问候和无意义的内容。\n"
                "以 JSON 格式返回，key 为 \"facts\"，value 为字符串列表（无内容时返回空列表 []）。\n\n"
                "对话内容：{messages}"
            ),
        }

        logger.info("mem0 config: %s", config)
        self.mem0 = Memory.from_config(config)

        # Patch: 移除 response_format 参数，兼容不支持 json_object 的第三方接口
        # （阿里百炼、硅基流动等兼容接口忽略该参数，导致返回普通字符串被逐字符迭代）
        original_generate = self.mem0.llm.generate_response
        def _patched_generate(messages, response_format=None, **kwargs):
            return original_generate(messages, response_format=None, **kwargs)
        self.mem0.llm.generate_response = _patched_generate

        self._write_queue: asyncio.Queue = asyncio.Queue()
        self._debounce_tasks: dict[str, asyncio.Task] = {}
        self._worker_task: asyncio.Task | None = None
        self._started = False

    def start(self):
        """在事件循环启动后调用。"""
        if self._started and self._worker_task and not self._worker_task.done():
            return
        self._worker_task = asyncio.create_task(self._write_worker())
        self._started = True

    def metadata(self) -> dict[str, Any]:
        """Expose the active memory backend so clients can detect stale managers."""
        return {
            "collection": self.collection_name,
            "llm_provider": self.llm_provider,
            "llm_model": self.llm_model,
            "llm_api_base": self.llm_api_base,
            "embedder_provider": self.embedder_provider,
            "embedder_model": self.embedder_model,
            "embedder_base_url": self.embedder_base_url,
            "embedder_dims": self.embedder_dims,
            "qdrant_host": self.qdrant_host,
            "qdrant_port": self.qdrant_port,
        }

    async def _write_worker(self):
        while True:
            try:
                item = await self._write_queue.get()
                user_id: str = item["user_id"]
                messages: list[dict] = item["messages"]

                # debounce：取消同用户之前的待刷写任务
                if user_id in self._debounce_tasks:
                    self._debounce_tasks[user_id].cancel()

                async def _flush(uid: str, msgs: list[dict]):
                    await asyncio.sleep(0.5)
                    await self._write_with_dedup(uid, msgs)
                    self._debounce_tasks.pop(uid, None)

                self._debounce_tasks[user_id] = asyncio.create_task(
                    _flush(user_id, messages)
                )
                self._write_queue.task_done()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error("memory write worker error: %s", e)

    async def _write_with_dedup(self, user_id: str, messages: list[dict]):
        """写入记忆，相似度 > 0.95 跳过。"""
        try:
            last_content = messages[-1].get("content", "") if messages else ""
            if last_content:
                raw = await asyncio.get_event_loop().run_in_executor(
                    None,
                    lambda: self.mem0.search(
                        query=last_content, user_id=user_id, limit=3
                    ),
                )
                existing = raw.get("results", []) if isinstance(raw, dict) else (raw if isinstance(raw, list) else [])
                if existing:
                    top = existing[0]
                    score = top.get("score", 0) if isinstance(top, dict) else 0
                    if score > 0.95:
                        logger.debug("skipping duplicate memory (score=%.3f)", score)
                        return

            await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: self.mem0.add(messages=messages, user_id=user_id),
            )
            logger.debug("memory written for user %s", user_id)
        except Exception as e:
            logger.error("memory write error for user %s: %s", user_id, e)

    async def add_async(self, user_id: str, messages: list[dict]):
        """非阻塞：将记忆写入放入队列，不卡 SSE 流。"""
        await self._write_queue.put({"user_id": user_id, "messages": messages})

    async def search(self, query: str, user_id: str, limit: int = 5) -> list[dict]:
        """搜索记忆（在 executor 中执行）。"""
        try:
            results = await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: self.mem0.search(query=query, user_id=user_id, limit=limit),
            )
            if isinstance(results, dict):
                return results.get("results", [])
            return results if isinstance(results, list) else []
        except Exception as e:
            logger.error("memory search error: %s", e)
            return []

    async def get_all(self, user_id: str) -> list[dict]:
        """获取用户所有记忆。"""
        try:
            results = await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: self.mem0.get_all(user_id=user_id),
            )
            logger.info("get_all raw result type=%s value=%s", type(results), results)
            if isinstance(results, dict):
                return results.get("results", [])
            return results if isinstance(results, list) else []
        except Exception as e:
            logger.error("memory get_all error: %s", e)
            return []

    async def delete(self, memory_id: str):
        """删除单条记忆。"""
        await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: self.mem0.delete(memory_id=memory_id),
        )

    async def delete_all(self, user_id: str):
        """删除用户所有记忆。"""
        await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: self.mem0.delete_all(user_id=user_id),
        )

    def stop(self):
        for task in self._debounce_tasks.values():
            task.cancel()
        self._debounce_tasks.clear()
        if self._worker_task:
            self._worker_task.cancel()
        self._started = False
