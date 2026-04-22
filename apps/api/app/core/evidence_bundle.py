"""Structured evidence bundles for manager sub-agents.

Sub-agents can still produce a natural-language answer for UI/debugging, but the
Lead Agent should receive a stable evidence object: key facts, sources, missing
fields, and tool-capability metadata. This mirrors the "custom output extractor"
shape used by manager-style agent orchestration.
"""

from __future__ import annotations

import asyncio
import json
import re
from typing import Any

from litellm import acompletion

from app.core.context_manager import compact_tool_result_for_context
from app.core.tool_capabilities import CAPABILITY_SEARCH_DISCOVERY, infer_tool_capability


MAX_TOOL_EVIDENCE_ITEMS = 8
MAX_TOOL_EVIDENCE_CHARS = 1800
MAX_SOURCE_ITEMS = 8
MAX_FACT_ITEMS = 16
EVIDENCE_DISTILLER_TIMEOUT_SECONDS = 10.0


EVIDENCE_DISTILLER_SYSTEM_PROMPT = """\
You are an evidence distiller for a manager-style multi-agent system.
Return only valid JSON. Do not include markdown fences.

Task:
- Read the user's delegated task, the sub-agent's final answer, and compact tool evidence.
- Extract a generic evidence bundle. Do not invent facts.
- Trust compact tool evidence over the sub-agent's final answer when the answer omits a requested numeric/detail field.
- Treat fields requested by the task as required fields. Every requested field must either appear in facts or missing_fields.
- Each fact should include a short evidence quote/snippet and source_url when available.
- If search snippets already support the answer, set evidence_sufficient=true and needs_more_tools=false.
- Set needs_more_tools=true only when required fields are missing and the compact evidence is insufficient.

JSON shape:
{
  "summary": "short answer summary",
  "required_fields": [{"field": "stable_key", "label": "human label"}],
  "facts": [
    {
      "field": "stable_key",
      "label": "human label",
      "value": "fact value",
      "unit": "",
      "time": "",
      "location": "",
      "source_title": "",
      "source_url": "",
      "evidence": "short supporting snippet",
      "confidence": "high|medium|low"
    }
  ],
  "missing_fields": ["field or label"],
  "sources": [{"title": "", "url": "", "snippet": ""}],
  "capabilities_used": ["search.discovery"],
  "evidence_sufficient": true,
  "needs_more_tools": false
}
"""


def build_tool_evidence(payload: dict[str, Any]) -> dict[str, Any] | None:
    """Build a compact evidence record from a streamed tool_result payload."""
    if not isinstance(payload, dict):
        return None
    tool_name = str(payload.get("name") or "").strip()
    result = str(payload.get("result") or "").strip()
    if not tool_name or not result:
        return None

    display_name = str(payload.get("displayName") or "")
    capability = infer_tool_capability(tool_name, display_name)
    content = compact_tool_result_for_context(
        tool_name=tool_name,
        result=result,
        is_subagent=True,
        max_chars=MAX_TOOL_EVIDENCE_CHARS,
    )
    return {
        "tool": tool_name,
        "displayName": display_name,
        "capability": capability,
        "error": bool(payload.get("error")),
        "content": content,
    }


def fallback_evidence_bundle(
    *,
    task: str,
    answer: str,
    tool_evidence: list[dict[str, Any]],
    error: str | None = None,
) -> dict[str, Any]:
    """Return a conservative evidence bundle without calling a model."""
    raw = {
        "summary": answer,
        "required_fields": _infer_required_fields_from_task(task),
        "facts": [],
        "missing_fields": [],
        "sources": _sources_from_tool_evidence(tool_evidence),
        "capabilities_used": _capabilities_from_tool_evidence(tool_evidence),
        "evidence_sufficient": _has_non_error_evidence(tool_evidence),
        "needs_more_tools": False,
    }
    bundle = normalize_evidence_bundle(
        raw,
        task=task,
        answer=answer,
        tool_evidence=tool_evidence,
    )
    if error:
        bundle["distiller_error"] = error[:300]
    return bundle


async def distill_evidence_bundle(
    *,
    litellm_model: str,
    api_key: str,
    api_base: str | None,
    task: str,
    answer: str,
    tool_evidence: list[dict[str, Any]],
    max_tokens: int = 2048,
    timeout_seconds: float = EVIDENCE_DISTILLER_TIMEOUT_SECONDS,
) -> dict[str, Any]:
    """Use a low-temperature model call to extract a structured evidence bundle.

    The distiller is best-effort. If the provider rejects JSON-like prompting or
    the output is malformed, the caller still gets a conservative fallback.
    """
    evidence = tool_evidence[:MAX_TOOL_EVIDENCE_ITEMS]
    if not evidence:
        return fallback_evidence_bundle(task=task, answer=answer, tool_evidence=[])

    user_payload = {
        "delegated_task": task,
        "subagent_answer": answer,
        "tool_evidence": evidence,
    }
    kwargs: dict[str, Any] = {
        "model": litellm_model,
        "api_key": api_key,
        "messages": [
            {"role": "system", "content": EVIDENCE_DISTILLER_SYSTEM_PROMPT},
            {"role": "user", "content": json.dumps(user_payload, ensure_ascii=False)},
        ],
        "temperature": 0,
        "max_tokens": max(800, min(int(max_tokens), 2400)),
    }
    if api_base:
        kwargs["api_base"] = api_base

    try:
        response = await asyncio.wait_for(
            acompletion(**kwargs),
            timeout=max(1.0, float(timeout_seconds)),
        )
        content = str(response.choices[0].message.content or "")
        raw = extract_json_object(content)
        if raw is None:
            raise ValueError("distiller_returned_non_json")
        return normalize_evidence_bundle(
            raw,
            task=task,
            answer=answer,
            tool_evidence=evidence,
        )
    except Exception as exc:
        detail = str(exc).strip() or type(exc).__name__
        return fallback_evidence_bundle(
            task=task,
            answer=answer,
            tool_evidence=evidence,
            error=f"{type(exc).__name__}: {detail}",
        )


def extract_json_object(text: str) -> dict[str, Any] | None:
    """Extract the first JSON object from plain text or a fenced block."""
    source = str(text or "").strip()
    if not source:
        return None
    source = re.sub(r"^```(?:json)?\s*|\s*```$", "", source, flags=re.I | re.S).strip()
    try:
        parsed = json.loads(source)
        return parsed if isinstance(parsed, dict) else None
    except Exception:
        pass

    start = source.find("{")
    if start < 0:
        return None
    depth = 0
    in_string = False
    escape = False
    for index in range(start, len(source)):
        char = source[index]
        if in_string:
            if escape:
                escape = False
            elif char == "\\":
                escape = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                try:
                    parsed = json.loads(source[start : index + 1])
                    return parsed if isinstance(parsed, dict) else None
                except Exception:
                    return None
    return None


def normalize_evidence_bundle(
    raw: dict[str, Any],
    *,
    task: str,
    answer: str,
    tool_evidence: list[dict[str, Any]],
) -> dict[str, Any]:
    """Normalize arbitrary model output into the generic EvidenceBundle shape."""
    raw = raw if isinstance(raw, dict) else {}
    required_fields = _normalize_required_fields(
        raw.get("required_fields") or raw.get("requiredFields")
    )
    if not required_fields:
        required_fields = _infer_required_fields_from_task(task)

    facts = _merge_facts(
        _normalize_facts(raw.get("facts")),
        _facts_from_tool_evidence(task=task, tool_evidence=tool_evidence),
    )
    fact_fields = {
        str(fact.get("field") or fact.get("label") or "").strip().lower()
        for fact in facts
        if str(fact.get("value") or "").strip()
    }

    missing = _normalize_missing_fields(
        raw.get("missing_fields") or raw.get("missingFields")
    )
    missing_keys = {str(item).strip().lower() for item in missing}
    for field in required_fields:
        key = str(field.get("field") or field.get("label") or "").strip().lower()
        label = str(field.get("label") or field.get("field") or "").strip()
        if (
            key
            and key not in fact_fields
            and key not in missing_keys
            and not _required_field_covered_by_facts(field, facts)
        ):
            missing.append(label or key)
            missing_keys.add(key)

    sources = _normalize_sources(raw.get("sources"))
    if not sources:
        sources = _sources_from_tool_evidence(tool_evidence)

    capabilities = _normalize_string_list(
        raw.get("capabilities_used")
        or raw.get("capabilitiesUsed")
        or _capabilities_from_tool_evidence(tool_evidence)
    )
    if not capabilities:
        capabilities = _capabilities_from_tool_evidence(tool_evidence)

    summary = str(raw.get("summary") or raw.get("answer") or answer or "").strip()
    if not summary:
        summary = "No natural-language summary was produced."

    has_facts_or_sources = bool(facts or sources)
    evidence_sufficient = _as_bool(
        raw.get("evidence_sufficient", raw.get("evidenceSufficient")),
        default=has_facts_or_sources or _has_non_error_evidence(tool_evidence),
    )
    needs_more_tools = _as_bool(
        raw.get("needs_more_tools", raw.get("needsMoreTools")),
        default=bool(missing) and not evidence_sufficient,
    )

    return {
        "summary": summary[:4000],
        "required_fields": required_fields[:MAX_FACT_ITEMS],
        "facts": facts[:MAX_FACT_ITEMS],
        "missing_fields": missing[:MAX_FACT_ITEMS],
        "sources": sources[:MAX_SOURCE_ITEMS],
        "capabilities_used": capabilities,
        "evidence_sufficient": evidence_sufficient,
        "needs_more_tools": needs_more_tools,
    }


def _normalize_required_fields(value: Any) -> list[dict[str, str]]:
    fields: list[dict[str, str]] = []
    if not isinstance(value, list):
        return fields
    seen: set[str] = set()
    for item in value:
        if isinstance(item, dict):
            label = str(item.get("label") or item.get("field") or "").strip()
            field = str(item.get("field") or label).strip()
        else:
            label = str(item or "").strip()
            field = label
        if not label and not field:
            continue
        key = _stable_field_key(field or label)
        if key in seen:
            continue
        seen.add(key)
        fields.append({"field": key, "label": label or field or key})
    return fields


def _normalize_facts(value: Any) -> list[dict[str, str]]:
    if not isinstance(value, list):
        return []
    facts: list[dict[str, str]] = []
    for item in value:
        if isinstance(item, dict):
            label = str(item.get("label") or item.get("field") or "").strip()
            field = _stable_field_key(str(item.get("field") or label or "fact"))
            fact = {
                "field": field,
                "label": label or field,
                "value": str(item.get("value") or "").strip(),
                "unit": str(item.get("unit") or "").strip(),
                "time": str(item.get("time") or "").strip(),
                "location": str(item.get("location") or "").strip(),
                "source_title": str(item.get("source_title") or item.get("sourceTitle") or "").strip(),
                "source_url": str(item.get("source_url") or item.get("sourceUrl") or "").strip(),
                "evidence": str(item.get("evidence") or "").strip()[:600],
                "confidence": _normalize_confidence(item.get("confidence")),
            }
        else:
            text = str(item or "").strip()
            fact = {
                "field": "fact",
                "label": "fact",
                "value": text,
                "unit": "",
                "time": "",
                "location": "",
                "source_title": "",
                "source_url": "",
                "evidence": text[:600],
                "confidence": "low",
            }
        if fact["value"]:
            facts.append(fact)
    return facts


def _normalize_sources(value: Any) -> list[dict[str, str]]:
    if not isinstance(value, list):
        return []
    sources: list[dict[str, str]] = []
    seen: set[str] = set()
    for item in value:
        if isinstance(item, dict):
            url = str(item.get("url") or item.get("source_url") or "").strip()
            title = str(item.get("title") or item.get("source_title") or url).strip()
            snippet = str(item.get("snippet") or item.get("evidence") or "").strip()
        else:
            url = str(item or "").strip()
            title = url
            snippet = ""
        if not url and not title:
            continue
        key = url or title
        if key in seen:
            continue
        seen.add(key)
        sources.append({"title": title[:200], "url": url, "snippet": snippet[:500]})
    return sources[:MAX_SOURCE_ITEMS]


def _merge_facts(
    primary: list[dict[str, str]],
    fallback: list[dict[str, str]],
) -> list[dict[str, str]]:
    facts: list[dict[str, str]] = []
    seen: set[str] = set()
    for fact in [*primary, *fallback]:
        value = str(fact.get("value") or "").strip()
        if not value:
            continue
        source_url = str(fact.get("source_url") or fact.get("sourceUrl") or "").strip()
        field = str(fact.get("field") or fact.get("label") or "fact").strip()
        key = f"{field}\n{source_url}\n{value[:160]}".lower()
        if key in seen:
            continue
        seen.add(key)
        facts.append(fact)
        if len(facts) >= MAX_FACT_ITEMS:
            break
    return facts


def _facts_from_tool_evidence(
    *,
    task: str,
    tool_evidence: list[dict[str, Any]],
) -> list[dict[str, str]]:
    """Deterministically lift search results into facts.

    The model distiller may summarize poorly or timeout. Search titles/snippets
    are still evidence and should reach the Lead Agent as first-class facts.
    """
    facts: list[dict[str, str]] = []
    seen: set[str] = set()
    for record in _search_records_from_tool_evidence(tool_evidence):
        value = str(record.get("title") or record.get("answer") or record.get("snippet") or record.get("url") or "").strip()
        if not value:
            continue
        source_url = str(record.get("url") or "").strip()
        key = f"{source_url}\n{value[:180]}".lower()
        if key in seen:
            continue
        seen.add(key)

        field, label = _search_fact_kind(task, record)
        snippet = str(record.get("snippet") or record.get("answer") or value).strip()
        fact = {
            "field": field,
            "label": label,
            "value": value[:500],
            "unit": "",
            "time": str(record.get("date") or "").strip()[:120],
            "location": "",
            "source_title": str(record.get("title") or record.get("source_title") or "").strip()[:200],
            "source_url": source_url,
            "evidence": snippet[:600],
            "confidence": "medium",
        }
        facts.append(fact)
        if len(facts) >= MAX_FACT_ITEMS:
            break
    return facts


def _search_fact_kind(task: str, record: dict[str, str]) -> tuple[str, str]:
    if record.get("record_type") == "answer":
        return "search_answer", "搜索答案"

    text = str(task or "").lower()
    if any(term in text for term in ("新闻", "动态", "公告", "消息", "报道", "news")):
        return "news_item", "新闻/公告"
    if any(term in text for term in ("天气", "气温", "温度", "湿度", "风力", "weather")):
        return "weather_result", "天气搜索结果"
    if any(term in text for term in ("股票", "股价", "行情", "市值", "成交", "stock", "market")):
        return "market_result", "行情/市场搜索结果"
    return "search_result", "搜索结果"


def _search_records_from_tool_evidence(
    tool_evidence: list[dict[str, Any]],
) -> list[dict[str, str]]:
    records: list[dict[str, str]] = []
    for evidence in tool_evidence:
        if evidence.get("error"):
            continue
        content = str(evidence.get("content") or "").strip()
        if not content:
            continue
        capability = str(evidence.get("capability") or "").strip()
        if capability and capability != CAPABILITY_SEARCH_DISCOVERY:
            continue

        payload = _find_search_payload(content)
        if payload:
            records.extend(_search_records_from_payload(payload, evidence))
        else:
            records.extend(_search_records_from_compacted_text(content, evidence))
        if len(records) >= MAX_FACT_ITEMS:
            break
    return records[:MAX_FACT_ITEMS]


def _search_records_from_payload(
    payload: dict[str, Any],
    evidence: dict[str, Any],
) -> list[dict[str, str]]:
    records: list[dict[str, str]] = []
    answer = str(payload.get("answer") or "").strip()
    if _is_useful_search_answer(answer):
        records.append({
            "record_type": "answer",
            "answer": answer,
            "source_title": str(evidence.get("displayName") or evidence.get("tool") or "search")[:200],
        })

    results = _payload_results(payload)
    for item in results[:MAX_FACT_ITEMS]:
        record = _search_record_from_item(item)
        if record:
            records.append(record)
    return records


def _payload_results(payload: dict[str, Any]) -> list[Any]:
    for key in ("results", "organic_results", "items", "data"):
        value = payload.get(key)
        if isinstance(value, list):
            return value
    return []


def _search_record_from_item(item: Any) -> dict[str, str] | None:
    if not isinstance(item, dict):
        return None
    title = str(
        item.get("title")
        or item.get("name")
        or item.get("headline")
        or ""
    ).strip()
    url = str(item.get("url") or item.get("link") or item.get("href") or "").strip()
    snippet = str(
        item.get("content")
        or item.get("snippet")
        or item.get("description")
        or item.get("summary")
        or item.get("body")
        or item.get("text")
        or ""
    ).strip()
    date = str(
        item.get("published_date")
        or item.get("published")
        or item.get("date")
        or item.get("time")
        or item.get("created_at")
        or ""
    ).strip()
    if not (title or url or snippet):
        return None
    return {
        "record_type": "result",
        "title": title,
        "url": url,
        "snippet": " ".join(snippet.split()),
        "date": date,
    }


def _search_records_from_compacted_text(
    content: str,
    evidence: dict[str, Any],
) -> list[dict[str, str]]:
    records: list[dict[str, str]] = []
    current: dict[str, str] | None = None
    for raw_line in str(content or "").splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if re.match(r"^result\s+\d+\s*:\s*$", line, flags=re.I):
            if current and any(current.values()):
                records.append(current)
            current = {"record_type": "result", "title": "", "url": "", "date": "", "snippet": ""}
            continue
        if line.lower().startswith("answer:"):
            answer = line.split(":", 1)[1].strip()
            if _is_useful_search_answer(answer):
                records.append({
                    "record_type": "answer",
                    "answer": answer,
                    "source_title": str(evidence.get("displayName") or evidence.get("tool") or "search")[:200],
                })
            continue
        if current is None or ":" not in line:
            continue
        key, value = line.split(":", 1)
        key = key.strip().lower()
        value = value.strip()
        if key in {"title", "url", "date", "snippet"}:
            current[key] = value

    if current and any(current.values()):
        records.append(current)
    return records


def _find_search_payload(value: Any) -> dict[str, Any] | None:
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        try:
            parsed = json.loads(text)
        except Exception:
            parsed = extract_json_object(text)
        if parsed is None:
            return None
        return _find_search_payload(parsed)
    if isinstance(value, dict):
        if isinstance(value.get("results"), list) or _is_useful_search_answer(value.get("answer")):
            return value
        content = value.get("content")
        if isinstance(content, list):
            for item in content:
                nested = _find_search_payload(item)
                if nested:
                    return nested
        for key in ("text", "data", "payload", "result", "body"):
            nested = _find_search_payload(value.get(key))
            if nested:
                return nested
        for child in value.values():
            nested = _find_search_payload(child)
            if nested:
                return nested
    elif isinstance(value, list):
        for item in value:
            nested = _find_search_payload(item)
            if nested:
                return nested
    return None


def _is_useful_search_answer(value: Any) -> bool:
    text = str(value or "").strip()
    return bool(text and text.lower() not in {"none", "null", "false", "[]", "{}"})


def _required_field_covered_by_facts(
    field: dict[str, str],
    facts: list[dict[str, str]],
) -> bool:
    label = str(field.get("label") or field.get("field") or "").strip()
    key = _stable_field_key(str(field.get("field") or label))
    if not label and not key:
        return False

    haystack = "\n".join(
        " ".join(
            str(fact.get(part) or "")
            for part in ("field", "label", "value", "evidence", "source_title")
        )
        for fact in facts
    ).lower()
    compact_haystack = re.sub(r"\s+", "", haystack)
    compact_label = re.sub(r"[\s、，,;；。.\-_/]+", "", label.lower())
    if compact_label and compact_label in compact_haystack:
        return True
    if key and key in haystack:
        return True

    label_lower = label.lower()
    coverage_groups: tuple[tuple[tuple[str, ...], tuple[str, ...]], ...] = (
        (("新闻", "动态", "消息", "报道", "news"), ("news_item", "新闻", "动态", "公告", "报道", "消息")),
        (("公告", "披露"), ("公告", "披露", "上交所", "深交所")),
        (("市场表现", "行情", "股价", "市值"), ("市场", "行情", "股价", "涨", "跌", "市值", "成交", "分红", "股息")),
        (("行业",), ("行业", "白酒", "食品饮料", "市场")),
        (("温度", "气温", "temperature"), ("温度", "气温", "℃", "°c", "摄氏")),
        (("湿度", "humidity"), ("湿度", "humidity", "%")),
        (("风力", "风向", "风", "wind"), ("风力", "风向", "风", "级", "wind")),
        (("天气", "天气状况", "weather"), ("weather_result", "天气", "晴", "阴", "雨", "雪", "多云", "阵雨")),
    )
    for cues, evidence_terms in coverage_groups:
        if any(cue in label_lower for cue in cues):
            return any(term.lower() in haystack for term in evidence_terms)
    return False


def _normalize_missing_fields(value: Any) -> list[str]:
    return _normalize_string_list(value)


def _normalize_string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    out: list[str] = []
    seen: set[str] = set()
    for item in value:
        if isinstance(item, dict):
            text = str(item.get("label") or item.get("field") or item.get("value") or "").strip()
        else:
            text = str(item or "").strip()
        if not text:
            continue
        key = text.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(text)
    return out


def _infer_required_fields_from_task(task: str) -> list[dict[str, str]]:
    text = str(task or "")
    marker_match = re.search(r"(?:包括|包含|需要|查询|查一下|look up|include)(.+)", text, flags=re.I)
    segment = marker_match.group(1) if marker_match else text
    pieces = re.split(r"[、，,;；。.\n]|\s+(?:and|with)\s+|以及|还有|和", segment)
    fields: list[dict[str, str]] = []
    seen: set[str] = set()
    for piece in pieces:
        label = piece.strip(" ：:()（）[]【】")
        if not label or len(label) > 30:
            continue
        if any(skip in label.lower() for skip in ("http", "202", "当前日期", "task", "output")):
            continue
        key = _stable_field_key(label)
        if key in seen:
            continue
        seen.add(key)
        fields.append({"field": key, "label": label})
        if len(fields) >= 8:
            break
    return fields


def _sources_from_tool_evidence(tool_evidence: list[dict[str, Any]]) -> list[dict[str, str]]:
    sources: list[dict[str, str]] = []
    seen: set[str] = set()
    for evidence in tool_evidence:
        content = str(evidence.get("content") or "")
        for url in re.findall(r"https?://[^\s\"'<>),]+", content):
            clean_url = url.rstrip(".,;，。；")
            if clean_url in seen:
                continue
            seen.add(clean_url)
            sources.append({
                "title": str(evidence.get("displayName") or evidence.get("tool") or clean_url)[:200],
                "url": clean_url,
                "snippet": _snippet_around(content, clean_url),
            })
            if len(sources) >= MAX_SOURCE_ITEMS:
                return sources
    return sources


def _capabilities_from_tool_evidence(tool_evidence: list[dict[str, Any]]) -> list[str]:
    capabilities = sorted({
        str(item.get("capability") or "").strip()
        for item in tool_evidence
        if str(item.get("capability") or "").strip() and not item.get("error")
    })
    return capabilities


def _has_non_error_evidence(tool_evidence: list[dict[str, Any]]) -> bool:
    return any(str(item.get("content") or "").strip() and not item.get("error") for item in tool_evidence)


def _snippet_around(text: str, needle: str, radius: int = 180) -> str:
    index = text.find(needle)
    if index < 0:
        return text[: radius * 2].strip()
    start = max(0, index - radius)
    end = min(len(text), index + len(needle) + radius)
    return text[start:end].strip()


def _stable_field_key(value: str) -> str:
    raw = str(value or "").strip().lower()
    slug = re.sub(r"[^a-z0-9_\u4e00-\u9fff]+", "_", raw).strip("_")
    return slug[:60] or "field"


def _normalize_confidence(value: Any) -> str:
    text = str(value or "").strip().lower()
    if text in {"high", "medium", "low"}:
        return text
    return "medium"


def _as_bool(value: Any, *, default: bool) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        text = value.strip().lower()
        if text in {"true", "yes", "1"}:
            return True
        if text in {"false", "no", "0"}:
            return False
    return default
