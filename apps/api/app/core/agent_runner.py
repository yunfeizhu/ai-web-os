"""Reusable Agent turn runner for non-websocket entrypoints."""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.agent_handoff import build_handoff_context, memory_user_id_for_agent
from app.core.agent_usage import estimate_agent_usage
from app.core.app_registry import get_app_registry
from app.core.database import AsyncSessionLocal
from app.core.llm_provider import agent_loop
from app.core.memory import ensure_memory_manager
from app.core.skill_context import build_skill_augmented_system_prompt
from app.models.conversation import Conversation, Message


@dataclass(slots=True)
class AgentTurnRequest:
    conversation_id: str
    user_message: str
    model: str
    api_key: str
    provider_id: str = ""
    compat_type: str = "openai"
    system_prompt: str = "你是 AI-Web OS 的智能助手，请简洁、友好地回答用户问题。"
    api_base: str | None = None
    app_id: str | None = "ai-chat"
    user_id: str = "default"
    enable_memory: bool = True
    history: list[dict[str, Any]] | None = None
    active_agent: str = "lead"


@dataclass(slots=True)
class AgentTurnResult:
    conversation_id: str
    content: str
    reasoning_content: str = ""
    tool_calls: list[dict[str, Any]] = field(default_factory=list)
    tool_results: list[dict[str, Any]] = field(default_factory=list)
    title: str = ""
    usage_estimate: dict[str, Any] = field(default_factory=dict)


AgentLoopFunc = Callable[..., Any]
SaveTurnFunc = Callable[..., Awaitable[str | None]]
BuildSkillPromptFunc = Callable[..., Awaitable[tuple[str, dict[str, Any] | None]]]
MemoryManagerFactory = Callable[..., Awaitable[Any]]


class AgentTurnRunner:
    """Run one internal Agent turn and return a channel-safe final answer."""

    def __init__(
        self,
        *,
        session_factory: async_sessionmaker[AsyncSession] = AsyncSessionLocal,
        agent_loop_func: AgentLoopFunc = agent_loop,
        save_turn_func: SaveTurnFunc | None = None,
        build_skill_prompt_func: BuildSkillPromptFunc | None = None,
        memory_manager_factory: MemoryManagerFactory | None = ensure_memory_manager,
    ) -> None:
        self._session_factory = session_factory
        self._agent_loop = agent_loop_func
        self._save_turn = save_turn_func or self._save_turn_to_db
        self._build_skill_prompt = build_skill_prompt_func or self._build_skill_prompt_default
        self._memory_manager_factory = memory_manager_factory

    async def run(self, request: AgentTurnRequest) -> AgentTurnResult:
        history = (
            request.history
            if request.history is not None
            else await self._load_history(request.conversation_id)
        )
        handoff_context = build_handoff_context(history, active_agent=request.active_agent)
        memory_user_id = memory_user_id_for_agent(request.user_id, handoff_context.active_agent)

        registry = get_app_registry()
        memory_mgr = None
        effective_system = request.system_prompt
        skill_info: dict[str, Any] | None = None

        with registry.apply_user_skill_env():
            if request.enable_memory and self._memory_manager_factory is not None:
                memory_mgr = await self._memory_manager_factory(
                    llm_model=request.model,
                    llm_api_key=request.api_key,
                    llm_api_base=request.api_base,
                    embedding_config=None,
                )

            async with self._session_factory() as db:
                effective_system, skill_info = await self._build_skill_prompt(
                    db=db,
                    system_prompt=request.system_prompt,
                    user_message=request.user_message,
                    conversation_id=request.conversation_id,
                    requested_app_id=request.app_id,
                )

            if request.enable_memory and memory_mgr:
                memory_context = await memory_mgr.recall_context(
                    query=request.user_message,
                    user_id=memory_user_id,
                    limit=5,
                )
                prompt_context = str(memory_context.get("prompt") or "").strip()
                if prompt_context:
                    effective_system = f"{effective_system}\n\n{prompt_context}"

            full_response = ""
            reasoning_response = ""
            tool_calls: list[dict[str, Any]] = []
            tool_results: list[dict[str, Any]] = []
            input_messages = [
                *handoff_context.messages,
                {"role": "user", "content": request.user_message},
            ]
            skill_info = {
                **(skill_info or {}),
                "active_agent": handoff_context.active_agent,
            }

            async for event_type, payload in self._agent_loop(
                model=request.model,
                messages=input_messages,
                api_key=request.api_key,
                provider_id=request.provider_id,
                compat_type=request.compat_type,
                system_prompt=effective_system,
                api_base=request.api_base,
                skill_context=skill_info,
                request_id=request.conversation_id,
            ):
                if event_type == "token":
                    full_response += str(payload)
                elif event_type == "reasoning_token":
                    reasoning_response += str(payload)
                elif event_type == "tool_call":
                    tool_calls.append(payload)
                elif event_type == "tool_result":
                    tool_results.append(payload)

        title = await self._save_turn(
            conv_id=request.conversation_id,
            user_content=request.user_message,
            assistant_content=full_response,
            reasoning_content=reasoning_response,
            tool_calls=tool_calls,
            tool_results=tool_results,
        )

        if request.enable_memory and memory_mgr and full_response:
            await memory_mgr.add_async(
                user_id=memory_user_id,
                messages=[
                    *history[-6:],
                    {"role": "user", "content": request.user_message},
                    {"role": "assistant", "content": full_response},
                ],
            )

        usage_estimate = estimate_agent_usage(
            model=request.model,
            input_messages=[
                *handoff_context.messages,
                {"role": "user", "content": request.user_message},
            ],
            output_text=full_response,
            reasoning_text=reasoning_response,
        )
        return AgentTurnResult(
            conversation_id=request.conversation_id,
            content=full_response,
            reasoning_content=reasoning_response,
            tool_calls=tool_calls,
            tool_results=tool_results,
            title=title or "",
            usage_estimate=usage_estimate,
        )

    async def _load_history(self, conversation_id: str) -> list[dict[str, Any]]:
        async with self._session_factory() as db:
            result = await db.execute(
                select(Message)
                .where(Message.conversation_id == conversation_id)
                .order_by(Message.created_at)
            )
            messages = result.scalars().all()

        history: list[dict[str, Any]] = []
        for message in messages:
            if message.role == "assistant":
                item: dict[str, Any] = {
                    "role": "assistant",
                    "content": message.content,
                }
                if message.tool_calls:
                    item["tool_calls"] = message.tool_calls
                history.append(item)
            elif message.role == "tool":
                history.append(
                    {
                        "role": "tool",
                        "tool_call_id": message.tool_call_id,
                        "content": message.content,
                    }
                )
            else:
                history.append({"role": message.role, "content": message.content})
        return history

    async def _save_turn_to_db(
        self,
        *,
        conv_id: str,
        user_content: str,
        assistant_content: str,
        reasoning_content: str,
        tool_calls: list[dict[str, Any]],
        tool_results: list[dict[str, Any]],
    ) -> str | None:
        async with self._session_factory() as db:
            result = await db.execute(select(Conversation).where(Conversation.id == conv_id))
            conversation = result.scalar_one_or_none()
            if conversation is None:
                return None

            count_result = await db.execute(
                select(func.count()).select_from(Message).where(Message.conversation_id == conv_id)
            )
            if count_result.scalar() == 0 and conversation.title == "新对话":
                conversation.title = user_content[:24] + ("..." if len(user_content) > 24 else "")

            db.add(
                Message(
                    id=str(uuid.uuid4()),
                    conversation_id=conv_id,
                    role="user",
                    content=user_content,
                )
            )
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
                        content=str(tool_result.get("result") or ""),
                        tool_call_id=str(tool_result.get("id") or ""),
                    )
                )
            await db.commit()
            return conversation.title

    @staticmethod
    async def _build_skill_prompt_default(
        *,
        db: AsyncSession,
        system_prompt: str,
        user_message: str,
        conversation_id: str,
        requested_app_id: str | None,
    ) -> tuple[str, dict[str, Any] | None]:
        return await build_skill_augmented_system_prompt(
            db,
            system_prompt,
            user_message,
            conversation_id=conversation_id,
            requested_app_id=requested_app_id,
        )
