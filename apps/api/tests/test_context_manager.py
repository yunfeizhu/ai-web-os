import json

from app.core.context_manager import compact_tool_result_for_context


def test_search_result_compaction_keeps_late_query_matched_passage():
    noisy_prefix = " ".join(f"navigation-{index}" for index in range(80))
    payload = {
        "query": "杭州 2026年6月24日 天气",
        "results": [
            {
                "title": "城市天气消息",
                "url": "https://example.test/weather",
                "content": (
                    f"{noisy_prefix}. 广州 GUANGZHOU 27 35 CLOUDY 多 云. "
                    "上海 SHANGHAI 22 24 RAIN 有 雨. "
                    "杭州 HANGZHOU 23 30 RAIN 有 雨. "
                    "福州 FUZHOU 28 37 CLOUDY 多 云."
                ),
            }
        ],
    }

    compacted = compact_tool_result_for_context(
        tool_name="mcp_tavily_search",
        result=json.dumps(payload, ensure_ascii=False),
        max_chars=1200,
    )

    assert "杭州 HANGZHOU 23 30 RAIN 有 雨" in compacted


def test_search_result_compaction_is_generic_for_non_weather_queries():
    noisy_prefix = " ".join(f"boilerplate-{index}" for index in range(80))
    payload = {
        "query": "ACME 2026 Q2 revenue",
        "results": [
            {
                "title": "ACME earnings archive",
                "url": "https://example.test/acme",
                "content": (
                    f"{noisy_prefix}. Historical overview and investor relations links. "
                    "ACME reported 2026 Q2 revenue of 42 million USD with positive guidance."
                ),
            }
        ],
    }

    compacted = compact_tool_result_for_context(
        tool_name="mcp_tavily_search",
        result=json.dumps(payload),
        max_chars=1200,
    )

    assert "ACME reported 2026 Q2 revenue of 42 million USD" in compacted
