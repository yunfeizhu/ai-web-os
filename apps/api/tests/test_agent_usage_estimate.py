from app.core.agent_usage import estimate_agent_usage


def test_estimate_agent_usage_counts_input_and_output_tokens():
    usage = estimate_agent_usage(
        model="gpt-4o",
        input_messages=[{"role": "user", "content": "请总结这段文字"}],
        output_text="这是总结。",
        reasoning_text="先阅读，再概括。",
    )

    assert usage["inputTokens"] > 0
    assert usage["outputTokens"] > 0
    assert usage["reasoningTokens"] > 0
    assert usage["totalTokens"] == (
        usage["inputTokens"] + usage["outputTokens"] + usage["reasoningTokens"]
    )
    assert "estimatedCostUsd" not in usage
    assert "costStatus" not in usage
