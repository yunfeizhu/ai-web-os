"""Shared types for external chat channels."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

ChannelChatType = Literal["private", "group"]


@dataclass(slots=True)
class ChannelInboundMessage:
    channel: str
    account_id: str
    chat_type: ChannelChatType
    external_chat_id: str
    external_user_id: str
    external_message_id: str
    text: str
    raw_payload: dict[str, Any] = field(default_factory=dict)
    mention_bot: bool = False


@dataclass(slots=True)
class ChannelOutboundMessage:
    channel: str
    account_id: str
    chat_type: ChannelChatType
    external_chat_id: str
    external_user_id: str
    text: str
    reply_to_message_id: str | None = None


@dataclass(slots=True)
class ChannelBinding:
    id: str
    channel: str
    account_id: str
    chat_type: ChannelChatType
    external_chat_id: str
    external_user_id: str
    conversation_id: str
    user_id: str
    app_id: str
    model: str
    provider_id: str
    enabled: bool = True
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class ChannelBindingDefaults:
    user_id: str
    app_id: str
    model: str
    provider_id: str
