"""Deterministic eval cases for the Agent Harness.

These checks do not call an LLM or external tools. They pin the control-plane
behavior that should remain stable while we keep improving the agent loop:
policy guards, result validation, tool dedup, and temporal normalization.

Architecture note:
- No ToolScope routing — all tools are always available.
- Script-backed skills are direct function-calling tools; first use may return a guide.
- Knowledge-only skills use load_skill_context for optional context loading.
"""

from __future__ import annotations

import asyncio
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.core.agent_harness import (  # noqa: E402
    guard_tool_call,
    normalize_temporal_tool_args,
    tool_call_signature,
    tool_requires_confirmation,
    validate_tool_result,
)
from app.core.agent_graph import AgentGraphRuntime  # noqa: E402
from app.core.llm_provider import _is_safe_tool_preamble  # noqa: E402
from app.core.tools import get_tools_for_model  # noqa: E402


def _tool_names(tools: list[dict]) -> set[str]:
    return {
        str((tool.get("function") or {}).get("name") or "")
        for tool in tools
        if isinstance(tool, dict)
    }


def _assert(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


async def main() -> None:
    # 1. All core tools always available (no scope gating)
    tools = await get_tools_for_model("gpt-4o", user_message="计算2+3")
    names = _tool_names(tools)
    _assert("calculator" in names, f"calculator must always be available, got {names}")
    _assert("fetch_url" in names, f"fetch_url must always be available, got {names}")
    _assert("python_exec" in names, f"python_exec must always be available, got {names}")
    _assert("read_file" in names, f"read_file must always be available, got {names}")

    # 2. Calculator only blocks non-math expressions, not legitimate calculations
    decision = guard_tool_call(tool_name="calculator", args={"expression": "2+3*4"})
    _assert(decision.allowed, "calculator with math expression must be allowed")
    decision_bad = guard_tool_call(tool_name="calculator", args={"expression": "time()"})
    _assert(not decision_bad.allowed and decision_bad.reason == "calculator_non_math_expression",
            "calculator with time() must be blocked")

    # 3. Skill internal paths are blocked from file tools
    decision = guard_tool_call(
        tool_name="read_file",
        args={"path": "/skills/user/hithink-stock/SKILL.md"},
    )
    _assert(not decision.allowed and decision.reason == "skill_internal_path_blocked",
            "skill path read must be blocked")

    # 4. Empty tool results fail validation
    v = validate_tool_result(tool_name="mcp_tavily_search", result="", error=False)
    _assert(not v.ok and v.reason == "empty_result", f"empty result must fail, got {v.reason}")

    # 5. Tool preambles: short preambles allowed, data-like output suppressed
    _assert(_is_safe_tool_preamble("我先查一下。"), "short preamble should be allowed")
    _assert(not _is_safe_tool_preamble("根据查询结果如下：\n| 日期 | 天气 |"),
            "data-like preamble should be blocked")
    _assert(not _is_safe_tool_preamble("x" * 81), "long preamble should be blocked")

    # 6. LangGraph runtime should checkpoint harness node transitions.
    graph = AgentGraphRuntime(request_id="eval-agent-harness")
    event = graph.status("build_context")
    _assert(event["graph"] == "langgraph", f"LangGraph should be active, got {event['graph']}")
    _assert(bool(event.get("checkpointId")), "LangGraph checkpoint id should be recorded")
    checkpoint = graph.get_checkpoint()
    _assert(checkpoint is not None, "LangGraph checkpoint should exist after status call")

    # 7. Month-only weather queries should be normalized to the current year.
    normalized_args = normalize_temporal_tool_args(
        tool_name="mcp_tavily_search",
        args={"query": "日本5月天气 2025年 气温 降雨量 旅游季节"},
        user_message="日本5月天气如何",
    )
    current_year = str(__import__("datetime").datetime.now().year)
    _assert(current_year in normalized_args["query"],
            f"query year should be normalized to {current_year}: {normalized_args}")
    _assert("2025" not in normalized_args["query"],
            f"wrong year should be removed: {normalized_args}")

    # 8. Same search with/without a wrong year should be considered duplicate.
    sig1 = tool_call_signature("mcp_tavily_search", normalized_args)
    sig2 = tool_call_signature("mcp_tavily_search", {"query": "日本5月天气 气温 降雨量 旅游季节"})
    _assert(sig1 == sig2, f"duplicate search signatures should match: {sig1} != {sig2}")

    # 9. Empty Tavily JSON result fails validation with correct reason
    no_data_validation = validate_tool_result(
        tool_name="mcp_tavily_search",
        result='{"content":[{"type":"text","text":"{\\"query\\":\\"日本5月天气\\",\\"answer\\":null,\\"results\\":[]}"}],"isError":false}',
        error=False,
    )
    _assert(not no_data_validation.ok and no_data_validation.reason == "no_search_results",
            "empty Tavily result should fail validation")

    print("Agent Harness eval passed: 9 cases")


    # 10. tool_requires_confirmation: default set is empty, extra_tools override works
    _assert(
        not tool_requires_confirmation("calculator"),
        "calculator must NOT require confirmation by default",
    )
    _assert(
        not tool_requires_confirmation("python_exec"),
        "python_exec must NOT require confirmation when extra_tools is None",
    )
    _assert(
        tool_requires_confirmation("python_exec", extra_tools=frozenset({"python_exec"})),
        "python_exec MUST require confirmation when it is in extra_tools",
    )
    _assert(
        not tool_requires_confirmation("write_file", extra_tools=frozenset({"python_exec"})),
        "write_file must NOT require confirmation when only python_exec is in extra_tools",
    )

    # 11. Skill tool schema descriptions are brief — no embedded SKILL.md body
    for tool in tools:
        name = (tool.get("function") or {}).get("name") or ""
        if not name.startswith("skill_"):
            continue  # Only enforce brief descriptions for script-backed skill tools
        desc = (tool.get("function") or {}).get("description") or ""
        _assert(
            len(desc) <= 300,
            f"Skill tool description too long ({len(desc)} chars): "
            f"{name} — SKILL.md body may be embedded in the tool schema",
        )

    # 12. Confirmation store: create → resolve → re-resolve idempotency
    from app.core.confirmation_store import (  # noqa: E402
        create_confirmation,
        discard_confirmation,
        pending_count,
        resolve_confirmation,
    )

    before = pending_count()
    fut = create_confirmation("eval-test-req")
    _assert(pending_count() == before + 1, "create_confirmation should add to pending count")

    resolved = resolve_confirmation("eval-test-req", approved=True)
    _assert(resolved, "resolve_confirmation should return True for an existing future")
    _assert(fut.done() and fut.result() is True, "Future should be resolved with True")

    re_resolved = resolve_confirmation("eval-test-req", approved=False)
    _assert(not re_resolved, "resolve_confirmation should return False for an already-resolved future")

    discard_confirmation("eval-test-req")
    _assert(pending_count() == before, "discard_confirmation should remove entry")

    print("Agent Harness eval passed: 12 cases")


if __name__ == "__main__":
    asyncio.run(main())
