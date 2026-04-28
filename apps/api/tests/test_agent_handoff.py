from app.core.agent_handoff import (
    build_handoff_context,
    memory_user_id_for_agent,
)


def test_build_handoff_context_preserves_only_paired_lead_tool_messages():
    context = build_handoff_context(
        [
            {"role": "user", "content": "查一下文件"},
            {
                "role": "assistant",
                "content": None,
                "tool_calls": [
                    {
                        "id": "call_keep",
                        "type": "function",
                        "function": {"name": "read_file", "arguments": "{}"},
                    },
                    {
                        "id": "call_drop",
                        "type": "function",
                        "function": {"name": "write_file", "arguments": "{}"},
                    },
                ],
            },
            {"role": "tool", "tool_call_id": "call_keep", "content": "file text"},
            {"role": "tool", "tool_call_id": "orphan", "content": "orphan result"},
        ],
        active_agent="lead",
    )

    assert context.active_agent == "lead"
    assert context.dropped_tool_calls == 1
    assert context.dropped_tool_results == 1
    assert context.messages == [
        {"role": "user", "content": "查一下文件"},
        {
            "role": "assistant",
            "content": None,
            "tool_calls": [
                {
                    "id": "call_keep",
                    "type": "function",
                    "function": {"name": "read_file", "arguments": "{}"},
                }
            ],
        },
        {"role": "tool", "tool_call_id": "call_keep", "content": "file text"},
    ]


def test_build_handoff_context_drops_subagent_tool_history_for_lead():
    context = build_handoff_context(
        [
            {"role": "user", "content": "并行查资料"},
            {
                "role": "assistant",
                "content": None,
                "tool_calls": [
                    {
                        "id": "research-news::call_search",
                        "type": "function",
                        "function": {"name": "mcp_search", "arguments": "{}"},
                    }
                ],
            },
            {
                "role": "tool",
                "tool_call_id": "research-news::call_search",
                "content": "subagent result",
            },
            {"role": "assistant", "content": "综合回答。"},
        ],
        active_agent="lead",
    )

    assert context.dropped_subagent_messages == 2
    assert context.messages == [
        {"role": "user", "content": "并行查资料"},
        {"role": "assistant", "content": "综合回答。"},
    ]


def test_memory_user_id_for_agent_keeps_lead_compatible_and_scopes_workers():
    assert memory_user_id_for_agent("default", "lead") == "default"
    assert memory_user_id_for_agent("default", "") == "default"
    assert memory_user_id_for_agent("default", "research") == "default::agent:research"
    assert memory_user_id_for_agent("u1", "Research Agent!") == "u1::agent:research_agent"
