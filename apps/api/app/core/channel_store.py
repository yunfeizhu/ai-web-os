"""Persistence boundary for external chat channels."""

from __future__ import annotations

import uuid
from dataclasses import asdict
from datetime import datetime, timezone
from typing import Protocol

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.channel_types import (
    ChannelBinding,
    ChannelBindingDefaults,
    ChannelInboundMessage,
    ChannelOutboundMessage,
)
from app.core.database import AsyncSessionLocal
from app.models.conversation import Conversation


def channel_peer_key(message: ChannelInboundMessage) -> str:
    return ":".join(
        [
            message.channel,
            message.account_id,
            message.chat_type,
            message.external_chat_id,
        ]
    )


def channel_dedupe_key(message: ChannelInboundMessage) -> str:
    return ":".join(
        [
            message.channel,
            message.account_id,
            message.chat_type,
            message.external_chat_id,
            message.external_message_id,
        ]
    )


class ChannelStore(Protocol):
    async def claim_inbound(self, message: ChannelInboundMessage, dedupe_key: str) -> bool:
        """Return True when this inbound message should be processed."""

    async def get_or_create_binding(
        self,
        message: ChannelInboundMessage,
        defaults: ChannelBindingDefaults,
    ) -> ChannelBinding:
        """Return the internal conversation binding for the external chat."""

    async def reset_binding(self, message: ChannelInboundMessage) -> None:
        """Forget the current binding so the next turn starts a new conversation."""

    async def record_outbound(
        self,
        message: ChannelInboundMessage,
        outbound: ChannelOutboundMessage,
    ) -> None:
        """Persist an outbound reply record."""


class InMemoryChannelStore:
    """Small test/dry-run store that mirrors the SQL store behavior."""

    def __init__(self) -> None:
        self.claimed: set[str] = set()
        self.bindings: dict[str, ChannelBinding] = {}
        self.outbound: list[ChannelOutboundMessage] = []
        self._conversation_seq = 0

    async def claim_inbound(self, message: ChannelInboundMessage, dedupe_key: str) -> bool:
        del message
        if dedupe_key in self.claimed:
            return False
        self.claimed.add(dedupe_key)
        return True

    async def get_or_create_binding(
        self,
        message: ChannelInboundMessage,
        defaults: ChannelBindingDefaults,
    ) -> ChannelBinding:
        key = channel_peer_key(message)
        binding = self.bindings.get(key)
        if binding:
            return binding

        self._conversation_seq += 1
        binding = ChannelBinding(
            id=str(uuid.uuid4()),
            channel=message.channel,
            account_id=message.account_id,
            chat_type=message.chat_type,
            external_chat_id=message.external_chat_id,
            external_user_id=message.external_user_id,
            conversation_id=f"conv-{self._conversation_seq}",
            user_id=defaults.user_id,
            app_id=defaults.app_id,
            model=defaults.model,
            provider_id=defaults.provider_id,
        )
        self.bindings[key] = binding
        return binding

    async def reset_binding(self, message: ChannelInboundMessage) -> None:
        self.bindings.pop(channel_peer_key(message), None)

    async def record_outbound(
        self,
        message: ChannelInboundMessage,
        outbound: ChannelOutboundMessage,
    ) -> None:
        del message
        self.outbound.append(outbound)


def _binding_from_model(row) -> ChannelBinding:
    return ChannelBinding(
        id=row.id,
        channel=row.channel,
        account_id=row.account_id,
        chat_type=row.chat_type,
        external_chat_id=row.external_chat_id,
        external_user_id=row.external_user_id,
        conversation_id=row.conversation_id,
        user_id=row.user_id,
        app_id=row.app_id,
        model=row.model,
        provider_id=row.provider_id,
        enabled=row.enabled,
        metadata=row.metadata_json or {},
    )


class SQLChannelStore:
    """SQL-backed channel store used by real external integrations."""

    def __init__(
        self,
        *,
        session_factory: async_sessionmaker[AsyncSession] = AsyncSessionLocal,
    ) -> None:
        self._session_factory = session_factory

    async def claim_inbound(self, message: ChannelInboundMessage, dedupe_key: str) -> bool:
        from app.models.channel import ChannelMessage

        async with self._session_factory() as db:
            result = await db.execute(
                select(ChannelMessage).where(ChannelMessage.dedupe_key == dedupe_key)
            )
            if result.scalar_one_or_none() is not None:
                return False

            db.add(
                ChannelMessage(
                    id=str(uuid.uuid4()),
                    channel=message.channel,
                    account_id=message.account_id,
                    direction="inbound",
                    external_message_id=message.external_message_id,
                    dedupe_key=dedupe_key,
                    status="received",
                    raw_payload=message.raw_payload,
                    normalized_payload=asdict(message),
                )
            )
            await db.commit()
            return True

    async def get_or_create_binding(
        self,
        message: ChannelInboundMessage,
        defaults: ChannelBindingDefaults,
    ) -> ChannelBinding:
        from app.models.channel import ChannelBinding as ChannelBindingModel

        async with self._session_factory() as db:
            result = await db.execute(
                select(ChannelBindingModel).where(
                    ChannelBindingModel.channel == message.channel,
                    ChannelBindingModel.account_id == message.account_id,
                    ChannelBindingModel.chat_type == message.chat_type,
                    ChannelBindingModel.external_chat_id == message.external_chat_id,
                    ChannelBindingModel.enabled.is_(True),
                )
            )
            row = result.scalar_one_or_none()
            if row is not None:
                return _binding_from_model(row)

            conversation = Conversation(
                id=str(uuid.uuid4()),
                user_id=defaults.user_id,
                title=_conversation_title(message),
                model=defaults.model,
                app_id=defaults.app_id,
            )
            db.add(conversation)
            row = ChannelBindingModel(
                id=str(uuid.uuid4()),
                channel=message.channel,
                account_id=message.account_id,
                chat_type=message.chat_type,
                external_chat_id=message.external_chat_id,
                external_user_id=message.external_user_id,
                conversation_id=conversation.id,
                user_id=defaults.user_id,
                app_id=defaults.app_id,
                model=defaults.model,
                provider_id=defaults.provider_id,
                enabled=True,
                metadata_json={},
            )
            db.add(row)
            await db.commit()
            return _binding_from_model(row)

    async def reset_binding(self, message: ChannelInboundMessage) -> None:
        from app.models.channel import ChannelBinding as ChannelBindingModel

        async with self._session_factory() as db:
            result = await db.execute(
                select(ChannelBindingModel).where(
                    ChannelBindingModel.channel == message.channel,
                    ChannelBindingModel.account_id == message.account_id,
                    ChannelBindingModel.chat_type == message.chat_type,
                    ChannelBindingModel.external_chat_id == message.external_chat_id,
                    ChannelBindingModel.enabled.is_(True),
                )
            )
            row = result.scalar_one_or_none()
            if row is not None:
                row.enabled = False
                row.updated_at = datetime.now(timezone.utc)
            await db.commit()

    async def record_outbound(
        self,
        message: ChannelInboundMessage,
        outbound: ChannelOutboundMessage,
    ) -> None:
        from app.models.channel import ChannelMessage

        async with self._session_factory() as db:
            db.add(
                ChannelMessage(
                    id=str(uuid.uuid4()),
                    channel=message.channel,
                    account_id=message.account_id,
                    direction="outbound",
                    external_message_id=message.external_message_id,
                    dedupe_key=f"{channel_dedupe_key(message)}:reply",
                    status="sent",
                    raw_payload={},
                    normalized_payload=asdict(outbound),
                )
            )
            await db.commit()


def _conversation_title(message: ChannelInboundMessage) -> str:
    prefix = "QQ群聊" if message.chat_type == "group" else "QQ私聊"
    text = message.text.strip()
    if not text:
        return prefix
    return f"{prefix}: {text[:20]}"
