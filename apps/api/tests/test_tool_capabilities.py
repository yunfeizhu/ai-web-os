import json

from app.core.tool_capabilities import (
    CAPABILITY_SEARCH_DISCOVERY,
    CAPABILITY_WEB_EXTRACT,
    build_discovery_sufficient_tool_result,
    build_search_sufficient_tool_result,
    filter_tools_by_disabled_capabilities,
    result_has_sufficient_discovery,
    should_stop_search_after_sufficient_discovery,
)


def test_generic_search_payload_with_two_sources_counts_as_sufficient_discovery():
    result = json.dumps(
        {
            "query": "美伊冲突 最新新闻",
            "results": [
                {
                    "title": "美伊冲突最新动态",
                    "url": "https://example.test/news-a",
                    "content": "双方围绕最新局势发表声明，市场关注后续外交动向。",
                },
                {
                    "title": "美伊局势新闻汇总",
                    "url": "https://example.test/news-b",
                    "content": "多家媒体报道相关军事和外交进展。",
                },
            ],
        },
        ensure_ascii=False,
    )

    assert result_has_sufficient_discovery(
        "mcp_tavily_search",
        result,
        "Search the web and return ranked results.",
        task_text="搜索目前美伊冲突的新闻",
    )


def test_temporal_field_query_is_not_sufficient_with_only_vague_trend_snippets():
    result = json.dumps(
        {
            "query": "杭州未来一周天气",
            "results": [
                {
                    "title": "杭州天气预报",
                    "url": "https://example.test/weather",
                    "content": "杭州未来一周多云转小雨，气温 18℃ 至 27℃。",
                },
                {
                    "title": "杭州一周天气趋势",
                    "url": "https://example.test/forecast",
                    "content": "未来7天有阵雨，东北风 3 级，空气质量良。",
                },
            ],
        },
        ensure_ascii=False,
    )

    assert result_has_sufficient_discovery(
        "mcp_tavily_search",
        result,
        "Search the web and return ranked results.",
        task_text="查一下杭州最近一周的天气",
    ) is False


def test_temporal_field_query_is_sufficient_with_dated_field_coverage():
    result = json.dumps(
        {
            "query": "杭州未来一周天气",
            "results": [
                {
                    "title": "杭州7天天气预报",
                    "url": "https://example.test/weather",
                    "content": "05-11 多云 20℃~32℃；05-12 小雨 18℃~25℃；05-13 阴 19℃~27℃。",
                },
                {
                    "title": "杭州一周天气趋势",
                    "url": "https://example.test/forecast",
                    "content": "05-14 阵雨 20℃~26℃；05-15 多云 21℃~29℃，东北风 3 级。",
                },
            ],
        },
        ensure_ascii=False,
    )

    assert result_has_sufficient_discovery(
        "mcp_tavily_search",
        result,
        "Search the web and return ranked results.",
        task_text="查一下杭州最近一周的天气",
    )


def test_answer_only_search_payload_counts_as_sufficient_discovery():
    result = json.dumps(
        {
            "content": [
                {
                    "type": "text",
                    "text": json.dumps(
                        {
                            "answer": "沪深300今日收盘上涨 1.2%，收于 3650 点，成交额较上一交易日放大。",
                        },
                        ensure_ascii=False,
                    ),
                }
            ]
        },
        ensure_ascii=False,
    )

    assert result_has_sufficient_discovery(
        "mcp_tavily_search",
        result,
        "Search the web and return ranked results.",
        task_text="查一下沪深300今天的收盘表现",
    )


def test_top_level_search_stops_after_sufficient_discovery_for_any_domain():
    assert should_stop_search_after_sufficient_discovery(
        tool_name="mcp_tavily_search",
        description="Search the web and return ranked results.",
        args={"query": "美伊冲突 最新新闻 2026年5月"},
        task_text="搜索目前美伊冲突的新闻",
        successful_search_count=1,
        is_subagent=False,
    )


def test_top_level_search_does_not_stop_when_user_needs_source_verification():
    assert not should_stop_search_after_sufficient_discovery(
        tool_name="mcp_tavily_search",
        description="Search the web and return ranked results.",
        args={"query": "美伊冲突 最新新闻 2026年5月"},
        task_text="搜索目前美伊冲突的新闻，并核验原文出处",
        successful_search_count=1,
        is_subagent=False,
    )


def test_policy_guard_results_do_not_expose_internal_guard_name():
    text = "\n".join(
        [
            build_search_sufficient_tool_result(1),
            build_discovery_sufficient_tool_result(1),
        ]
    )

    assert "ToolPolicyGuard" not in text
    assert "内部" in text


def test_filter_tools_by_disabled_capabilities_removes_only_matching_capabilities():
    tools = [
        {
            "type": "function",
            "function": {
                "name": "mcp_tavily_search",
                "description": "Search the web and return ranked results.",
                "parameters": {"type": "object", "properties": {"query": {"type": "string"}}},
            },
        },
        {
            "type": "function",
            "function": {
                "name": "mcp_tavily_extract",
                "description": "Extract markdown from URLs.",
                "parameters": {"type": "object", "properties": {"urls": {"type": "array"}}},
            },
        },
        {
            "type": "function",
            "function": {
                "name": "calculator",
                "description": "Evaluate a math expression.",
                "parameters": {"type": "object", "properties": {"expression": {"type": "string"}}},
            },
        },
    ]

    filtered = filter_tools_by_disabled_capabilities(
        tools,
        {
            CAPABILITY_SEARCH_DISCOVERY,
            CAPABILITY_WEB_EXTRACT,
        },
    )

    assert [tool["function"]["name"] for tool in filtered] == ["calculator"]
