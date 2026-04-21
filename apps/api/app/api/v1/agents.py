"""对话与消息 CRUD API"""
import uuid
import json
import httpx
from fastapi import APIRouter, Depends, HTTPException, Header, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, func
from pydantic import BaseModel, Field

from app.core.app_registry import get_app_registry
from app.core.database import get_db
from app.core.llm_provider import stream_chat, agent_loop
from app.core.memory import ensure_memory_manager, get_memory_manager
from app.core.skill_context import build_skill_augmented_system_prompt
from app.models.conversation import Conversation, Message

router = APIRouter()


# ── 模型列表代理 ───────────────────────────────────────

PROVIDER_DEFAULTS: dict[str, dict] = {
    "anthropic":  {"base_url": "https://api.anthropic.com/v1",   "auth": "x-api-key"},
    "openai":     {"base_url": "https://api.openai.com/v1",       "auth": "bearer"},
    "google":     {"base_url": "https://generativelanguage.googleapis.com/v1beta", "auth": "query"},
    "deepseek":   {"base_url": "https://api.deepseek.com",        "auth": "bearer"},
    "qwen":       {"base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1", "auth": "bearer"},
    "zhipu":      {"base_url": "https://open.bigmodel.cn/api/paas/v4",  "auth": "bearer"},
    "moonshot":   {"base_url": "https://api.moonshot.cn/v1",      "auth": "bearer"},
    "doubao":     {"base_url": "https://ark.cn-beijing.volces.com/api/v3", "auth": "bearer"},
    "openai-compatible":   {"base_url": "", "auth": "bearer"},
    "anthropic-compatible": {"base_url": "", "auth": "x-api-key"},
}


class FetchModelsRequest(BaseModel):
    provider: str
    api_key: str
    base_url: str | None = None


@router.post("/models/fetch")
async def fetch_models(req: FetchModelsRequest):
    """代理请求 Provider 的模型列表，避免浏览器 CORS 限制。"""
    cfg = PROVIDER_DEFAULTS.get(req.provider, {"base_url": "", "auth": "bearer"})
    base = (req.base_url or cfg["base_url"]).rstrip("/")
    auth_type = cfg["auth"]

    if not base:
        raise HTTPException(status_code=400, detail="base_url is required for this provider")

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            if req.provider == "google":
                # Google: GET /v1beta/models?key=xxx
                resp = await client.get(
                    f"{base}/models",
                    params={"key": req.api_key},
                )
            elif auth_type == "x-api-key":
                # Anthropic
                resp = await client.get(
                    f"{base}/models",
                    headers={
                        "x-api-key": req.api_key,
                        "anthropic-version": "2023-06-01",
                    },
                )
            else:
                # OpenAI 兼容（大多数 provider）
                resp = await client.get(
                    f"{base}/models",
                    headers={"Authorization": f"Bearer {req.api_key}"},
                )

        if resp.status_code != 200:
            raise HTTPException(
                status_code=resp.status_code,
                detail=f"Provider returned {resp.status_code}: {resp.text[:200]}",
            )

        data = resp.json()

        # 不同 provider 的响应结构统一化
        if req.provider == "google":
            # Google: {"models": [{"name": "models/gemini-pro", ...}]}
            models = [
                m["name"].replace("models/", "")
                for m in data.get("models", [])
                if "generateContent" in m.get("supportedGenerationMethods", [])
            ]
        elif req.provider == "anthropic":
            # Anthropic: {"data": [{"id": "claude-...", ...}]}
            models = [m["id"] for m in data.get("data", [])]
        else:
            # OpenAI 兼容: {"data": [{"id": "gpt-4", ...}]}
            models = sorted([m["id"] for m in data.get("data", [])])

        return {"models": models}

    except httpx.RequestError as e:
        raise HTTPException(status_code=502, detail=f"Connection failed: {str(e)}")

DEFAULT_USER_ID = "default"


# ── Human-in-the-loop: tool execution confirmation ───────────────────────────

@router.post("/confirm")
async def confirm_tool_execution(request_id: str, approved: bool = True):
    """Resolve a pending Human-in-the-loop confirmation.

    The frontend calls this endpoint after showing the user a confirmation
    dialog for a dangerous tool. ``request_id`` must match the one received in
    the ``agent_confirm_required`` WebSocket event.
    """
    from app.core.confirmation_store import resolve_confirmation

    resolved = resolve_confirmation(request_id, approved)
    if not resolved:
        raise HTTPException(
            status_code=404,
            detail="No pending confirmation found for this request_id. It may have expired.",
        )
    return {"ok": True, "approved": approved}


# ── Schemas ──────────────────────────────────────────

class ConversationCreate(BaseModel):
    title: str = "新对话"
    model: str = "claude-sonnet-4-6"
    app_id: str = Field(default="ai-chat")


class ConversationResponse(BaseModel):
    id: str
    title: str
    model: str
    app_id: str
    created_at: str
    updated_at: str

    model_config = {"from_attributes": True}


class MessageResponse(BaseModel):
    id: str
    role: str
    content: str | None
    tool_calls: list | None
    tool_call_id: str | None = None
    created_at: str

    model_config = {"from_attributes": True}


# ── Conversations ─────────────────────────────────────

@router.get("/conversations", response_model=list[ConversationResponse])
async def list_conversations(
    app_id: str | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
):
    stmt = (
        select(Conversation)
        .where(Conversation.user_id == DEFAULT_USER_ID)
        .order_by(Conversation.updated_at.desc())
    )
    if app_id:
        stmt = stmt.where(Conversation.app_id == app_id)

    result = await db.execute(stmt)
    convs = result.scalars().all()
    return [
        ConversationResponse(
            id=c.id, title=c.title, model=c.model, app_id=c.app_id,
            created_at=c.created_at.isoformat(), updated_at=c.updated_at.isoformat(),
        )
        for c in convs
    ]


@router.post("/conversations", response_model=ConversationResponse)
async def create_conversation(
    data: ConversationCreate,
    db: AsyncSession = Depends(get_db),
):
    conv = Conversation(
        id=str(uuid.uuid4()),
        user_id=DEFAULT_USER_ID,
        title=data.title,
        model=data.model,
        app_id=data.app_id,
    )
    db.add(conv)
    await db.flush()
    return ConversationResponse(
        id=conv.id, title=conv.title, model=conv.model, app_id=conv.app_id,
        created_at=conv.created_at.isoformat(), updated_at=conv.updated_at.isoformat(),
    )


@router.delete("/conversations/{conv_id}")
async def delete_conversation(conv_id: str, db: AsyncSession = Depends(get_db)):
    await db.execute(delete(Message).where(Message.conversation_id == conv_id))
    await db.execute(delete(Conversation).where(Conversation.id == conv_id))
    return {"status": "ok"}


@router.get("/conversations/{conv_id}/messages", response_model=list[MessageResponse])
async def get_messages(conv_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Message)
        .where(Message.conversation_id == conv_id)
        .order_by(Message.created_at)
    )
    msgs = result.scalars().all()
    return [
        MessageResponse(
            id=m.id, role=m.role, content=m.content,
            tool_calls=m.tool_calls, tool_call_id=m.tool_call_id,
            created_at=m.created_at.isoformat(),
        )
        for m in msgs
    ]


@router.patch("/conversations/{conv_id}")
async def update_conversation_title(
    conv_id: str,
    data: dict,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Conversation).where(Conversation.id == conv_id))
    conv = result.scalar_one_or_none()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    if "title" in data:
        conv.title = data["title"]
    return {"status": "ok"}


# ── SSE Chat ──────────────────────────────────────────

class ChatRequest(BaseModel):
    message: str
    model: str = "claude-sonnet-4-6"
    provider_id: str = ""
    app_id: str | None = None
    history: list[dict] = []
    system_prompt: str = "你是 AI-Native OS 的智能助手，简洁友好地回答用户问题。"
    api_base: str | None = None
    user_id: str = DEFAULT_USER_ID
    enable_memory: bool = True
    embedding_config: dict | None = Field(default=None, alias="embeddingConfig")


class CompleteRequest(BaseModel):
    message: str
    model: str
    provider_id: str = ""
    compat_type: str = "openai"
    system_prompt: str = "你是 AI-Native OS 的智能助手，简洁友好地回答用户问题。"
    api_base: str | None = None


@router.post("/conversations/{conv_id}/chat")
async def chat(
    conv_id: str,
    req: ChatRequest,
    db: AsyncSession = Depends(get_db),
    x_api_key: str = Header(..., alias="X-Api-Key"),
):
    # 验证会话存在
    result = await db.execute(select(Conversation).where(Conversation.id == conv_id))
    conv = result.scalar_one_or_none()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")

    async def generate():
        full_response = ""
        tool_calls: list[dict] = []
        tool_results: list[dict] = []

        registry = get_app_registry()
        with registry.apply_user_skill_env():
            memory_mgr = None
            if req.enable_memory and req.embedding_config:
                memory_mgr = await ensure_memory_manager(
                    llm_model=req.model,
                    llm_api_key=x_api_key,
                    llm_api_base=req.api_base,
                    embedding_config=req.embedding_config,
                )
            elif req.enable_memory:
                memory_mgr = get_memory_manager()
            effective_system, skill_info = await build_skill_augmented_system_prompt(
                db,
                req.system_prompt,
                req.message,
                conversation_id=conv_id,
                requested_app_id=req.app_id,
            )

        if req.enable_memory and memory_mgr:
            memories = await memory_mgr.search(query=req.message, user_id=req.user_id, limit=5)
            relevant = [
                m for m in memories
                if isinstance(m, dict) and m.get("memory") and (m.get("score") or 0) >= 0.45
            ]
            if relevant:
                facts = "\n".join(f"- {m['memory']}" for m in relevant)
                effective_system = (
                    f"{effective_system}\n\n"
                    f"## 关于用户的已知信息（来自记忆）\n{facts}"
                )
                yield f"data: {json.dumps({'x_recalled': len(relevant)}, ensure_ascii=False)}\n\n"

        try:
            with registry.apply_user_skill_env():
                async for event_type, payload in agent_loop(
                    model=req.model,
                    messages=[*req.history, {"role": "user", "content": req.message}],
                    api_key=x_api_key,
                    provider_id=req.provider_id,
                    system_prompt=effective_system,
                    api_base=req.api_base,
                    skill_context=skill_info,
                    request_id=conv_id,
                ):
                    if event_type == "token":
                        full_response += payload
                        yield f"data: {json.dumps({'token': payload}, ensure_ascii=False)}\n\n"

                    elif event_type == "tool_call":
                        tool_calls.append(payload)
                        yield f"data: {json.dumps({'x_tool_call': payload}, ensure_ascii=False)}\n\n"

                    elif event_type == "tool_result":
                        tool_results.append(payload)
                        yield f"data: {json.dumps({'x_tool_result': payload}, ensure_ascii=False)}\n\n"

                    elif event_type == "status":
                        yield f"data: {json.dumps({'x_status': payload}, ensure_ascii=False)}\n\n"

            async with db.begin_nested():
                count_result = await db.execute(
                    select(func.count()).select_from(Message).where(
                        Message.conversation_id == conv_id
                    )
                )
                if count_result.scalar() == 0 and conv.title == "新对话":
                    conv.title = req.message[:24] + ("…" if len(req.message) > 24 else "")

                db.add(Message(id=str(uuid.uuid4()), conversation_id=conv_id, role="user", content=req.message))
                db.add(Message(
                    id=str(uuid.uuid4()),
                    conversation_id=conv_id,
                    role="assistant",
                    content=full_response,
                    tool_calls=tool_calls if tool_calls else None,
                ))
                for tr in tool_results:
                    db.add(Message(
                        id=str(uuid.uuid4()),
                        conversation_id=conv_id,
                        role="tool",
                        content=tr["result"],
                        tool_call_id=tr["id"],
                    ))
            await db.commit()

            yield f"data: {json.dumps({'x_done': True, 'title': conv.title}, ensure_ascii=False)}\n\n"
            yield "data: [DONE]\n\n"

            if req.enable_memory and memory_mgr and full_response:
                await memory_mgr.add_async(
                    user_id=req.user_id,
                    messages=[
                        {"role": "user", "content": req.message},
                        {"role": "assistant", "content": full_response},
                    ],
                )

        except Exception as e:
            yield f"data: {json.dumps({'x_error': str(e)}, ensure_ascii=False)}\n\n"
            yield "data: [DONE]\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/complete")
async def complete(
    req: CompleteRequest,
    x_api_key: str = Header(..., alias="X-Api-Key"),
):
    content = ""
    async for token in stream_chat(
        model=req.model,
        messages=[{"role": "user", "content": req.message}],
        api_key=x_api_key,
        provider_id=req.provider_id,
        compat_type=req.compat_type,
        system_prompt=req.system_prompt,
        api_base=req.api_base,
    ):
        content += token
    return {"content": content}
