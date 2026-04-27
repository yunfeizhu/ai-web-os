from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class EvalMetricCase:
    case_id: str
    category: str
    expected_tool: str | None
    actual_tool: str | None
    tool_result_ok: bool | None
    task_completed: bool


def _rate(numerator: int, denominator: int) -> float | None:
    if denominator <= 0:
        return None
    return numerator / denominator


def _summarize_group(cases: list[EvalMetricCase]) -> dict[str, Any]:
    tool_cases = [case for case in cases if case.tool_result_ok is not None]
    route_cases = [case for case in cases if case.expected_tool is not None]
    completed_cases = [case for case in cases if case.task_completed]
    successful_tool_cases = [case for case in tool_cases if case.tool_result_ok]
    correct_route_cases = [
        case for case in route_cases
        if case.expected_tool == case.actual_tool
    ]

    return {
        "totalCases": len(cases),
        "toolCalls": len(tool_cases),
        "successfulToolCalls": len(successful_tool_cases),
        "toolSuccessRate": _rate(len(successful_tool_cases), len(tool_cases)),
        "routeChecks": len(route_cases),
        "correctRoutes": len(correct_route_cases),
        "routeAccuracy": _rate(len(correct_route_cases), len(route_cases)),
        "completedTasks": len(completed_cases),
        "taskCompletionRate": _rate(len(completed_cases), len(cases)),
    }


def summarize_eval_metrics(cases: list[EvalMetricCase]) -> dict[str, Any]:
    by_category: dict[str, dict[str, Any]] = {}
    categories = sorted({case.category for case in cases})
    for category in categories:
        by_category[category] = _summarize_group([
            case for case in cases
            if case.category == category
        ])

    summary = _summarize_group(cases)
    summary["byCategory"] = by_category
    return summary
