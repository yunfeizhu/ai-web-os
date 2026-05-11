from app.core.agent_harness import (
    ToolResultValidation,
    decide_fallback_policy,
    fallback_trace_payload,
    guard_tool_call,
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


def test_notes_tool_is_blocked_for_memory_only_requests():
    decision = guard_tool_call(
        tool_name="save_note",
        args={"title": "旅行计划", "content": "2026年五一准备去日本"},
        task_text="记住，我今年五一去了日本",
    )

    assert decision.allowed is False
    assert decision.reason == "memory_request_should_not_use_notes"
    assert "记忆系统" in decision.replacement_hint


def test_notes_tool_is_allowed_for_explicit_note_requests():
    decision = guard_tool_call(
        tool_name="save_note",
        args={"title": "旅行计划", "content": "2026年五一准备去日本"},
        task_text="把 2026 年五一准备去日本这件事保存到笔记里",
    )

    assert decision.allowed is True


def test_file_tool_is_blocked_for_memory_only_requests():
    decision = guard_tool_call(
        tool_name="write_file",
        args={"path": "/Notes/MEMORY.md", "content": "用户今年五一准备去日本"},
        task_text="记住，我今年五一准备去日本",
    )

    assert decision.allowed is False
    assert decision.reason == "memory_request_should_not_use_files"
    assert "记忆系统" in decision.replacement_hint


def test_file_tool_cannot_write_reserved_memory_file():
    decision = guard_tool_call(
        tool_name="write_file",
        args={"path": "/MEMORY.md", "content": "# Memory"},
        task_text="整理我的长期记忆",
    )

    assert decision.allowed is False
    assert decision.reason == "reserved_memory_file_path_blocked"
    assert "memory_search" in decision.replacement_hint
