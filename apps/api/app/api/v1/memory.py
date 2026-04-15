"""记忆管理 API"""
import asyncio
from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel

from app.core.memory import get_memory_manager, init_memory_manager

router = APIRouter()

DEFAULT_USER_ID = "default"


# ── 初始化记忆管理器 ─────────────────────────────────────

class InitMemoryRequest(BaseModel):
    # LLM（用于提取记忆的模型）
    llm_provider: str = "litellm"
    llm_model: str
    llm_api_key: str | None = None
    llm_api_base: str | None = None
    # Embedder（默认 Ollama 本地，无需 key）
    embedder_provider: str = "ollama"
    embedder_model: str = "nomic-embed-text"
    embedder_api_key: str | None = None
    embedder_base_url: str | None = None
    embedder_dims: int | None = None
    # Qdrant
    qdrant_host: str = "127.0.0.1"
    qdrant_port: int = 16333


def _collection_name(model: str, dims: int | None) -> str:
    """根据 embedder model 和维度生成唯一 collection 名。
    e.g. "BAAI/bge-large-zh-v1.5" + 1024 → "ai_os_mem_bge_large_zh_v1_5_1024"
    """
    slug = model.lower().split("/")[-1]          # 取 / 后半段
    slug = "".join(c if c.isalnum() else "_" for c in slug)  # 非字母数字转 _
    slug = slug.strip("_")
    suffix = f"_{dims}" if dims else ""
    return f"ai_os_mem_{slug}{suffix}"


@router.post("/memory/init")
async def init_memory(req: InitMemoryRequest):
    """初始化记忆管理器，每个 Embedding 模型使用独立的 Qdrant collection。"""
    collection = _collection_name(req.embedder_model, req.embedder_dims)
    mgr = init_memory_manager(
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
        collection_name=collection,
    )
    mgr.start()
    return {"status": "ok", "collection": collection}


# ── 调试：直接写入测试 ────────────────────────────────────

@router.post("/memory/test-write")
async def test_write_memory():
    """调试用：直接写入一条测试记忆，看报什么错。"""
    mgr = get_memory_manager()
    if not mgr:
        raise HTTPException(status_code=503, detail="Memory not initialized")
    try:
        result = await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: mgr.mem0.add(
                messages=[{"role": "user", "content": "我是测试用户，喜欢写代码"}],
                user_id="default",
            ),
        )
        return {"status": "ok", "result": str(result)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── 查询记忆 ─────────────────────────────────────────────

@router.get("/memory")
async def list_memories(user_id: str = DEFAULT_USER_ID):
    mgr = get_memory_manager()
    if not mgr:
        return {"memories": [], "initialized": False}
    memories = await mgr.get_all(user_id=user_id)
    return {"memories": memories, "initialized": True}


@router.get("/memory/search")
async def search_memories(q: str, user_id: str = DEFAULT_USER_ID):
    mgr = get_memory_manager()
    if not mgr:
        return {"memories": []}
    memories = await mgr.search(query=q, user_id=user_id, limit=10)
    return {"memories": memories}


# ── 删除记忆 ─────────────────────────────────────────────

@router.delete("/memory/{memory_id}")
async def delete_memory(memory_id: str):
    mgr = get_memory_manager()
    if not mgr:
        raise HTTPException(status_code=503, detail="Memory not initialized")
    await mgr.delete(memory_id=memory_id)
    return {"status": "ok"}


@router.delete("/memory")
async def clear_memories(user_id: str = DEFAULT_USER_ID):
    mgr = get_memory_manager()
    if not mgr:
        raise HTTPException(status_code=503, detail="Memory not initialized")
    await mgr.delete_all(user_id=user_id)
    return {"status": "ok"}
