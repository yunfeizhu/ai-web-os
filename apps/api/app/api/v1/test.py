"""连接测试 API"""
import httpx
from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()


class TestConnectionRequest(BaseModel):
    type: str           # "llm" | "tool" | "embedding"
    api_key: str
    base_url: str | None = None
    # LLM 专用
    provider: str | None = None
    model: str | None = None
    # Embedding 专用
    embedding_model: str | None = None
    # Tool 专用
    tool: str | None = None  # "tavily"


@router.post("/test/connection")
async def test_connection(req: TestConnectionRequest):
    try:
        if req.type == "llm":
            return await _test_llm(req)
        elif req.type == "embedding":
            return await _test_embedding(req)
        elif req.type == "tool":
            return await _test_tool(req)
        else:
            return {"ok": False, "message": f"未知类型: {req.type}"}
    except Exception as e:
        return {"ok": False, "message": str(e)}


async def _test_llm(req: TestConnectionRequest):
    from app.api.v1.agents import PROVIDER_DEFAULTS

    cfg = PROVIDER_DEFAULTS.get(req.provider or "", {"base_url": "", "auth": "bearer"})
    base = (req.base_url or cfg["base_url"]).rstrip("/")
    if not base:
        return {"ok": False, "message": "请填写 Base URL"}

    model = req.model or "gpt-4o-mini"
    headers = {}
    if cfg["auth"] == "x-api-key":
        headers = {"x-api-key": req.api_key, "anthropic-version": "2023-06-01"}
    else:
        headers = {"Authorization": f"Bearer {req.api_key}"}

    # Anthropic 用自己的格式
    if cfg["auth"] == "x-api-key":
        payload = {
            "model": model,
            "max_tokens": 1,
            "messages": [{"role": "user", "content": "hi"}],
        }
    else:
        payload = {
            "model": model,
            "max_tokens": 1,
            "messages": [{"role": "user", "content": "hi"}],
        }

    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(f"{base}/chat/completions", headers=headers, json=payload)

    if resp.status_code in (200, 400):
        # 400 可能是 model 不存在但 key 有效，也算通过
        data = resp.json()
        if resp.status_code == 400 and "invalid_api_key" in str(data).lower():
            return {"ok": False, "message": "API Key 无效"}
        return {"ok": True, "message": "连接成功"}
    elif resp.status_code == 401:
        return {"ok": False, "message": "API Key 无效或已过期"}
    elif resp.status_code == 403:
        return {"ok": False, "message": "API Key 无权限"}
    elif resp.status_code == 404:
        return {"ok": False, "message": "接口地址不存在，请检查 Base URL"}
    else:
        return {"ok": False, "message": f"连接失败（HTTP {resp.status_code}）"}


async def _test_embedding(req: TestConnectionRequest):
    base = (req.base_url or "").rstrip("/")
    if not base:
        return {"ok": False, "message": "请填写 Base URL"}

    model = req.embedding_model or "text-embedding-3-small"
    headers = {"Authorization": f"Bearer {req.api_key}", "Content-Type": "application/json"}
    payload = {"model": model, "input": "test"}

    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(f"{base}/embeddings", headers=headers, json=payload)

    if resp.status_code == 200:
        data = resp.json()
        if "data" in data and isinstance(data["data"], list) and len(data["data"]) > 0:
            dims = len(data["data"][0].get("embedding", []))
            return {"ok": True, "message": f"连接成功，向量维度 {dims}"}
        return {"ok": True, "message": "连接成功"}
    elif resp.status_code == 401:
        return {"ok": False, "message": "API Key 无效或已过期"}
    elif resp.status_code == 403:
        return {"ok": False, "message": "API Key 无权限"}
    elif resp.status_code == 404:
        return {"ok": False, "message": "接口地址不存在，请检查 Base URL"}
    else:
        try:
            detail = resp.json()
        except Exception:
            detail = resp.text[:100]
        return {"ok": False, "message": f"连接失败（HTTP {resp.status_code}）"}


async def _test_tool(req: TestConnectionRequest):
    if req.tool == "tavily":
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                "https://api.tavily.com/search",
                headers={"Content-Type": "application/json"},
                json={"api_key": req.api_key, "query": "test", "max_results": 1},
            )
        if resp.status_code == 200:
            return {"ok": True, "message": "连接成功"}
        elif resp.status_code == 401:
            return {"ok": False, "message": "API Key 无效或已过期"}
        else:
            return {"ok": False, "message": f"连接失败（HTTP {resp.status_code}）"}
    return {"ok": False, "message": f"未知工具: {req.tool}"}
