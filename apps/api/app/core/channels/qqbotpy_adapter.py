"""qq-botpy adapter for the QQ official Bot channel."""

from __future__ import annotations

import asyncio
import re
import threading
from collections.abc import Callable
from typing import Any

from app.core.channel_hub import ChannelHub
from app.core.channel_types import ChannelInboundMessage, ChannelOutboundMessage

MENTION_RE = re.compile(r"<@!?\d+>\s*")


class QQBotpyAdapter:
    """Normalize qq-botpy callbacks into generic channel messages."""

    def __init__(
        self,
        *,
        hub: ChannelHub,
        account_id: str = "default",
        bot_user_id: str = "",
        dispatch_loop: asyncio.AbstractEventLoop | None = None,
    ) -> None:
        self._hub = hub
        self._account_id = account_id
        self._bot_user_id = bot_user_id
        self._dispatch_loop = dispatch_loop

    async def on_c2c_message_create(self, message: Any) -> None:
        text = _message_content(message).strip()
        if not text:
            return
        user_openid = _author_attr(message, "user_openid")
        inbound = ChannelInboundMessage(
            channel="qqbot",
            account_id=self._account_id,
            chat_type="private",
            external_chat_id=user_openid,
            external_user_id=user_openid,
            external_message_id=str(getattr(message, "id", "")),
            text=text,
            mention_bot=True,
            raw_payload=_safe_payload(message),
        )
        outbound_messages = await self._handle_inbound(inbound)
        for outbound in outbound_messages:
            await self._send_c2c(message, outbound)

    async def on_group_at_message_create(self, message: Any) -> None:
        raw_text = _message_content(message)
        text = _strip_mentions(raw_text).strip()
        if not text:
            return
        inbound = ChannelInboundMessage(
            channel="qqbot",
            account_id=self._account_id,
            chat_type="group",
            external_chat_id=str(getattr(message, "group_openid", "")),
            external_user_id=_author_attr(message, "member_openid")
            or _author_attr(message, "user_openid"),
            external_message_id=str(getattr(message, "id", "")),
            text=text,
            mention_bot=True,
            raw_payload=_safe_payload(message),
        )
        outbound_messages = await self._handle_inbound(inbound)
        for outbound in outbound_messages:
            await self._send_group(message, outbound)

    async def _send_c2c(self, message: Any, outbound: ChannelOutboundMessage) -> None:
        await message._api.post_c2c_message(
            openid=outbound.external_chat_id,
            msg_type=0,
            msg_id=outbound.reply_to_message_id,
            content=outbound.text,
        )

    async def _send_group(self, message: Any, outbound: ChannelOutboundMessage) -> None:
        await message._api.post_group_message(
            group_openid=outbound.external_chat_id,
            msg_type=0,
            msg_id=outbound.reply_to_message_id,
            content=outbound.text,
        )

    async def _handle_inbound(
        self,
        inbound: ChannelInboundMessage,
    ) -> list[ChannelOutboundMessage]:
        if self._dispatch_loop is None:
            return await self._hub.handle_inbound(inbound)

        current_loop = asyncio.get_running_loop()
        if current_loop is self._dispatch_loop:
            return await self._hub.handle_inbound(inbound)

        future = asyncio.run_coroutine_threadsafe(
            self._hub.handle_inbound(inbound),
            self._dispatch_loop,
        )
        return await asyncio.wrap_future(future)


class QQBotpyRuntime:
    """Own the blocking qq-botpy client in a background thread."""

    def __init__(
        self,
        *,
        app_id: str,
        app_secret: str,
        adapter: QQBotpyAdapter,
        bot_user_id: str = "",
        on_error: Callable[[BaseException], None] | None = None,
    ) -> None:
        self._app_id = app_id
        self._app_secret = app_secret
        self._adapter = adapter
        self._bot_user_id = bot_user_id
        self._on_error = on_error
        self._thread: threading.Thread | None = None
        self._client: Any = None

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._thread = threading.Thread(
            target=self._run,
            name="qqbotpy-runtime",
            daemon=True,
        )
        self._thread.start()

    async def stop(self) -> None:
        client = self._client
        close = getattr(client, "close", None)
        if close:
            result = close()
            if asyncio.iscoroutine(result):
                await result

    def _run(self) -> None:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            try:
                import botpy
            except ImportError as exc:
                print("[QQBot] qq-botpy is not installed. Run: uv add qq-botpy")
                raise exc

            adapter = self._adapter

            class Client(botpy.Client):
                async def on_c2c_message_create(self, message):
                    await adapter.on_c2c_message_create(message)

                async def on_group_at_message_create(self, message):
                    await adapter.on_group_at_message_create(message)

            intents = botpy.Intents(public_messages=True)
            self._client = Client(intents=intents)
            self._client.run(appid=self._app_id, secret=self._app_secret)
        except BaseException as exc:
            if self._on_error is not None:
                self._on_error(exc)
            print(f"[QQBot] qq-botpy runtime failed: {exc}")
            raise exc
        finally:
            asyncio.set_event_loop(None)
            loop.close()


def _message_content(message: Any) -> str:
    return str(getattr(message, "content", "") or "")


def _strip_mentions(text: str) -> str:
    return MENTION_RE.sub("", text or "")


def _author_attr(message: Any, name: str) -> str:
    author = getattr(message, "author", None)
    return str(getattr(author, name, "") or "")


def _safe_payload(message: Any) -> dict[str, Any]:
    return {
        "id": str(getattr(message, "id", "") or ""),
        "content": _message_content(message),
    }
