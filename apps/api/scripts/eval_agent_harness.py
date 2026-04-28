"""Deterministic eval cases for the Agent Harness.

These checks do not call an LLM or external tools. They pin the control-plane
behavior that should remain stable while we keep improving the agent loop:
policy guards, result validation, tool dedup, temporal normalization, and
multi-agent control-plane boundaries.

Architecture note:
- No ToolScope routing — all tools are always available.
- Script-backed skills are direct function-calling tools; first use may return a guide.
- Knowledge-only skills use load_skill_context for optional context loading.
"""

from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# Keep deterministic control-plane evals fully offline; LiteLLM otherwise tries
# to refresh pricing metadata during import and can pollute eval output.
os.environ.setdefault("LITELLM_LOCAL_MODEL_COST_MAP", "True")

from app.core.agent_harness import (  # noqa: E402
    ToolResultValidation,
    decide_fallback_policy,
    guard_tool_call,
    normalize_temporal_tool_args,
    tool_call_signature,
    tool_requires_confirmation,
    validate_tool_result,
)
from app.core.agent_graph import AgentGraphRuntime, GRAPH_NODES  # noqa: E402
from app.core import context_manager as context_manager_module  # noqa: E402
from app.core import evidence_bundle as evidence_bundle_module  # noqa: E402
from app.core import subagent as subagent_module  # noqa: E402
from app.core.context_manager import (  # noqa: E402
    CONTEXT_COMPRESSION_MARKER,
    compact_history_if_needed,
    compact_tool_result_for_context,
    prepare_messages,
)
from app.core.evidence_bundle import (  # noqa: E402
    build_tool_evidence,
    distill_evidence_bundle,
    fallback_evidence_bundle,
    normalize_evidence_bundle,
)
from app.core.llm_provider import (  # noqa: E402
    _delegate_result_has_sufficient_search,
    _extract_delta_reasoning_content,
    _is_safe_tool_preamble,
    build_litellm_completion_kwargs,
)
from app.core.subagent import DELEGATE_TOOL_CONTEXT_CHARS, normalize_subagent_specs  # noqa: E402
from app.core.tool_capabilities import (  # noqa: E402
    CAPABILITY_SEARCH_DISCOVERY,
    augment_tool_schema_with_capability,
    infer_tool_capability,
    normalize_extract_args,
    result_has_sufficient_discovery,
    should_skip_content_fetch_after_search,
    should_stop_search_after_sufficient_discovery,
    task_requires_full_content,
)
from app.core.tools import get_tools_for_model  # noqa: E402
from app.core.user_errors import user_facing_error_message  # noqa: E402


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
    tools = await get_tools_for_model(
        "gpt-4o",
        user_message="计算2+3",
        include_external_mcp=False,
    )
    names = _tool_names(tools)
    _assert("calculator" in names, f"calculator must always be available, got {names}")
    _assert("fetch_url" in names, f"fetch_url must always be available, got {names}")
    _assert("python_exec" in names, f"python_exec must always be available, got {names}")
    _assert("read_file" in names, f"read_file must always be available, got {names}")
    _assert("delegate_task" in names, f"Lead Agent should expose delegate_task, got {names}")

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

    # 6. Low-level provider errors should be shown as friendly user-facing messages.
    network_message = user_facing_error_message(
        Exception("litellm.InternalServerError: OpenAIException - Connection error.")
    )
    _assert("网络" in network_message and "Connection error" not in network_message,
            f"network errors should be friendly: {network_message}")
    temperature_message = user_facing_error_message(
        Exception("invalid temperature: only 1 is allowed for this model")
    )
    _assert("temperature" in temperature_message and "invalid temperature" not in temperature_message,
            f"temperature errors should be friendly: {temperature_message}")
    thinking_message = user_facing_error_message(
        Exception("thinking is enabled but reasoning_content is missing in assistant tool call message at index 5")
    )
    _assert("思考" in thinking_message and "reasoning_content" not in thinking_message,
            f"thinking history errors should be friendly: {thinking_message}")

    # 7. Kimi K2-series models reject caller-supplied sampling params.
    kimi_kwargs = build_litellm_completion_kwargs(
        litellm_model="openai/kimi-k2.6",
        api_key="eval-key",
        temperature=0.7,
        max_tokens=4096,
    )
    _assert("temperature" not in kimi_kwargs,
            f"Kimi K2.6 should not receive temperature: {kimi_kwargs}")
    _assert(kimi_kwargs.get("extra_body", {}).get("thinking") != {"type": "disabled"},
            f"Kimi K2.6 should keep provider thinking enabled and preserve reasoning history instead: {kimi_kwargs}")
    regular_kwargs = build_litellm_completion_kwargs(
        litellm_model="openai/gpt-4o",
        api_key="eval-key",
        temperature=0.7,
        max_tokens=4096,
    )
    _assert(regular_kwargs.get("temperature") == 0.7,
            f"regular models should keep temperature: {regular_kwargs}")
    _assert("extra_body" not in regular_kwargs,
            f"regular models should not receive Kimi-specific extra_body: {regular_kwargs}")

    # 8. Thinking-capable models need assistant tool-call history to retain reasoning_content.
    prepared_thinking_history = prepare_messages(
        model="openai/kimi-k2.6",
        system_prompt="System prompt.",
        history=[
            {
                "role": "assistant",
                "content": None,
                "reasoning_content": "I need live stock data before answering.",
                "tool_calls": [
                    {
                        "id": "call_stock",
                        "type": "function",
                        "function": {
                            "name": "stock_quote",
                            "arguments": '{"symbol":"600519"}',
                        },
                    }
                ],
            },
            {
                "role": "tool",
                "tool_call_id": "call_stock",
                "content": '{"price": 1500}',
            },
            {"role": "user", "content": "600519怎么样"},
        ],
        max_output_tokens=100,
    )
    assistant_tool_history = [
        message
        for message in prepared_thinking_history
        if message.get("role") == "assistant" and message.get("tool_calls")
    ]
    _assert(
        assistant_tool_history
        and assistant_tool_history[0].get("reasoning_content")
        == "I need live stock data before answering.",
        f"assistant tool-call history should preserve reasoning_content: {prepared_thinking_history}",
    )
    _assert(
        _extract_delta_reasoning_content({
            "provider_specific_fields": {
                "reasoning_content": "Thinking streamed by provider.",
            },
        }) == "Thinking streamed by provider.",
        "LiteLLM reasoning_content deltas should be extracted for UI streaming",
    )

    # 8. LangGraph runtime should checkpoint harness node transitions.
    graph = AgentGraphRuntime(request_id="eval-agent-harness")
    event = graph.status("build_context")
    _assert(event["graph"] == "langgraph", f"LangGraph should be active, got {event['graph']}")
    _assert(bool(event.get("checkpointId")), "LangGraph checkpoint id should be recorded")
    checkpoint = graph.get_checkpoint()
    _assert(checkpoint is not None, "LangGraph checkpoint should exist after status call")

    # 9. Multi-Agent 2.0 graph facade exposes explicit orchestration nodes.
    for node in ("route", "delegate", "synthesize", "evaluate"):
        _assert(node in GRAPH_NODES, f"explicit graph node missing: {node}")
        node_event = graph.status(node, marker=node)
        _assert(node_event["node"] == node, f"graph should checkpoint {node}: {node_event}")

    # 10. Month-only weather queries should be normalized to the current year.
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

    # 13. Sub-agent role surfaces are narrower than the Lead Agent surface.
    research_tools = await get_tools_for_model(
        "gpt-4o",
        user_message="查资料",
        skill_context={"agent_depth": 1, "agent_role": "research"},
        include_external_mcp=False,
    )
    research_names = _tool_names(research_tools)
    _assert("fetch_url" in research_names, f"research role needs fetch_url: {research_names}")
    _assert("python_exec" not in research_names, "research role must not receive python_exec")
    _assert("delegate_task" not in research_names, "sub-agents must not receive delegate_task")

    coder_tools = await get_tools_for_model(
        "gpt-4o",
        user_message="算一下",
        skill_context={"agent_depth": 1, "agent_role": "coder"},
        include_external_mcp=False,
    )
    coder_names = _tool_names(coder_tools)
    _assert("python_exec" in coder_names, f"coder role needs python_exec: {coder_names}")
    _assert("fetch_url" not in coder_names, "coder role must not receive fetch_url by default")

    # 14. Delegation specs are normalized into the role-aware contract.
    specs = normalize_subagent_specs([
        {"agent": "search", "task": "搜索最新资料", "agent_name": "Web Research"},
        {"role": "python", "task": "计算平均值", "agent_name": "Calc"},
    ])
    _assert(specs[0]["role"] == "research", f"search alias should map to research: {specs}")
    _assert(specs[1]["role"] == "coder", f"python alias should map to coder: {specs}")

    # 15. Sub-agent runtime passes a bounded iteration budget into the worker loop.
    captured_kwargs: dict = {}
    original_agent_loop = subagent_module.agent_loop

    async def fake_agent_loop(**kwargs):
        captured_kwargs.update(kwargs)
        yield (
            "tool_call",
            {
                "id": "functions.fake_tool:0",
                "name": "fake_tool",
                "args": {"query": "eval"},
            },
        )
        yield (
            "tool_result",
            {
                "id": "functions.fake_tool:0",
                "name": "fake_tool",
                "result": "eval-result",
                "error": False,
            },
        )
        yield ("token", "ok")

    subagent_module.agent_loop = fake_agent_loop
    try:
        events = [
            event
            async for event in subagent_module.run_subagent(
                {
                    "role": "writer",
                    "task": "draft a short answer",
                    "agent_name": "Writer Eval",
                },
                model="gpt-4o",
                api_key="eval-key",
                max_iterations=99,
                skill_context={},
                request_id="eval-subagent",
            )
        ]
    finally:
        subagent_module.agent_loop = original_agent_loop

    result_events = [payload for event_type, payload in events if event_type == "subagent_result"]
    _assert(len(result_events) == 1, f"subagent should emit one result event: {events}")
    _assert(not result_events[0].get("failed"), f"subagent should succeed: {result_events[0]}")
    _assert(result_events[0].get("answer") == "ok", f"subagent answer should collect tokens: {result_events[0]}")
    _assert(isinstance(result_events[0].get("evidence"), dict),
            f"subagent result should include an evidence bundle: {result_events[0]}")
    _assert(
        captured_kwargs.get("max_iterations") == 5,
        f"writer role should cap delegated max_iterations at 5: {captured_kwargs}",
    )
    tool_events = [
        payload
        for event_type, payload in events
        if event_type in {"tool_call", "tool_result"}
    ]
    _assert(len(tool_events) == 2, f"subagent should forward tool events: {events}")
    for payload in tool_events:
        _assert(
            str(payload.get("id", "")).startswith(f"{payload.get('subagentId')}::"),
            f"subagent tool event ids must be namespaced: {payload}",
        )

    async def fake_max_tool_agent_loop(**_kwargs):
        yield ("token", "正在搜索（已达到最大工具调用次数）")
        yield ("status", {"node": "respond", "reason": "max_tool_calls"})

    subagent_module.agent_loop = fake_max_tool_agent_loop
    try:
        max_events = [
            event
            async for event in subagent_module.run_subagent(
                {
                    "role": "writer",
                    "task": "draft a short answer",
                    "agent_name": "Writer Max Eval",
                },
                model="gpt-4o",
                api_key="eval-key",
                max_iterations=99,
                skill_context={},
                request_id="eval-subagent-max",
            )
        ]
    finally:
        subagent_module.agent_loop = original_agent_loop

    max_result_events = [
        payload for event_type, payload in max_events if event_type == "subagent_result"
    ]
    _assert(len(max_result_events) == 1, f"subagent should emit max-tool result: {max_events}")
    _assert(
        max_result_events[0].get("maxToolCallsReached") is True
        and max_result_events[0].get("stopReason") == "max_tool_calls",
        f"subagent should expose max-tool state structurally: {max_result_events[0]}",
    )
    _assert(
        "已达到最大工具调用次数" not in str(max_result_events[0].get("answer") or ""),
        f"runtime max-tool marker should not pollute answer: {max_result_events[0]}",
    )

    # 16. Search/extract capabilities are inferred from generic tool schemas.
    search_schema = {
        "type": "function",
        "function": {
            "name": "mcp_searxng_web_1234",
            "description": "Search the web and return ranked results.",
            "parameters": {"type": "object", "properties": {"query": {"type": "string"}}},
        },
    }
    extract_schema = {
        "type": "function",
        "function": {
            "name": "mcp_reader_extract_1234",
            "description": "Extract markdown from known URLs.",
            "parameters": {"type": "object", "properties": {"urls": {"type": "array"}}},
        },
    }
    augmented_search = augment_tool_schema_with_capability(search_schema)
    _assert(
        infer_tool_capability(
            search_schema["function"]["name"],
            search_schema["function"]["description"],
            search_schema["function"]["parameters"],
        ) == CAPABILITY_SEARCH_DISCOVERY,
        "SearXNG-like search schema should infer search.discovery",
    )
    _assert(
        "ToolUsePolicy:" in augmented_search["function"]["description"],
        "search schema should receive capability-aware usage guidance",
    )
    _assert(
        infer_tool_capability(
            search_schema["function"]["name"],
            augmented_search["function"]["description"],
            search_schema["function"]["parameters"],
        ) == CAPABILITY_SEARCH_DISCOVERY,
        "augmented search schema should still infer search.discovery",
    )
    _assert(
        should_skip_content_fetch_after_search(
            tool_name=extract_schema["function"]["name"],
            description=extract_schema["function"]["description"],
            args={"urls": ["https://example.com/a"]},
            task_text="summarize the latest market news",
            successful_search_count=1,
        ),
        "extract should be skipped when search snippets are sufficient",
    )
    _assert(
        not should_skip_content_fetch_after_search(
            tool_name=extract_schema["function"]["name"],
            description=extract_schema["function"]["description"],
            args={"urls": ["https://example.com/a"]},
            task_text="quote the original source text",
            successful_search_count=1,
        ),
        "extract should be allowed when exact source text is requested",
    )
    _assert(
        normalize_extract_args(
            {"urls": ["http://www.weather.com.cn/weather1d/101210101.shtm"]}
        )["urls"][0].endswith(".shtml"),
        "weather.com.cn weather1d .shtm URLs should normalize to .shtml before extraction",
    )

    # 17. Partial extract success is valid, and search results can satisfy discovery.
    sufficient_search_result = json.dumps(
        {
            "results": [
                {"title": "A", "url": "https://example.com/a", "content": "snippet a"},
                {"title": "B", "url": "https://example.com/b", "content": "snippet b"},
            ]
        },
        ensure_ascii=False,
    )
    _assert(
        result_has_sufficient_discovery(
            "mcp_searxng_web_1234",
            sufficient_search_result,
            "Search the web and return ranked results.",
        ),
        "two useful search results should count as sufficient discovery evidence",
    )
    weather_single_result = json.dumps(
        {
            "query": "杭州 2026年4月22日 实时天气 温度 天气状况 风力",
            "results": [
                {
                    "title": "杭州天气",
                    "url": "https://example.com/hangzhou-weather",
                    "content": "杭州 2026年4月22日 阴有阵雨，气温 15℃ ~ 20℃，东北风 3级。",
                }
            ],
        },
        ensure_ascii=False,
    )
    _assert(
        result_has_sufficient_discovery(
            "mcp_tavily_search_eval",
            weather_single_result,
            "Search the web and return ranked results.",
            task_text="查询杭州今天的实时天气情况，包括温度、天气状况、风力等信息。",
        ),
        "one weather search result covering requested fields should be sufficient",
    )
    _assert(
        should_skip_content_fetch_after_search(
            tool_name=extract_schema["function"]["name"],
            description=extract_schema["function"]["description"],
            args={"urls": ["https://example.com/hangzhou-weather"]},
            task_text="查询杭州今天的实时天气情况，包括温度、天气状况、风力等信息。",
            successful_search_count=1,
        ),
        "extract should be skipped after one sufficient weather search result",
    )
    _assert(
        should_stop_search_after_sufficient_discovery(
            tool_name="mcp_tavily_search_eval",
            description="Search the web and return ranked results.",
            args={"query": "美伊冲突 最新新闻 2026年4月"},
            task_text="搜索目前美伊冲突的新闻",
            successful_search_count=1,
            is_subagent=True,
        ),
        "sub-agent should stop repeated searches once discovery evidence is sufficient",
    )
    _assert(
        not should_stop_search_after_sufficient_discovery(
            tool_name="mcp_tavily_search_eval",
            description="Search the web and return ranked results.",
            args={"query": "美伊冲突 最新新闻 2026年4月"},
            task_text="搜索目前美伊冲突的新闻",
            successful_search_count=1,
            is_subagent=False,
        ),
        "top-level agent should not inherit sub-agent repeated-search stop policy",
    )
    _assert(
        not task_requires_full_content("搜索目前美伊冲突的新闻"),
        "geopolitical conflict should not be mistaken for source-conflict verification",
    )
    _assert(
        task_requires_full_content("搜索结果来源冲突，请核验原文"),
        "explicit source conflict should still require full content",
    )
    partial_extract_inner = json.dumps(
        {
            "results": [{"url": "https://example.com/a", "content": "ok"}],
            "failed_results": [{"url": "https://example.com/b", "error": "403"}],
        },
        ensure_ascii=False,
    )
    partial_extract_wrapper = json.dumps(
        {"content": [{"type": "text", "text": partial_extract_inner}], "isError": False},
        ensure_ascii=False,
    )
    partial_validation = validate_tool_result(
        tool_name="mcp_reader_extract_1234",
        result=partial_extract_wrapper,
        error=False,
    )
    _assert(partial_validation.ok, f"partial extract success should be valid: {partial_validation}")

    # 18. Current-turn search results are compacted before re-entering the LLM.
    nested_search = json.dumps(
        {
            "query": "贵州茅台 最新新闻",
            "answer": None,
            "results": [
                {
                    "title": "贵州茅台公告",
                    "url": "https://example.com/moutai",
                    "content": "公告内容 " + ("很长 " * 1000),
                },
                {
                    "title": "白酒行业动态",
                    "url": "https://example.com/baijiu",
                    "content": "行业内容 " + ("很长 " * 1000),
                },
            ],
        },
        ensure_ascii=False,
    )
    tavily_wrapper = json.dumps(
        {"content": [{"type": "text", "text": nested_search}], "isError": False},
        ensure_ascii=False,
    )
    compacted = compact_tool_result_for_context(
        tool_name="mcp_tavily_search_eval",
        result=tavily_wrapper,
        is_subagent=True,
    )
    _assert(len(compacted) <= 1400, f"subagent search result must be compact: {len(compacted)}")
    _assert("贵州茅台公告" in compacted and "https://example.com/moutai" in compacted,
            f"compact search result should retain title and url: {compacted}")
    _assert(len(compacted) < len(tavily_wrapper), "compact result should be shorter than original")

    # 19. EvidenceBundle preserves structured handoff from sub-agent to Lead Agent.
    evidence_item = build_tool_evidence({
        "name": "mcp_tavily_search_eval",
        "displayName": "TavilyMcp Search",
        "result": json.dumps(
            {
                "results": [
                    {
                        "title": "杭州天气",
                        "url": "https://example.com/weather",
                        "content": "杭州 2026年4月22日 白天阴有阵雨 15℃ ~ 20℃ 湿度 82% 东北风 3级",
                    }
                ]
            },
            ensure_ascii=False,
        ),
        "error": False,
    })
    _assert(evidence_item is not None, "tool evidence should be built from search result")
    bundle = normalize_evidence_bundle(
        {
            "summary": "杭州今天阴有阵雨，气温 15℃ ~ 20℃。",
            "required_fields": [
                {"field": "temperature", "label": "温度"},
                {"field": "humidity", "label": "湿度"},
            ],
            "facts": [
                {
                    "field": "temperature",
                    "label": "温度",
                    "value": "15℃ ~ 20℃",
                    "source_url": "https://example.com/weather",
                    "evidence": "15℃ ~ 20℃",
                    "confidence": "high",
                }
            ],
            "sources": [{"title": "杭州天气", "url": "https://example.com/weather"}],
            "capabilities_used": [CAPABILITY_SEARCH_DISCOVERY],
            "evidence_sufficient": True,
            "needs_more_tools": False,
        },
        task="查询杭州天气，包括温度和湿度",
        answer="杭州今天阴有阵雨，气温 15℃ ~ 20℃。",
        tool_evidence=[evidence_item],
    )
    _assert(bundle["facts"][0]["value"] == "15℃ ~ 20℃",
            f"evidence facts should preserve requested numeric values: {bundle}")
    _assert(
        any(fact["field"] == "weather_result" and "湿度 82%" in fact["evidence"] for fact in bundle["facts"]),
        f"search snippets should be preserved as deterministic facts: {bundle}",
    )
    _assert("湿度" not in bundle["missing_fields"],
            f"required fields present in deterministic search evidence should not be marked missing: {bundle}")
    fallback_bundle = fallback_evidence_bundle(
        task="查询杭州天气，包括温度和湿度",
        answer="杭州今天阴有阵雨。",
        tool_evidence=[evidence_item],
    )
    _assert(CAPABILITY_SEARCH_DISCOVERY in fallback_bundle["capabilities_used"],
            f"fallback evidence should retain search capability: {fallback_bundle}")
    _assert(
        any(fact["field"] == "weather_result" and "15℃ ~ 20℃" in fact["evidence"] for fact in fallback_bundle["facts"]),
        f"fallback evidence should lift search snippets into facts: {fallback_bundle}",
    )

    news_evidence_item = build_tool_evidence({
        "name": "mcp_tavily_search_eval",
        "displayName": "TavilyMcp Search",
        "result": json.dumps(
            {
                "query": "贵州茅台 600519 最新新闻 公司公告 市场消息 2026年",
                "results": [
                    {
                        "title": "贵州茅台发布2025年年度报告",
                        "url": "https://example.com/moutai-annual-report",
                        "content": "贵州茅台披露2025年年报，营业收入与利润变化成为市场关注点。",
                        "published_date": "2026-04-16",
                    },
                    {
                        "title": "贵州茅台召开股东大会并讨论分红方案",
                        "url": "https://example.com/moutai-dividend",
                        "content": "公司公告显示，股东大会审议分红、经营计划等事项。",
                        "published_date": "2026-04-18",
                    },
                ],
            },
            ensure_ascii=False,
        ),
        "error": False,
    })
    _assert(news_evidence_item is not None, "news search evidence should be built")
    news_fallback_bundle = fallback_evidence_bundle(
        task="搜索贵州茅台（600519）的最新新闻和动态，包括公司公告、市场表现、行业相关新闻等。",
        answer="搜索结果未返回具体新闻内容。",
        tool_evidence=[news_evidence_item],
    )
    _assert(
        any(fact["field"] == "news_item" and "年度报告" in fact["value"] for fact in news_fallback_bundle["facts"]),
        f"news search titles should survive fallback evidence: {news_fallback_bundle}",
    )
    _assert(
        any("moutai-annual-report" in fact["source_url"] for fact in news_fallback_bundle["facts"]),
        f"news facts should keep source urls: {news_fallback_bundle}",
    )
    _assert(
        news_fallback_bundle["evidence_sufficient"] is True and news_fallback_bundle["needs_more_tools"] is False,
        f"news fallback should be sufficient when search results exist: {news_fallback_bundle}",
    )

    delegate_payload = json.loads(subagent_module.build_subagent_tool_result([
        {
            "agentName": "weather_research",
            "role": "research",
            "task": "查询杭州天气，包括温度和湿度",
            "answer": "杭州今天阴有阵雨。",
            "failed": False,
            "evidence": bundle,
            "elapsedMs": 123,
        }
    ]))
    _assert(delegate_payload["facts"][0]["value"] == "15℃ ~ 20℃",
            f"delegate result should expose facts at top level: {delegate_payload}")
    _assert(delegate_payload["evidenceSufficient"] is True,
            f"delegate result should propagate evidence sufficiency: {delegate_payload}")
    _assert(CAPABILITY_SEARCH_DISCOVERY in delegate_payload["capabilitiesUsed"],
            f"delegate result should propagate capabilities: {delegate_payload}")
    _assert(
        _delegate_result_has_sufficient_search(json.dumps(delegate_payload, ensure_ascii=False)),
        f"delegate result with sufficient search evidence should update Lead search state: {delegate_payload}",
    )
    news_delegate_payload = json.loads(subagent_module.build_subagent_tool_result([
        {
            "agentName": "news_research",
            "role": "research",
            "task": "搜索贵州茅台（600519）的最新新闻和动态，包括公司公告、市场表现、行业相关新闻等。",
            "answer": "搜索结果未返回具体新闻内容。",
            "failed": False,
            "evidence": news_fallback_bundle,
            "elapsedMs": 123,
        }
    ]))
    _assert(
        any("年度报告" in fact["value"] for fact in news_delegate_payload["facts"]),
        f"delegate result should expose deterministic news facts: {news_delegate_payload}",
    )
    _assert(
        _delegate_result_has_sufficient_search(json.dumps(news_delegate_payload, ensure_ascii=False)),
        f"delegate result with deterministic news facts should update Lead search state: {news_delegate_payload}",
    )
    stock_evidence_item = build_tool_evidence({
        "name": "skill_hithink_stock_quote",
        "displayName": "同花顺行情查询 Skill 调用",
        "result": (
            "📊 行情查询结果（共 1 条）\n"
            "查询词：300033 同花顺 今日股价 涨跌幅 成交量\n\n"
            "────────────────────────────\n"
            "同花顺（300033.SZ）\n"
            "当前股价：246.74 元\n"
            "今日涨跌：▲ 0.39%\n"
            "成交量：1248.3 万手\n"
            "────────────────────────────\n"
            "数据来源：同花顺问财"
        ),
        "error": False,
    })
    _assert(stock_evidence_item is not None, "stock skill evidence should be built")
    stock_delegate_payload = json.loads(subagent_module.build_subagent_tool_result([
        {
            "agentName": "stock_research",
            "role": "research",
            "task": "查询股票代码300033（同花顺）的最新行情信息，包括当前股价、涨跌幅、成交量等关键指标。",
            "answer": "行情查询返回了基础信息。",
            "failed": False,
            "evidence": fallback_evidence_bundle(
                task="查询股票代码300033（同花顺）的最新行情信息，包括当前股价、涨跌幅、成交量等关键指标。",
                answer="行情查询返回了基础信息。",
                tool_evidence=[stock_evidence_item],
            ),
            "toolEvidence": [stock_evidence_item],
            "elapsedMs": 123,
        }
    ]))
    merged_stock_results = str(stock_delegate_payload.get("mergedToolResults") or "")
    _assert(
        "246.74 元" in merged_stock_results
        and "0.39%" in merged_stock_results
        and "1248.3 万手" in merged_stock_results,
        f"delegate merged tool results should preserve stock skill data: {stock_delegate_payload}",
    )
    _assert(
        stock_delegate_payload["toolEvidence"][0]["content"].find("当前股价：246.74 元") >= 0,
        f"delegate toolEvidence should expose compact raw skill output: {stock_delegate_payload}",
    )
    stock_context = compact_tool_result_for_context(
        tool_name="delegate_task",
        result=json.dumps(stock_delegate_payload, ensure_ascii=False),
        is_subagent=False,
        max_chars=DELEGATE_TOOL_CONTEXT_CHARS,
    )
    _assert(
        "当前股价：246.74 元" in stock_context and "成交量：1248.3 万手" in stock_context,
        f"Lead context should retain merged stock tool data: {stock_context}",
    )
    blocked_delegate_payload = dict(delegate_payload)
    blocked_delegate_payload["needsMoreTools"] = True
    _assert(
        not _delegate_result_has_sufficient_search(
            json.dumps(blocked_delegate_payload, ensure_ascii=False)
        ),
        "delegate result that still needs tools must not globally skip later fetch/extract",
    )

    async def fake_context_summarizer(messages):
        _assert(len(messages) >= 2, "compaction summarizer should receive old history")
        return "Decisions: keep the agent loop. Open work: finish context compression."

    long_history: list[dict] = []
    for idx in range(10):
        long_history.extend(
            [
                {"role": "user", "content": f"old request {idx} " + ("alpha " * 80)},
                {"role": "assistant", "content": f"old answer {idx} " + ("beta " * 80)},
            ]
        )
    long_history.extend(
        [
            {"role": "user", "content": "recent request"},
            {"role": "assistant", "content": "recent answer"},
            {"role": "user", "content": "latest question"},
        ]
    )
    compacted_history = await compact_history_if_needed(
        model="gpt-4o",
        history=long_history,
        max_output_tokens=100,
        token_budget=160,
        keep_recent_groups=3,
        summarizer=fake_context_summarizer,
    )
    _assert(compacted_history.compacted, "long history should trigger context compaction")
    _assert(
        compacted_history.messages[0].get("role") == "system"
        and CONTEXT_COMPRESSION_MARKER in str(compacted_history.messages[0].get("content")),
        f"compacted history should begin with summary marker: {compacted_history.messages}",
    )
    _assert(
        "old request 0" not in json.dumps(compacted_history.messages, ensure_ascii=False),
        "old verbatim turns should be replaced by the summary",
    )
    _assert(
        compacted_history.messages[-1].get("content") == "latest question",
        "latest user message must remain verbatim after compaction",
    )
    small_history = await compact_history_if_needed(
        model="gpt-4o",
        history=[{"role": "user", "content": "small"}],
        max_output_tokens=100,
        token_budget=10_000,
        keep_recent_groups=3,
        summarizer=fake_context_summarizer,
    )
    _assert(not small_history.compacted, "small history should not be compacted")
    _assert(
        small_history.messages == [{"role": "user", "content": "small"}],
        "small history should remain unchanged",
    )

    original_context_window = context_manager_module.get_model_context_window
    context_manager_module.get_model_context_window = lambda _model: 2100
    try:
        prepared_after_trim = prepare_messages(
            model="gpt-4o",
            system_prompt="System prompt.",
            history=[
                compacted_history.messages[0],
                {"role": "user", "content": "bulky recent turn " + ("gamma " * 3000)},
                {"role": "assistant", "content": "bulky recent answer " + ("delta " * 3000)},
                {"role": "user", "content": "final question"},
            ],
            max_output_tokens=100,
        )
    finally:
        context_manager_module.get_model_context_window = original_context_window
    _assert(
        any(CONTEXT_COMPRESSION_MARKER in str(message.get("content") or "")
            for message in prepared_after_trim),
        "sliding-window trimming must preserve the compaction summary",
    )
    original_acompletion = evidence_bundle_module.acompletion

    async def slow_distiller_call(**_kwargs):
        await asyncio.sleep(0.05)
        raise AssertionError("timeout should cancel slow distiller call")

    evidence_bundle_module.acompletion = slow_distiller_call
    try:
        timeout_bundle = await distill_evidence_bundle(
            litellm_model="eval-model",
            api_key="eval-key",
            api_base=None,
            task="查询杭州天气，包括温度和湿度",
            answer="杭州今天阴有阵雨。",
            tool_evidence=[evidence_item],
            timeout_seconds=0.01,
        )
    finally:
        evidence_bundle_module.acompletion = original_acompletion
    _assert("distiller_error" in timeout_bundle,
            f"slow evidence distiller should timeout into fallback evidence: {timeout_bundle}")

    # 30. FallbackPolicy sends failed Skill tools to the realtime research lane.
    fallback_decision = decide_fallback_policy(
        tool_name="skill_stock_quote",
        validation=ToolResultValidation(ok=False, reason="tool_failure", retryable=True),
    )
    _assert(
        fallback_decision.action == "switch_to_realtime_research"
        and not fallback_decision.retry_original_tool
        and "search.discovery" in fallback_decision.system_hint,
        f"Skill failures must switch to realtime research: {fallback_decision}",
    )

    print("Agent Harness eval passed: 31 cases")


if __name__ == "__main__":
    asyncio.run(main())
