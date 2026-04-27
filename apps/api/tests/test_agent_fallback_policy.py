from app.core.agent_harness import (
    ToolResultValidation,
    decide_fallback_policy,
    fallback_trace_payload,
)


def test_skill_failure_switches_to_realtime_research_capability():
    decision = decide_fallback_policy(
        tool_name="skill_stock_quote",
        validation=ToolResultValidation(
            ok=False,
            reason="tool_failure",
            retryable=True,
            fallback_hint="Skill script failed.",
        ),
    )

    assert decision.action == "switch_to_realtime_research"
    assert decision.retry_original_tool is False
    assert "search.discovery" in decision.system_hint


def test_policy_block_requires_argument_revision_without_tool_switch():
    decision = decide_fallback_policy(
        tool_name="read_file",
        validation=ToolResultValidation(
            ok=False,
            reason="policy_blocked",
            retryable=False,
            fallback_hint="Use a virtual path.",
        ),
    )

    assert decision.action == "revise_arguments"
    assert decision.retry_original_tool is False
    assert "不要重复调用" in decision.system_hint


def test_empty_result_uses_alternative_tool_or_user_explanation():
    decision = decide_fallback_policy(
        tool_name="fetch_url",
        validation=ToolResultValidation(
            ok=False,
            reason="empty_result",
            retryable=True,
            fallback_hint="No content.",
        ),
    )

    assert decision.action == "try_alternative_tool"
    assert decision.retry_original_tool is False
    assert "其他可用工具" in decision.system_hint


def test_ok_validation_has_no_fallback_action():
    decision = decide_fallback_policy(
        tool_name="calculator",
        validation=ToolResultValidation(ok=True),
    )

    assert decision.action == "none"
    assert decision.retry_original_tool is False
    assert decision.system_hint == ""


def test_fallback_trace_payload_exposes_action_and_hint():
    decision = decide_fallback_policy(
        tool_name="skill_stock_quote",
        validation=ToolResultValidation(ok=False, reason="tool_failure", retryable=True),
    )

    payload = fallback_trace_payload(decision)

    assert payload["fallbackAction"] == "switch_to_realtime_research"
    assert payload["fallbackRetryOriginalTool"] is False
    assert "search.discovery" in payload["fallbackHint"]
