"""Tool capability inference and research-tool policy helpers.

The app can load tools from many sources: built-ins, browser tools, user Skills,
and arbitrary MCP servers. Prompting against provider-specific tool names does
not scale, so this module maps tool schemas to portable capabilities such as
``search.discovery`` and ``web.extract``.
"""

from __future__ import annotations

from copy import deepcopy
import json
import re
from typing import Any


CAPABILITY_SEARCH_DISCOVERY = "search.discovery"
CAPABILITY_WEB_FETCH = "web.fetch"
CAPABILITY_WEB_EXTRACT = "web.extract"
CAPABILITY_BROWSER_NAVIGATE = "browser.navigate"
CAPABILITY_DATA_API = "data.api"
CAPABILITY_KNOWLEDGE_RETRIEVE = "knowledge.retrieve"
CAPABILITY_COMPUTE = "compute"
CAPABILITY_FILESYSTEM = "filesystem"

WEB_CONTENT_CAPABILITIES = frozenset({
    CAPABILITY_WEB_FETCH,
    CAPABILITY_WEB_EXTRACT,
})

EXACT_SOURCE_TERMS = (
    "原文",
    "全文",
    "公告全文",
    "详细",
    "详情",
    "逐字",
    "引用",
    "出处",
    "核验",
    "核对",
    "验证",
    "来源冲突",
    "信息冲突",
    "结果冲突",
    "矛盾",
    "条款",
    "PDF",
    "pdf",
    "完整内容",
    "raw",
    "source text",
    "full text",
    "quote",
    "verify",
)

_POLICY_MARKER = "ToolUsePolicy:"

_WEATHER_TERMS = ("天气", "气温", "温度", "风力", "风向", "湿度", "weather")
_FIELD_PATTERNS: tuple[tuple[tuple[str, ...], tuple[str, ...]], ...] = (
    (
        ("温度", "气温", "temperature"),
        (r"温度", r"气温", r"\d+\s*(?:~|-|至|到)\s*\d+\s*℃", r"\d+\s*℃", r"°c"),
    ),
    (
        ("天气状况", "天气情况", "天气", "weather"),
        (r"晴", r"阴", r"多云", r"小雨", r"中雨", r"大雨", r"阵雨", r"雷阵雨", r"雨夹雪", r"雪", r"雾", r"霾"),
    ),
    (
        ("风力", "风向", "风", "wind"),
        (r"风力", r"风向", r"东风", r"南风", r"西风", r"北风", r"东北风", r"西北风", r"东南风", r"西南风", r"\d+\s*级"),
    ),
    (
        ("湿度", "humidity"),
        (r"湿度", r"相对湿度", r"\d+\s*%"),
    ),
    (
        ("空气质量", "空气", "aqi"),
        (r"空气质量", r"\baqi\b", r"优", r"良", r"轻度污染", r"中度污染", r"重度污染"),
    ),
)


def tool_schema_name(schema: dict[str, Any]) -> str:
    return str(((schema.get("function") or {}).get("name")) or "")


def tool_schema_description(schema: dict[str, Any]) -> str:
    return str(((schema.get("function") or {}).get("description")) or "")


def infer_tool_capability(
    tool_name: str,
    description: str | None = None,
    parameters: dict[str, Any] | None = None,
) -> str | None:
    """Infer a portable capability from a tool name, description, and schema."""
    name = str(tool_name or "").lower()
    desc = str(description or "").lower()
    props = ((parameters or {}).get("properties") or {}) if isinstance(parameters, dict) else {}
    prop_names = " ".join(str(key).lower() for key in props.keys())
    haystack = f"{name} {desc} {prop_names}"

    if name in {"calculator"} or "python_exec" in name:
        return CAPABILITY_COMPUTE
    if name in {"list_files", "read_file", "write_file"}:
        return CAPABILITY_FILESYSTEM
    if name == "retrieve_knowledge" or "knowledge" in name:
        return CAPABILITY_KNOWLEDGE_RETRIEVE
    if name == "query_weather" or name.startswith("skill_"):
        return CAPABILITY_DATA_API
    if name == "fetch_url":
        return CAPABILITY_WEB_FETCH

    if name.startswith("browser_"):
        if any(term in name for term in ("extract", "get_state")):
            return CAPABILITY_WEB_EXTRACT
        return CAPABILITY_BROWSER_NAVIGATE

    if any(
        term in haystack
        for term in (
            "extract",
            "scrape",
            "crawl",
            "reader",
            "read url",
            "read_url",
            "url content",
            "webpage content",
            "page content",
            "markdown from urls",
        )
    ):
        return CAPABILITY_WEB_EXTRACT

    if any(
        term in haystack
        for term in (
            "search",
            "searx",
            "query web",
            "web query",
            "find web",
            "web search",
            "internet search",
            "news search",
            "results",
        )
    ):
        return CAPABILITY_SEARCH_DISCOVERY

    if any(term in haystack for term in ("fetch", "download", "retrieve url", "open url")):
        return CAPABILITY_WEB_FETCH

    return None


def augment_tool_schema_with_capability(schema: dict[str, Any]) -> dict[str, Any]:
    """Return a copy of a function schema with capability-aware guidance.

    Extra metadata keys are intentionally not added to the schema sent to LLM
    providers; some OpenAI-compatible backends reject unknown keys.
    """
    out = deepcopy(schema)
    function = out.get("function") or {}
    if not isinstance(function, dict):
        return out

    name = str(function.get("name") or "")
    description = str(function.get("description") or "")
    parameters = function.get("parameters") if isinstance(function.get("parameters"), dict) else {}
    capability = infer_tool_capability(name, description, parameters)
    if not capability or _POLICY_MARKER in description:
        return out

    guidance = _capability_guidance(capability)
    if not guidance:
        return out

    function["description"] = f"{description}\n\n{_POLICY_MARKER} {guidance}".strip()
    out["function"] = function
    return out


def _capability_guidance(capability: str) -> str:
    if capability == CAPABILITY_SEARCH_DISCOVERY:
        return (
            "This is a lightweight discovery/search tool. Use it first for current "
            "information. If returned titles, URLs, dates, and snippets answer the "
            "task, summarize from them and do not fetch page bodies."
        )
    if capability in WEB_CONTENT_CAPABILITIES:
        return (
            "This reads full page/body content from known URLs. Use only when search "
            "snippets are insufficient, sources conflict, or the user needs original "
            "text, exact quotes, full documents, or fact verification."
        )
    return ""


def task_requires_full_content(*parts: Any) -> bool:
    text = " ".join(str(part or "") for part in parts)
    lowered = text.lower()
    return any(term.lower() in lowered for term in EXACT_SOURCE_TERMS)


def should_skip_content_fetch_after_search(
    *,
    tool_name: str,
    description: str | None = None,
    args: dict[str, Any] | None = None,
    task_text: str = "",
    successful_search_count: int = 0,
) -> bool:
    if successful_search_count <= 0:
        return False
    capability = infer_tool_capability(tool_name, description)
    if capability not in WEB_CONTENT_CAPABILITIES:
        return False
    args_text = json.dumps(args or {}, ensure_ascii=False)
    return not task_requires_full_content(task_text, args_text)


def build_search_sufficient_tool_result(successful_search_count: int) -> str:
    return (
        "内部执行提示：已有搜索发现结果覆盖当前任务的关键需求，"
        f"共 {successful_search_count} 组可用标题/链接/摘要证据。"
        "本轮不要再抓取网页正文，请基于已有搜索证据回答；如果摘要仍有不确定性，"
        "在最终回答中说明不确定性。不要向用户提及内部策略或工具控制规则。"
    )


def build_discovery_sufficient_tool_result(successful_search_count: int) -> str:
    return (
        "内部执行提示：已有搜索发现结果覆盖当前任务的关键需求，"
        f"共 {successful_search_count} 组可用标题/链接/摘要证据。"
        "本轮不要继续调用搜索发现工具，请基于已有证据回答；如果仍有不确定性，"
        "在最终回答中说明不确定性。不要向用户提及内部策略或工具控制规则。"
    )


def should_stop_search_after_sufficient_discovery(
    *,
    tool_name: str,
    description: str | None = None,
    args: dict[str, Any] | None = None,
    task_text: str = "",
    successful_search_count: int = 0,
    is_subagent: bool = False,
) -> bool:
    if successful_search_count <= 0:
        return False
    capability = infer_tool_capability(tool_name, description)
    if capability != CAPABILITY_SEARCH_DISCOVERY:
        return False
    args_text = json.dumps(args or {}, ensure_ascii=False)
    return not task_requires_full_content(task_text, args_text)


def filter_tools_by_disabled_capabilities(
    tools: list[dict[str, Any]],
    disabled_capabilities: set[str] | frozenset[str],
) -> list[dict[str, Any]]:
    """Return tools whose inferred capability is still available this turn.

    The OpenAI tool-calling pattern works best when unavailable actions are
    removed before the next model turn instead of asking the model not to call
    them. Unknown capabilities are kept so custom/local tools remain available.
    """
    if not disabled_capabilities:
        return tools

    filtered: list[dict[str, Any]] = []
    for tool in tools:
        name = tool_schema_name(tool)
        function = tool.get("function") or {}
        parameters = function.get("parameters") if isinstance(function, dict) else None
        capability = infer_tool_capability(name, tool_schema_description(tool), parameters)
        if capability in disabled_capabilities:
            continue
        filtered.append(tool)
    return filtered


def result_has_sufficient_discovery(
    tool_name: str,
    result: str,
    description: str | None = None,
    task_text: str = "",
) -> bool:
    if infer_tool_capability(tool_name, description) != CAPABILITY_SEARCH_DISCOVERY:
        return False
    payload = _find_search_payload(result)
    if not payload:
        return False
    query = str(payload.get("query") or "")
    answer = str(payload.get("answer") or "").strip()
    results = payload.get("results")
    task_query_text = f"{task_text}\n{query}"
    if not isinstance(results, list):
        if not _nonempty_search_answer(answer):
            return False
        if _requires_temporal_series(task_query_text) and not _has_temporal_series_evidence(answer):
            return False
        return _single_search_result_is_sufficient(
            task_text=task_query_text,
            evidence_text=answer,
            answer=answer,
        )
    useful = 0
    evidence_text_parts = [answer]
    combined_text_parts = [query, answer, task_text]
    for item in results:
        if not isinstance(item, dict):
            continue
        item_text = _search_result_item_text(item)
        if item_text:
            evidence_text_parts.append(item_text)
            combined_text_parts.append(item_text)
        if item.get("url") and item_text:
            useful += 1

    evidence_text = "\n".join(evidence_text_parts)
    if _requires_temporal_series(task_query_text) and not _has_temporal_series_evidence(evidence_text):
        return False

    requested = _requested_field_patterns(task_query_text)
    if requested:
        combined_text = "\n".join(combined_text_parts)
        covered = sum(1 for patterns in requested if _contains_any_pattern(combined_text, patterns))
        return useful >= 1 and covered >= len(requested)

    if useful >= 2:
        return True

    combined_text = "\n".join(combined_text_parts)
    if useful >= 1 and _single_search_result_is_sufficient(
        task_text=f"{task_text}\n{query}",
        evidence_text=combined_text,
        answer=answer,
    ):
        return True
    return False


def _search_result_item_text(item: dict[str, Any]) -> str:
    return " ".join(
        str(item.get(key) or "").strip()
        for key in ("title", "content", "snippet", "raw_content", "published_date", "date", "time")
        if str(item.get(key) or "").strip()
    )


def _single_search_result_is_sufficient(*, task_text: str, evidence_text: str, answer: str) -> bool:
    task = str(task_text or "")
    evidence = str(evidence_text or "")
    if _nonempty_search_answer(answer) and len(answer) >= 20:
        return True

    requested = _requested_field_patterns(task)
    if requested:
        covered = sum(1 for patterns in requested if _contains_any_pattern(evidence, patterns))
        return covered >= len(requested)

    if _looks_like_weather_query(f"{task}\n{evidence}"):
        weather_covered = sum(
            1
            for _terms, patterns in _FIELD_PATTERNS
            if _contains_any_pattern(evidence, patterns)
        )
        return weather_covered >= 2

    return False


def _nonempty_search_answer(answer: str) -> bool:
    text = str(answer or "").strip()
    return bool(text and text.lower() not in {"none", "null", "无", "n/a"})


def _requested_field_patterns(task_text: str) -> list[tuple[str, ...]]:
    lowered = str(task_text or "").lower()
    requested: list[tuple[str, ...]] = []
    seen: set[int] = set()
    for index, (terms, patterns) in enumerate(_FIELD_PATTERNS):
        if any(term.lower() in lowered for term in terms):
            if index not in seen:
                requested.append(patterns)
                seen.add(index)
    return requested


def _requires_temporal_series(task_text: str) -> bool:
    text = str(task_text or "")
    if not _requested_field_patterns(text):
        return False
    return bool(
        re.search(
            r"(最近|未来|过去|近|接下来|后续)?\s*(一周|1\s*周|七天|7\s*天|一星期)"
            r"|(?:每天|每日|逐日|按天|daily|day[-\s]?by[-\s]?day)"
            r"|(?:20\d{2}[-/.年]?\s*)?\d{1,2}\s*(?:月|[-/.])\s*\d{1,2}\s*(?:日|号)?\s*(?:到|至|~|-)\s*(?:20\d{2}[-/.年]?\s*)?\d{1,2}\s*(?:月|[-/.])\s*\d{1,2}",
            text,
            flags=re.I,
        )
    )


def _has_temporal_series_evidence(evidence_text: str) -> bool:
    text = str(evidence_text or "")
    markers: set[str] = set()
    for match in re.finditer(
        r"(?:20\d{2}[-/.年]\s*)?\d{1,2}\s*(?:月|[-/.])\s*\d{1,2}\s*(?:日|号)?"
        r"|周[一二三四五六日天]"
        r"|星期[一二三四五六日天]"
        r"|礼拜[一二三四五六日天]"
        r"|(?:今天|明天|后天|大后天)",
        text,
        flags=re.I,
    ):
        marker = re.sub(r"\s+", "", match.group(0)).lower()
        if marker:
            markers.add(marker)
    return len(markers) >= 3


def _looks_like_weather_query(text: str) -> bool:
    lowered = str(text or "").lower()
    return any(term.lower() in lowered for term in _WEATHER_TERMS)


def _contains_any_pattern(text: str, patterns: tuple[str, ...]) -> bool:
    source = str(text or "")
    lowered = source.lower()
    for pattern in patterns:
        if re.search(pattern, lowered, flags=re.I):
            return True
    return False


def json_result_has_partial_success(text: str) -> bool:
    """Return True when a result has both successes and failed_results."""
    for payload in _walk_jsonish(text):
        if not isinstance(payload, dict):
            continue
        results = payload.get("results")
        failed = payload.get("failed_results")
        if isinstance(results, list) and results and isinstance(failed, list) and failed:
            return True
    return False


def json_result_has_total_extract_failure(text: str) -> bool:
    for payload in _walk_jsonish(text):
        if not isinstance(payload, dict):
            continue
        results = payload.get("results")
        failed = payload.get("failed_results")
        if isinstance(results, list) and not results and isinstance(failed, list) and failed:
            return True
    return False


def _parse_jsonish(value: Any) -> Any | None:
    if isinstance(value, (dict, list)):
        return value
    if not isinstance(value, str):
        return None
    text = value.strip()
    if not text or text[0] not in "{[":
        return None
    try:
        return json.loads(text)
    except Exception:
        return None


def _walk_jsonish(value: Any):
    parsed = _parse_jsonish(value)
    if parsed is None:
        return
    yield parsed
    if isinstance(parsed, dict):
        for child in parsed.values():
            yield from _walk_jsonish(child)
    elif isinstance(parsed, list):
        for child in parsed:
            yield from _walk_jsonish(child)


def _find_search_payload(value: Any) -> dict[str, Any] | None:
    answer_payload: dict[str, Any] | None = None
    for payload in _walk_jsonish(value):
        if not isinstance(payload, dict):
            continue
        if isinstance(payload.get("results"), list):
            return payload
        if answer_payload is None and _nonempty_search_answer(str(payload.get("answer") or "")):
            answer_payload = payload
    return answer_payload


def normalize_url_before_extract(url: str) -> str:
    """Small, conservative URL cleanups before page extraction."""
    text = str(url or "").strip()
    if "weather.com.cn/weather1d/" in text and text.endswith(".shtm"):
        return f"{text}l"
    return text


def normalize_extract_args(args: dict[str, Any]) -> dict[str, Any]:
    next_args = dict(args or {})
    urls = next_args.get("urls")
    if isinstance(urls, list):
        next_args["urls"] = [
            normalize_url_before_extract(str(url))
            for url in urls
            if str(url or "").strip()
        ]
    elif isinstance(next_args.get("url"), str):
        next_args["url"] = normalize_url_before_extract(str(next_args["url"]))
    return next_args
