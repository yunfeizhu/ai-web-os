import asyncio

from app.api.v1.agents import get_agent_traffic_metrics
from app.core.agent_traffic_metrics import (
    build_agent_traffic_record,
    get_agent_traffic_metrics_store,
)


def test_get_agent_traffic_metrics_returns_recorded_summary():
    store = get_agent_traffic_metrics_store()
    store.clear()
    store.record(
        build_agent_traffic_record(
            request_id="req-api",
            conversation_id="conv-api",
            app_id="ai-chat",
            provider_id="moonshot",
            model="kimi-k2.6",
            user_message="你好",
            response_text="你好。",
            tool_calls=[],
            tool_results=[],
            status_events=[],
            succeeded=True,
        )
    )

    summary = asyncio.run(get_agent_traffic_metrics(recent_limit=5))

    assert summary["totalRequests"] == 1
    assert summary["taskCompletionRate"] == 1
    assert summary["recent"][0]["requestId"] == "req-api"

    store.clear()
