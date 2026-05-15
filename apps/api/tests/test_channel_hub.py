import asyncio

from app.core.channel_hub import ChannelHub, ChannelHubConfig
from app.core.channel_store import InMemoryChannelStore
from app.core.channel_types import ChannelInboundMessage


def _message(
    text: str,
    *,
    message_id: str = "msg-1",
    chat_id: str = "user-openid",
    user_id: str = "user-openid",
    chat_type: str = "private",
    mention_bot: bool = False,
) -> ChannelInboundMessage:
    return ChannelInboundMessage(
        channel="qqbot",
        account_id="default",
        chat_type=chat_type,
        external_chat_id=chat_id,
        external_user_id=user_id,
        external_message_id=message_id,
        text=text,
        mention_bot=mention_bot,
        raw_payload={"id": message_id, "content": text},
    )


class FakeRunner:
    def __init__(self, delay: float = 0) -> None:
        self.delay = delay
        self.requests = []
        self.active = 0
        self.max_active = 0

    async def run(self, request):
        self.active += 1
        self.max_active = max(self.max_active, self.active)
        try:
            if self.delay:
                await asyncio.sleep(self.delay)
            self.requests.append(request)
            return type(
                "Result",
                (),
                {
                    "content": f"回复: {request.user_message}",
                    "conversation_id": request.conversation_id,
                },
            )()
        finally:
            self.active -= 1


def test_channel_hub_deduplicates_external_messages():
    store = InMemoryChannelStore()
    runner = FakeRunner()
    hub = ChannelHub(
        store=store,
        runner=runner,
        config=ChannelHubConfig(allowed_users={"user-openid"}, api_key="test-key"),
    )

    first = asyncio.run(hub.handle_inbound(_message("你好")))
    second = asyncio.run(hub.handle_inbound(_message("你好")))

    assert [item.text for item in first] == ["回复: 你好"]
    assert second == []
    assert len(runner.requests) == 1


def test_channel_hub_ignores_group_messages_without_bot_mention():
    store = InMemoryChannelStore()
    runner = FakeRunner()
    hub = ChannelHub(
        store=store,
        runner=runner,
        config=ChannelHubConfig(allowed_groups={"group-openid"}, api_key="test-key"),
    )

    outbound = asyncio.run(
        hub.handle_inbound(
            _message(
                "普通群消息",
                message_id="group-1",
                chat_id="group-openid",
                user_id="member-openid",
                chat_type="group",
                mention_bot=False,
            )
        )
    )

    assert outbound == []
    assert runner.requests == []


def test_channel_hub_new_command_resets_binding_before_next_turn():
    store = InMemoryChannelStore()
    runner = FakeRunner()
    hub = ChannelHub(
        store=store,
        runner=runner,
        config=ChannelHubConfig(allowed_users={"user-openid"}, api_key="test-key"),
    )

    first = asyncio.run(hub.handle_inbound(_message("第一轮", message_id="msg-1")))
    reset = asyncio.run(hub.handle_inbound(_message("/new", message_id="msg-2")))
    second = asyncio.run(hub.handle_inbound(_message("第二轮", message_id="msg-3")))

    assert first[0].text == "回复: 第一轮"
    assert reset[0].text == "已开启新的对话。"
    assert second[0].text == "回复: 第二轮"
    assert runner.requests[0].conversation_id != runner.requests[1].conversation_id


def test_channel_hub_serializes_turns_per_peer():
    store = InMemoryChannelStore()
    runner = FakeRunner(delay=0.02)
    hub = ChannelHub(
        store=store,
        runner=runner,
        config=ChannelHubConfig(allowed_users={"user-openid"}, api_key="test-key"),
    )

    async def run_two():
        return await asyncio.gather(
            hub.handle_inbound(_message("第一条", message_id="msg-1")),
            hub.handle_inbound(_message("第二条", message_id="msg-2")),
        )

    first, second = asyncio.run(run_two())

    assert first[0].text == "回复: 第一条"
    assert second[0].text == "回复: 第二条"
    assert runner.max_active == 1
