from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class SubagentToolEval:
    agent_name: str
    role: str
    tool: str
    ok: bool


@dataclass(frozen=True)
class MultiAgentEvalCase:
    case_id: str
    category: str
    expected_roles: list[str]
    actual_roles: list[str]
    subagent_tools: list[SubagentToolEval]
    task_completed: bool


def _rate(numerator: int, denominator: int) -> float | None:
    if denominator <= 0:
        return None
    return numerator / denominator


def _normalize_roles(roles: list[str]) -> list[str]:
    return sorted(str(role or "").strip().lower() for role in roles if str(role or "").strip())


def _delegation_correct(case: MultiAgentEvalCase) -> bool:
    return _normalize_roles(case.expected_roles) == _normalize_roles(case.actual_roles)


def _summarize_group(cases: list[MultiAgentEvalCase]) -> dict[str, Any]:
    delegation_checks = len(cases)
    correct_delegations = sum(1 for case in cases if _delegation_correct(case))
    tool_calls = [
        tool
        for case in cases
        for tool in case.subagent_tools
    ]
    successful_tools = [tool for tool in tool_calls if tool.ok]
    completed_tasks = [case for case in cases if case.task_completed]

    return {
        "totalCases": len(cases),
        "delegationChecks": delegation_checks,
        "correctDelegations": correct_delegations,
        "delegationAccuracy": _rate(correct_delegations, delegation_checks),
        "subagentToolCalls": len(tool_calls),
        "successfulSubagentToolCalls": len(successful_tools),
        "failedSubagentToolCalls": len(tool_calls) - len(successful_tools),
        "subagentToolSuccessRate": _rate(len(successful_tools), len(tool_calls)),
        "completedTasks": len(completed_tasks),
        "taskCompletionRate": _rate(len(completed_tasks), len(cases)),
    }


def summarize_multi_agent_eval_metrics(cases: list[MultiAgentEvalCase]) -> dict[str, Any]:
    by_category: dict[str, dict[str, Any]] = {}
    for category in sorted({case.category for case in cases}):
        by_category[category] = _summarize_group([
            case
            for case in cases
            if case.category == category
        ])

    summary = _summarize_group(cases)
    summary["byCategory"] = by_category
    return summary
