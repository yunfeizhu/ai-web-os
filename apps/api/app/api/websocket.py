"""WebSocket 端点 — Agent 流式响应（含 tool calls / memory）"""
import uuid
import json
from fastapi import WebSocket, WebSocketDisconnect
from sqlalchemy import select, func
from app.core.database import AsyncSessionLocal
from app.core.llm_provider import agent_loop
from app.core.skill_context import build_skill_augmented_system_prompt
from app.models.conversation import Conversation, Message

DEFAULT_USER_ID = "default"


async def _save_messages(
    conv_id: str,
    user_content: str,
    assistant_content: str,
    tool_calls: list[dict],
    tool_results: list[dict],
):
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Conversation).where(Conversation.id == conv_id))
        conv = result.scalar_one_or_none()
        if not conv:
            return None

        count_result = await db.execute(
            select(func.count()).select_from(Message).where(Message.conversation_id == conv_id)
        )
        if count_result.scalar() == 0 and conv.title == "新对话":
            conv.title = user_content[:24] + ("…" if len(user_content) > 24 else "")

        db.add(Message(id=str(uuid.uuid4()), conversation_id=conv_id, role="user", content=user_content))
        db.add(Message(
            id=str(uuid.uuid4()),
            conversation_id=conv_id,
            role="assistant",
            content=assistant_content,
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
        return conv.title


async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()

    try:
        while True:
            raw = await websocket.receive_text()
            msg = json.loads(raw)
            msg_type = msg.get("type")

            if msg_type == "ping":
                await websocket.send_json({"type": "pong"})
                continue

            if msg_type == "agent_invoke":
                try:
                    request_id = msg.get("requestId", str(uuid.uuid4()))
                    payload = msg.get("payload", {})

                    conv_id: str = payload.get("conversationId", "")
                    user_message: str = payload.get("message", "")
                    model: str = payload.get("model", "claude-sonnet-4-6")
                    app_id: str | None = payload.get("appId")
                    provider_id: str = payload.get("providerId", "")
                    history: list = payload.get("history", [])
                    system_prompt: str = payload.get("systemPrompt", "你是 AI-Native OS 的智能助手，简洁友好地回答用户问题。")
                    api_key: str = payload.get("apiKey", "")
                    api_base: str | None = payload.get("apiBase") or None
                    enable_memory: bool = payload.get("enableMemory", True)
                    user_id: str = payload.get("userId", DEFAULT_USER_ID)
                    compat_type: str = payload.get("compatType", "openai")

                    if not api_key:
                        await websocket.send_json({
                            "type": "agent_error",
                            "requestId": request_id,
                            "payload": {"error": "未配置 API Key，请在设置中添加对应模型的 Key"},
                        })
                        continue

                    embedding_cfg: dict | None = payload.get("embeddingConfig")
                    llm_api_key: str = payload.get("llmApiKey") or api_key
                    llm_api_base: str | None = payload.get("llmApiBase") or None

                    # ── 记忆检索（按需自动初始化）────────────────────────────
                    from app.core.memory import get_memory_manager, init_memory_manager
                    memory_mgr = get_memory_manager()
                    if memory_mgr is None and embedding_cfg and llm_api_key:
                        import asyncio
                        loop = asyncio.get_event_loop()
                        try:
                            memory_mgr = await loop.run_in_executor(None, lambda: init_memory_manager(
                                llm_provider="litellm",
                                llm_model=model,
                                llm_api_key=llm_api_key,
                                llm_api_base=llm_api_base,
                                embedder_provider="openai",
                                embedder_model=embedding_cfg["model"],
                                embedder_api_key=embedding_cfg["apiKey"],
                                embedder_base_url=embedding_cfg["baseUrl"],
                                embedder_dims=embedding_cfg.get("dims", 1024),
                            ))
                            if memory_mgr:
                                memory_mgr.start()
                        except Exception:
                            memory_mgr = None
                    async with AsyncSessionLocal() as db:
                        effective_system, skill_info = await build_skill_augmented_system_prompt(
                            db,
                            system_prompt,
                            user_message,
                            conversation_id=conv_id,
                            requested_app_id=app_id,
                        )
                    if skill_info:
                        await websocket.send_json({
                            "type": "status",
                            "requestId": request_id,
                            "payload": {"status": "skill_loaded", **skill_info},
                        })

                    if enable_memory and memory_mgr:
                        memories = await memory_mgr.search(query=user_message, user_id=user_id, limit=5)
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
                            await websocket.send_json({
                                "type": "status",
                                "requestId": request_id,
                                "payload": {"status": "recalled", "count": len(relevant)},
                            })

                    # ── 流式生成 ──────────────────────────────────────────────
                    full_response = ""
                    tool_calls: list[dict] = []
                    tool_results: list[dict] = []

                    async for event_type, event_payload in agent_loop(
                        model=model,
                        messages=[*history, {"role": "user", "content": user_message}],
                        api_key=api_key,
                        provider_id=provider_id,
                        compat_type=compat_type,
                        system_prompt=effective_system,
                        api_base=api_base,
                    ):
                        if event_type == "token":
                            full_response += event_payload
                            await websocket.send_json({
                                "type": "token",
                                "requestId": request_id,
                                "payload": {"token": event_payload},
                            })

                        elif event_type == "tool_call":
                            tool_calls.append(event_payload)
                            await websocket.send_json({
                                "type": "tool_call",
                                "requestId": request_id,
                                "payload": event_payload,
                            })

                        elif event_type == "tool_result":
                            tool_results.append(event_payload)
                            await websocket.send_json({
                                "type": "tool_result",
                                "requestId": request_id,
                                "payload": event_payload,
                            })

                    # ── 保存消息 ──────────────────────────────────────────
                    title = None
                    if conv_id:
                        title = await _save_messages(
                            conv_id, user_message, full_response, tool_calls, tool_results
                        )

                    await websocket.send_json({
                        "type": "agent_done",
                        "requestId": request_id,
                        "payload": {"content": full_response, "title": title or ""},
                    })

                    # ── 更新记忆 ──────────────────────────────────────────
                    if enable_memory and memory_mgr and full_response:
                        await memory_mgr.add_async(
                            user_id=user_id,
                            messages=[
                                {"role": "user", "content": user_message},
                                {"role": "assistant", "content": full_response},
                            ],
                        )

                except Exception as e:
                    print(f"[WebSocket agent_invoke error] {e}")
                    await websocket.send_json({
                        "type": "agent_error",
                        "requestId": request_id,
                        "payload": {"error": str(e)},
                    })

    except WebSocketDisconnect:
        pass
    except Exception:
        pass
