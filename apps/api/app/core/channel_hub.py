"""Generic external-channel orchestration."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field

from app.core.agent_runner import AgentTurnRequest, AgentTurnRunner
from app.core.channel_store import (
    ChannelStore,
    channel_dedupe_key,
    channel_peer_key,
)
from app.core.channel_types import (
    ChannelBindingDefaults,
    ChannelInboundMessage,
    ChannelOutboundMessage,
)


@dataclass(frozen=True, slots=True)
class ChannelHubConfig:
    default_user_id: str = "default"
    default_app_id: str = "ai-chat"
    default_model: str = "kimi-k2.5"
    default_provider_id: str = "moonshot"
    default_compat_type: str = "openai"
    default_system_prompt: str = "你是 AI-Web OS 的智能助手，请简洁、友好地回答用户问题。"
    api_key: str = ""
    api_base: str | None = None
    enable_memory: bool = True
    allow_private: bool = True
    allow_group: bool = False
    allow_unlisted: bool = False
    allowed_users: set[str] = field(default_factory=set)
    allowed_groups: set[str] = field(default_factory=set)


class ChannelHub:
    """Bridge normalized external messages into the internal Agent runtime."""

    def __init__(
        self,
        *,
        store: ChannelStore,
        runner: AgentTurnRunner,
        config: ChannelHubConfig,
    ) -> None:
        self._store = store
        self._runner = runner
        self._config = config
        self._locks: dict[str, asyncio.Lock] = {}
        self._locks_guard = asyncio.Lock()

    async def handle_inbound(
        self,
        message: ChannelInboundMessage,
    ) -> list[ChannelOutboundMessage]:
        if not message.text.strip():
            return []
        if not self._is_allowed(message):
            return []

        dedupe_key = channel_dedupe_key(message)
        if not await self._store.claim_inbound(message, dedupe_key):
            return []

        async with await self._lock_for(channel_peer_key(message)):
            command_reply = await self._handle_command(message)
            if command_reply is not None:
                return [command_reply]

            binding = await self._store.get_or_create_binding(
                message,
                ChannelBindingDefaults(
                    user_id=self._config.default_user_id,
                    app_id=self._config.default_app_id,
                    model=self._config.default_model,
                    provider_id=self._config.default_provider_id,
                ),
            )
            if not self._config.api_key:
                return [
                    self._outbound(
                        message,
                        "QQ Bot 尚未配置模型 API Key，请在环境变量里设置 QQBOT_AGENT_API_KEY。",
                    )
                ]

            result = await self._runner.run(
                AgentTurnRequest(
                    conversation_id=binding.conversation_id,
                    user_message=message.text.strip(),
                    model=binding.model or self._config.default_model,
                    provider_id=binding.provider_id or self._config.default_provider_id,
                    compat_type=self._config.default_compat_type,
                    system_prompt=self._config.default_system_prompt,
                    api_key=self._config.api_key,
                    api_base=self._config.api_base,
                    app_id=binding.app_id or self._config.default_app_id,
                    user_id=binding.user_id or self._config.default_user_id,
                    enable_memory=self._config.enable_memory,
                )
            )
            outbound = self._outbound(message, result.content.strip() or "我暂时没有生成有效回复。")
            await self._store.record_outbound(message, outbound)
            return [outbound]

    async def _handle_command(
        self,
        message: ChannelInboundMessage,
    ) -> ChannelOutboundMessage | None:
        command = message.text.strip().lower()
        if command in {"/new", "/reset"}:
            await self._store.reset_binding(message)
            return self._outbound(message, "已开启新的对话。")
        if command == "/help":
            return self._outbound(message, "可用命令：/new 开启新对话，/status 查看连接状态。")
        if command == "/status":
            return self._outbound(message, "QQ Bot 已连接 AI-Web OS。")
        return None

    def _is_allowed(self, message: ChannelInboundMessage) -> bool:
        if message.chat_type == "group":
            if not self._config.allow_group or not message.mention_bot:
                return False
            if self._config.allowed_groups:
                return message.external_chat_id in self._config.allowed_groups
            return self._config.allow_unlisted

        if not self._config.allow_private:
            return False
        if self._config.allowed_users:
            return message.external_user_id in self._config.allowed_users
        return self._config.allow_unlisted

    async def _lock_for(self, key: str) -> asyncio.Lock:
        async with self._locks_guard:
            lock = self._locks.get(key)
            if lock is None:
                lock = asyncio.Lock()
                self._locks[key] = lock
            return lock

    @staticmethod
    def _outbound(message: ChannelInboundMessage, text: str) -> ChannelOutboundMessage:
        return ChannelOutboundMessage(
            channel=message.channel,
            account_id=message.account_id,
            chat_type=message.chat_type,
            external_chat_id=message.external_chat_id,
            external_user_id=message.external_user_id,
            reply_to_message_id=message.external_message_id,
            text=text,
        )
