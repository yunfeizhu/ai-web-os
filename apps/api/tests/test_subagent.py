import json
import asyncio

from app.core.evidence_bundle import (
    build_tool_evidence,
    fallback_evidence_bundle,
    normalize_evidence_bundle,
)
from app.core.llm_provider import _delegate_result_has_sufficient_search
from app.core.subagent import build_subagent_tool_result, run_subagents_parallel
from app.core.tool_capabilities import CAPABILITY_SEARCH_DISCOVERY


def test_run_subagents_parallel_reports_invalid_task_specs():
    async def collect_events():
        events = []
        async for event in run_subagents_parallel(
            [{"role": "research", "agent_name": "missing_task"}],
            model="gpt-4o",
            api_key="test-key",
        ):
            events.append(event)
        return events

    events = asyncio.run(collect_events())

    assert events
    event_type, payload = events[0]
    assert event_type == "subagent_result"
    assert payload["failed"] is True
    assert payload["error"] == "no_valid_subagent_tasks"


def test_tool_evidence_uses_capability_from_agent_loop_event():
    evidence = build_tool_evidence(
        {
            "name": "mcp_vendor_lookup",
            "displayName": "Vendor Lookup",
            "capability": CAPABILITY_SEARCH_DISCOVERY,
            "error": False,
            "result": json.dumps(
                {
                    "query": "ACME revenue",
                    "results": [
                        {
                            "title": "ACME revenue report",
                            "url": "https://example.test/acme",
                            "content": "ACME revenue was 42 million USD.",
                        }
                    ],
                }
            ),
        }
    )

    assert evidence is not None
    assert evidence["capability"] == CAPABILITY_SEARCH_DISCOVERY


def test_evidence_bundle_missing_fields_override_conflicting_sufficient_flag():
    bundle = normalize_evidence_bundle(
        {
            "summary": "Found partial ACME data.",
            "facts": [
                {
                    "field": "revenue",
                    "label": "revenue",
                    "value": "42 million USD",
                }
            ],
            "missing_fields": ["profit"],
            "capabilities_used": [CAPABILITY_SEARCH_DISCOVERY],
            "evidence_sufficient": True,
            "needs_more_tools": False,
        },
        task="查询 ACME revenue and profit",
        answer="Found partial ACME data.",
        tool_evidence=[],
    )

    assert bundle["evidence_sufficient"] is False
    assert bundle["needs_more_tools"] is False


def test_delegate_search_result_with_missing_required_fields_needs_more_tools():
    evidence = fallback_evidence_bundle(
        task="查询 ACME 2026 Q2 revenue and profit",
        answer="",
        tool_evidence=[
            {
                "tool": "mcp_tavily_search",
                "displayName": "Tavily Search",
                "capability": CAPABILITY_SEARCH_DISCOVERY,
                "error": False,
                "content": json.dumps(
                    {
                        "query": "ACME 2026 Q2 revenue profit",
                        "results": [
                            {
                                "title": "ACME company profile",
                                "url": "https://example.test/acme",
                                "content": "ACME is a manufacturing company.",
                            }
                        ],
                    }
                ),
            }
        ],
    )

    result = build_subagent_tool_result(
        [
            {
                "agentName": "research_acme",
                "role": "research",
                "task": "查询 ACME 2026 Q2 revenue and profit",
                "answer": "",
                "evidence": evidence,
                "toolEvidence": [
                    {
                        "tool": "mcp_tavily_search",
                        "displayName": "Tavily Search",
                        "capability": CAPABILITY_SEARCH_DISCOVERY,
                        "error": False,
                        "content": "result 1:\ntitle: ACME company profile\nurl: https://example.test/acme\nsnippet: ACME is a manufacturing company.",
                    }
                ],
                "failed": False,
            }
        ]
    )
    payload = json.loads(result)

    assert payload["evidenceSufficient"] is False
    assert payload["needsMoreTools"] is True
    assert "profit" in payload["missingFields"][0]["field"].lower()
    assert _delegate_result_has_sufficient_search(result) is False
