from app.core.agent_traffic_metrics import (
    AgentTrafficMetricsStore,
    build_agent_traffic_record,
)


def test_agent_traffic_metrics_summarize_real_requests():
    store = AgentTrafficMetricsStore(max_records=10)

    store.record(
        build_agent_traffic_record(
            request_id="req-1",
            conversation_id="conv-1",
            app_id="ai-chat",
            provider_id="moonshot",
            model="kimi-k2.6",
            user_message="查一下股票并总结",
            response_text="这是总结。",
            tool_calls=[
                {"id": "call-search", "name": "mcp_search"},
                {"id": "call-read", "name": "read_file"},
            ],
            tool_results=[
                {"id": "call-search", "name": "mcp_search", "error": False},
                {"id": "call-read", "name": "read_file", "error": True},
            ],
            status_events=[
                {"status": "graph_node", "node": "validate_result", "error": True},
                {"status": "plan_preview"},
            ],
            succeeded=True,
        )
    )
    store.record(
        build_agent_traffic_record(
            request_id="req-2",
            conversation_id="conv-2",
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

    summary = store.summary()

    assert summary["totalRequests"] == 2
    assert summary["completedTasks"] == 2
    assert summary["taskCompletionRate"] == 1
    assert summary["toolCalls"] == 2
    assert summary["successfulToolCalls"] == 1
    assert summary["failedToolCalls"] == 1
    assert summary["toolSuccessRate"] == 0.5
    assert summary["routeChecks"] == 2
    assert summary["correctRoutes"] == 1
    assert summary["routeAccuracy"] == 0.5
    assert summary["routeAccuracySource"] == "policy_validation_proxy"
    assert summary["plannedRequests"] == 1
    assert summary["byProvider"]["moonshot"]["totalRequests"] == 2
    assert summary["byModel"]["kimi-k2.6"]["toolSuccessRate"] == 0.5


def test_agent_traffic_metrics_records_failed_requests():
    store = AgentTrafficMetricsStore(max_records=10)

    store.record(
        build_agent_traffic_record(
            request_id="req-failed",
            conversation_id="conv-1",
            app_id="ai-chat",
            provider_id="openai",
            model="gpt-4o",
            user_message="执行一下",
            response_text="",
            tool_calls=[{"id": "call-python", "name": "python_exec"}],
            tool_results=[],
            status_events=[
                {
                    "status": "graph_node",
                    "node": "policy_guard",
                    "decision": "rejected",
                }
            ],
            succeeded=False,
            error="boom",
        )
    )

    summary = store.summary()

    assert summary["totalRequests"] == 1
    assert summary["completedTasks"] == 0
    assert summary["taskCompletionRate"] == 0
    assert summary["routeChecks"] == 1
    assert summary["correctRoutes"] == 0
    assert summary["routeAccuracy"] == 0
    assert summary["recent"][0]["error"] == "boom"
