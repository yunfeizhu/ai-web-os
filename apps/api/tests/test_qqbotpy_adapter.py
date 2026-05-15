import asyncio
import sys
import threading
import types

from app.core.channel_types import ChannelOutboundMessage
from app.core.channels.qqbotpy_adapter import QQBotpyAdapter, QQBotpyRuntime


class FakeHub:
    def __init__(self) -> None:
        self.inbound = []

    async def handle_inbound(self, message):
        self.inbound.append(message)
        return [
            ChannelOutboundMessage(
                channel=message.channel,
                account_id=message.account_id,
                chat_type=message.chat_type,
                external_chat_id=message.external_chat_id,
                external_user_id=message.external_user_id,
                reply_to_message_id=message.external_message_id,
                text=f"收到: {message.text}",
            )
        ]


class FakeAPI:
    def __init__(self) -> None:
        self.c2c_replies = []
        self.group_replies = []

    async def post_c2c_message(self, **kwargs):
        self.c2c_replies.append(kwargs)

    async def post_group_message(self, **kwargs):
        self.group_replies.append(kwargs)


class FakeAuthor:
    user_openid = "user-openid"
    member_openid = "member-openid"


class FakeC2CMessage:
    id = "c2c-msg-1"
    content = "你好"
    author = FakeAuthor()

    def __init__(self) -> None:
        self._api = FakeAPI()


class FakeGroupMessage:
    id = "group-msg-1"
    content = "<@!123456>  你好群聊"
    group_openid = "group-openid"
    author = FakeAuthor()

    def __init__(self) -> None:
        self._api = FakeAPI()


def test_qqbotpy_adapter_normalizes_c2c_text_and_replies():
    hub = FakeHub()
    adapter = QQBotpyAdapter(hub=hub, account_id="bot-account", bot_user_id="123456")
    message = FakeC2CMessage()

    asyncio.run(adapter.on_c2c_message_create(message))

    inbound = hub.inbound[0]
    assert inbound.channel == "qqbot"
    assert inbound.account_id == "bot-account"
    assert inbound.chat_type == "private"
    assert inbound.external_chat_id == "user-openid"
    assert inbound.external_user_id == "user-openid"
    assert inbound.external_message_id == "c2c-msg-1"
    assert inbound.text == "你好"
    assert message._api.c2c_replies == [
        {
            "openid": "user-openid",
            "msg_type": 0,
            "msg_id": "c2c-msg-1",
            "content": "收到: 你好",
        }
    ]


def test_qqbotpy_adapter_normalizes_group_at_text_and_replies():
    hub = FakeHub()
    adapter = QQBotpyAdapter(hub=hub, account_id="bot-account", bot_user_id="123456")
    message = FakeGroupMessage()

    asyncio.run(adapter.on_group_at_message_create(message))

    inbound = hub.inbound[0]
    assert inbound.chat_type == "group"
    assert inbound.external_chat_id == "group-openid"
    assert inbound.external_user_id == "member-openid"
    assert inbound.text == "你好群聊"
    assert inbound.mention_bot is True
    assert message._api.group_replies == [
        {
            "group_openid": "group-openid",
            "msg_type": 0,
            "msg_id": "group-msg-1",
            "content": "收到: 你好群聊",
        }
    ]


def test_qqbotpy_runtime_sets_event_loop_before_creating_client(monkeypatch):
    created_loops = []
    run_calls = []

    class FakeIntents:
        def __init__(self, **kwargs) -> None:
            self.kwargs = kwargs

    class FakeClient:
        def __init__(self, *, intents) -> None:
            created_loops.append(asyncio.get_event_loop())
            self.intents = intents

        def run(self, *, appid: str, secret: str) -> None:
            run_calls.append({"appid": appid, "secret": secret})

    monkeypatch.setitem(
        sys.modules,
        "botpy",
        types.SimpleNamespace(Client=FakeClient, Intents=FakeIntents),
    )

    runtime = QQBotpyRuntime(
        app_id="app-id",
        app_secret="app-secret",
        adapter=QQBotpyAdapter(hub=FakeHub()),
    )
    errors = []

    def run_runtime() -> None:
        try:
            runtime._run()
        except BaseException as exc:  # pragma: no cover - asserted below
            errors.append(exc)

    thread = threading.Thread(target=run_runtime, name="qqbotpy-runtime-test")
    thread.start()
    thread.join(timeout=3)

    assert not thread.is_alive()
    assert errors == []
    assert created_loops
    assert run_calls == [{"appid": "app-id", "secret": "app-secret"}]
