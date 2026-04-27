"""Offline baseline metrics for Agent Harness control-plane behavior."""

from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

os.environ.setdefault("LITELLM_LOCAL_MODEL_COST_MAP", "True")

from app.core.agent_eval_metrics import EvalMetricCase, summarize_eval_metrics  # noqa: E402
from app.core.agent_harness import validate_tool_result  # noqa: E402
from app.core.tools import get_tools_for_model  # noqa: E402


def _tool_names(tools: list[dict]) -> set[str]:
    return {
        str((tool.get("function") or {}).get("name") or "")
        for tool in tools
        if isinstance(tool, dict)
    }


async def build_offline_metric_cases() -> list[EvalMetricCase]:
    lead_tools = await get_tools_for_model(
        "gpt-4o",
        user_message="计算2+3",
        include_external_mcp=False,
    )
    lead_names = _tool_names(lead_tools)

    research_tools = await get_tools_for_model(
        "gpt-4o",
        user_message="查资料",
        skill_context={"agent_depth": 1, "agent_role": "research"},
        include_external_mcp=False,
    )
    research_names = _tool_names(research_tools)

    coder_tools = await get_tools_for_model(
        "gpt-4o",
        user_message="算一下",
        skill_context={"agent_depth": 1, "agent_role": "coder"},
        include_external_mcp=False,
    )
    coder_names = _tool_names(coder_tools)

    calculator_validation = validate_tool_result(
        tool_name="calculator",
        result="5",
        error=False,
    )
    fetch_validation = validate_tool_result(
        tool_name="fetch_url",
        result="Example page content",
        error=False,
    )

    return [
        EvalMetricCase(
            case_id="lead-calculator-route",
            category="tool-routing",
            expected_tool="calculator",
            actual_tool="calculator" if "calculator" in lead_names else None,
            tool_result_ok=calculator_validation.ok,
            task_completed="calculator" in lead_names and calculator_validation.ok,
        ),
        EvalMetricCase(
            case_id="lead-delegate-route",
            category="delegation",
            expected_tool="delegate_task",
            actual_tool="delegate_task" if "delegate_task" in lead_names else None,
            tool_result_ok=None,
            task_completed="delegate_task" in lead_names,
        ),
        EvalMetricCase(
            case_id="research-fetch-route",
            category="role-surface",
            expected_tool="fetch_url",
            actual_tool="fetch_url" if "fetch_url" in research_names else None,
            tool_result_ok=fetch_validation.ok,
            task_completed="fetch_url" in research_names
            and "python_exec" not in research_names
            and fetch_validation.ok,
        ),
        EvalMetricCase(
            case_id="coder-python-route",
            category="role-surface",
            expected_tool="python_exec",
            actual_tool="python_exec" if "python_exec" in coder_names else None,
            tool_result_ok=None,
            task_completed="python_exec" in coder_names
            and "fetch_url" not in coder_names,
        ),
    ]


async def main() -> None:
    cases = await build_offline_metric_cases()
    summary = summarize_eval_metrics(cases)
    summary["metricVersion"] = 1
    summary["caseIds"] = [case.case_id for case in cases]
    print(json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True))


if __name__ == "__main__":
    asyncio.run(main())
