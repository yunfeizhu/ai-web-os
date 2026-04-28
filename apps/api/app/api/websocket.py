"""WebSocket endpoint for streaming agent responses."""

from __future__ import annotations

import json
import asyncio
import uuid

from fastapi import WebSocket, WebSocketDisconnect
from sqlalchemy import func, select

from app.config import get_settings
from app.core.agent_traffic_metrics import (
    build_agent_traffic_record,
    get_agent_traffic_metrics_store,
)
from app.core.app_registry import get_app_registry
from app.core.confirmation_store import create_confirmation, discard_confirmation
from app.core.database import AsyncSessionLocal
from app.core.agent_handoff import (
    build_handoff_context,
    memory_user_id_for_agent,
    normalize_active_agent,
)
from app.core.llm_provider import agent_loop
from app.core.agent_usage import estimate_agent_usage
from app.core.skill_context import build_skill_augmented_system_prompt
from app.core.user_errors import user_facing_error_message
from app.models.conversation import Conversation, Message

DEFAULT_USER_ID = "default"
DEFAULT_SYSTEM_PROMPT = "你是 AI-Native OS 的智能助手，请简洁、友好地回答用户问题。"


def _split_token_for_display(token: str, *, chunk_size: int = 72) -> list[str]:
    text = str(token or "")
    if len(text) <= chunk_size:
        return [text] if text else []

    chunks: list[str] = []
    cursor = 0
    while cursor < len(text):
        end = min(cursor + chunk_size, len(text))
        if end < len(text):
            window = text[cursor:end]
            split_at = max(
                window.rfind("。"),
                window.rfind("，"),
                window.rfind("、"),
                window.rfind("；"),
                window.rfind("\n"),
                window.rfind(" "),
            )
            if split_at >= chunk_size // 2:
                end = cursor + split_at + 1
        chunks.append(text[cursor:end])
        cursor = end
    return chunks


async def _send_token(
    websocket: WebSocket,
    request_id: str,
    token: str,
    *,
    event_type: str = "token",
) -> None:
    chunks = _split_token_for_display(token)
    for index, chunk in enumerate(chunks):
        await websocket.send_json(
            {
                "type": event_type,
                "requestId": request_id,
                "payload": {"token": chunk},
            }
        )
        if len(chunks) > 1 and index < len(chunks) - 1:
            await asyncio.sleep(0.008)


async def _save_messages(
    conv_id: str,
    user_content: str,
    assistant_content: str,
    reasoning_content: str,
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
            conv.title = user_content[:24] + ("..." if len(user_content) > 24 else "")

        db.add(Message(id=str(uuid.uuid4()), conversation_id=conv_id, role="user", content=user_content))
        db.add(
            Message(
                id=str(uuid.uuid4()),
                conversation_id=conv_id,
                role="assistant",
                content=assistant_content,
                reasoning_content=reasoning_content or None,
                tool_calls=tool_calls or None,
            )
        )
        for tool_result in tool_results:
            db.add(
                Message(
                    id=str(uuid.uuid4()),
                    conversation_id=conv_id,
                    role="tool",
                    content=tool_result["result"],
                    tool_call_id=tool_result["id"],
                )
            )
        await db.commit()
        return conv.title


def _make_confirm_callback(websocket: WebSocket, request_id: str):
    """Return an async callback that pauses the agent loop awaiting user confirmation.

    The callback sends an ``agent_confirm_required`` event to the client, then
    waits up to 120 seconds for a ``POST /api/v1/agents/confirm`` call that
    resolves the Future via ``confirmation_store.resolve_confirmation()``.
    """

    async def _callback(tool_name: str, args: dict) -> bool:
        future = create_confirmation(request_id)
        await websocket.send_json(
            {
                "type": "agent_confirm_required",
                "requestId": request_id,
                "payload": {"toolName": tool_name, "args": args},
            }
        )
        try:
            return await asyncio.wait_for(asyncio.shield(future), timeout=120.0)
        except asyncio.TimeoutError:
            return False
        finally:
            discard_confirmation(request_id)

    return _callback


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

            if msg_type != "agent_invoke":
                continue

            request_id = msg.get("requestId", str(uuid.uuid4()))

            try:
                payload = msg.get("payload", {})

                conv_id: str = payload.get("conversationId", "")
                user_message: str = payload.get("message", "")
                model: str = payload.get("model", "claude-sonnet-4-6")
                app_id: str | None = payload.get("appId")
                provider_id: str = payload.get("providerId", "")
                history: list = payload.get("history", [])
                system_prompt: str = payload.get("systemPrompt", DEFAULT_SYSTEM_PROMPT)
                api_key: str = payload.get("apiKey", "")
                api_base: str | None = payload.get("apiBase") or None
                enable_memory: bool = payload.get("enableMemory", True)
                user_id: str = payload.get("userId", DEFAULT_USER_ID)
                compat_type: str = payload.get("compatType", "openai")
                active_agent = normalize_active_agent(payload.get("activeAgent"))
                memory_user_id = memory_user_id_for_agent(user_id, active_agent)
                traffic_recorded = False

                if not api_key:
                    await websocket.send_json(
                        {
                            "type": "agent_error",
                            "requestId": request_id,
                            "payload": {"error": "未配置 API Key，请先在设置中添加对应模型的 Key。"},
                        }
                    )
                    continue

                embedding_cfg: dict | None = payload.get("embeddingConfig")
                llm_api_key: str = payload.get("llmApiKey") or api_key
                llm_api_base: str | None = payload.get("llmApiBase") or None

                from app.core.memory import ensure_memory_manager

                memory_mgr = None
                if enable_memory:
                    memory_mgr = await ensure_memory_manager(
                        llm_model=model,
                        llm_api_key=llm_api_key,
                        llm_api_base=llm_api_base,
                        embedding_config=embedding_cfg,
                    )

                registry = get_app_registry()
                with registry.apply_user_skill_env():
                    async with AsyncSessionLocal() as db:
                        effective_system, skill_info = await build_skill_augmented_system_prompt(
                            db,
                            system_prompt,
                            user_message,
                            conversation_id=conv_id,
                            requested_app_id=app_id,
                            )

                    handoff_context = build_handoff_context(
                        history,
                        active_agent=active_agent,
                    )
                    if (
                        handoff_context.dropped_tool_calls
                        or handoff_context.dropped_tool_results
                        or handoff_context.dropped_subagent_messages
                    ):
                        await websocket.send_json(
                            {
                                "type": "status",
                                "requestId": request_id,
                                "payload": {
                                    "status": "handoff_context",
                                    "activeAgent": handoff_context.active_agent,
                                    "droppedToolCalls": handoff_context.dropped_tool_calls,
                                    "droppedToolResults": handoff_context.dropped_tool_results,
                                    "droppedSubagentMessages": handoff_context.dropped_subagent_messages,
                                },
                            }
                        )

                    if enable_memory and memory_mgr:
                        memories = await memory_mgr.search(
                            query=user_message,
                            user_id=memory_user_id,
                            limit=5,
                        )
                        relevant = [
                            item
                            for item in memories
                            if isinstance(item, dict)
                            and item.get("memory")
                            and (item.get("score") or 0) >= 0.45
                        ]
                        if relevant:
                            facts = "\n".join(f"- {item['memory']}" for item in relevant)
                            effective_system = (
                                f"{effective_system}\n\n"
                                f"## 关于用户的已知信息（来自记忆）\n{facts}"
                            )
                            await websocket.send_json(
                                {
                                    "type": "status",
                                    "requestId": request_id,
                                    "payload": {"status": "recalled", "count": len(relevant)},
                                }
                            )

                    full_response = ""
                    reasoning_response = ""
                    tool_calls: list[dict] = []
                    tool_results: list[dict] = []
                    status_events: list[dict] = []

                    _settings = get_settings()
                    _confirm_tools = (
                        frozenset(_settings.confirm_required_tools)
                        if _settings.confirm_required_tools
                        else None
                    )
                    _confirm_cb = (
                        _make_confirm_callback(websocket, request_id)
                        if _confirm_tools
                        else None
                    )

                    input_messages = [
                        *handoff_context.messages,
                        {"role": "user", "content": user_message},
                    ]
                    skill_info = {
                        **(skill_info or {}),
                        "active_agent": handoff_context.active_agent,
                    }

                    async for event_type, event_payload in agent_loop(
                        model=model,
                        messages=input_messages,
                        api_key=api_key,
                        provider_id=provider_id,
                        compat_type=compat_type,
                        system_prompt=effective_system,
                        api_base=api_base,
                        skill_context=skill_info,
                        request_id=request_id,
                        confirm_callback=_confirm_cb,
                        confirm_tools=_confirm_tools,
                    ):
                        if event_type == "token":
                            full_response += event_payload
                            await _send_token(websocket, request_id, event_payload)
                        elif event_type == "reasoning_token":
                            reasoning_response += event_payload
                            await _send_token(
                                websocket,
                                request_id,
                                event_payload,
                                event_type="reasoning_token",
                            )
                        elif event_type == "tool_call":
                            tool_calls.append(event_payload)
                            await websocket.send_json(
                                {
                                    "type": "tool_call",
                                    "requestId": request_id,
                                    "payload": event_payload,
                                }
                            )
                        elif event_type == "tool_result":
                            tool_results.append(event_payload)
                            await websocket.send_json(
                                {
                                    "type": "tool_result",
                                    "requestId": request_id,
                                    "payload": event_payload,
                                }
                            )
                        elif event_type == "status":
                            if isinstance(event_payload, dict):
                                status_events.append(event_payload)
                            await websocket.send_json(
                                {
                                    "type": "status",
                                    "requestId": request_id,
                                    "payload": event_payload,
                                }
                            )
                        elif event_type == "subagent_token":
                            await websocket.send_json(
                                {
                                    "type": "subagent_token",
                                    "requestId": request_id,
                                    "payload": event_payload,
                                }
                            )
                        elif event_type == "subagent_result":
                            await websocket.send_json(
                                {
                                    "type": "subagent_result",
                                    "requestId": request_id,
                                    "payload": event_payload,
                                }
                            )

                title = None
                if conv_id:
                    title = await _save_messages(
                        conv_id,
                        user_message,
                        full_response,
                        reasoning_response,
                        tool_calls,
                        tool_results,
                    )

                usage_estimate = estimate_agent_usage(
                    model=model,
                    input_messages=input_messages,
                    output_text=full_response,
                    reasoning_text=reasoning_response,
                )
                await websocket.send_json(
                    {
                        "type": "status",
                        "requestId": request_id,
                        "payload": {"status": "usage_estimate", **usage_estimate},
                    }
                )

                await websocket.send_json(
                    {
                        "type": "agent_done",
                        "requestId": request_id,
                        "payload": {
                            "content": full_response,
                            "title": title or "",
                            "usageEstimate": usage_estimate,
                        },
                    }
                )

                get_agent_traffic_metrics_store().record(
                    build_agent_traffic_record(
                        request_id=request_id,
                        conversation_id=conv_id,
                        app_id=app_id,
                        provider_id=provider_id,
                        model=model,
                        user_message=user_message,
                        response_text=full_response,
                        tool_calls=tool_calls,
                        tool_results=tool_results,
                        status_events=status_events,
                        succeeded=True,
                    )
                )
                traffic_recorded = True

                if enable_memory and memory_mgr and full_response:
                    await memory_mgr.add_async(
                        user_id=memory_user_id,
                        messages=[
                            {"role": "user", "content": user_message},
                            {"role": "assistant", "content": full_response},
                        ],
                    )

            except Exception as exc:
                print(f"[WebSocket agent_invoke error] {type(exc).__name__}: {exc}")
                try:
                    if not bool(locals().get("traffic_recorded")):
                        get_agent_traffic_metrics_store().record(
                            build_agent_traffic_record(
                                request_id=request_id,
                                conversation_id=str(locals().get("conv_id") or ""),
                                app_id=locals().get("app_id"),
                                provider_id=str(locals().get("provider_id") or ""),
                                model=str(locals().get("model") or ""),
                                user_message=str(locals().get("user_message") or ""),
                                response_text=str(locals().get("full_response") or ""),
                                tool_calls=locals().get("tool_calls") or [],
                                tool_results=locals().get("tool_results") or [],
                                status_events=locals().get("status_events") or [],
                                succeeded=False,
                                error=f"{type(exc).__name__}: {exc}",
                            )
                        )
                except Exception:
                    pass
                await websocket.send_json(
                    {
                        "type": "agent_error",
                        "requestId": request_id,
                        "payload": {"error": user_facing_error_message(exc)},
                    }
                )

    except WebSocketDisconnect:
        pass
    except Exception:
        pass
