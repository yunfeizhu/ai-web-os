from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
import threading
from typing import Any


@dataclass(frozen=True)
class AgentTrafficRecord:
    request_id: str
    conversation_id: str
    app_id: str
    provider_id: str
    model: str
    user_message_chars: int
    response_chars: int
    tool_calls: int
    successful_tool_calls: int
    failed_tool_calls: int
    route_checks: int
    correct_routes: int
    task_completed: bool
    planned: bool
    multi_app: bool
    delegated: bool
    succeeded: bool
    error: str | None = None
    created_at: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )


def _rate(numerator: int, denominator: int) -> float | None:
    if denominator <= 0:
        return None
    return numerator / denominator


def _status_is_route_problem(event: dict[str, Any]) -> bool:
    status = str(event.get("status") or "")
    node = str(event.get("node") or "")
    decision = str(event.get("decision") or "")
    if status == "tool_policy" and decision == "rejected":
        return True
    if node == "policy_guard" and decision == "rejected":
        return True
    if node == "validate_result" and bool(event.get("error")):
        return True
    return False


def build_agent_traffic_record(
    *,
    request_id: str,
    conversation_id: str,
    app_id: str | None,
    provider_id: str,
    model: str,
    user_message: str,
    response_text: str,
    tool_calls: list[dict[str, Any]],
    tool_results: list[dict[str, Any]],
    status_events: list[dict[str, Any]],
    succeeded: bool,
    error: str | None = None,
) -> AgentTrafficRecord:
    successful_tool_calls = sum(
        1 for result in tool_results
        if isinstance(result, dict) and not bool(result.get("error"))
    )
    failed_tool_calls = sum(
        1 for result in tool_results
        if isinstance(result, dict) and bool(result.get("error"))
    )
    route_problems = sum(
        1 for event in status_events
        if isinstance(event, dict) and _status_is_route_problem(event)
    )
    route_checks = len(tool_calls)
    correct_routes = max(0, route_checks - route_problems)
    response = str(response_text or "").strip()

    return AgentTrafficRecord(
        request_id=str(request_id or ""),
        conversation_id=str(conversation_id or ""),
        app_id=str(app_id or "unknown"),
        provider_id=str(provider_id or "unknown"),
        model=str(model or "unknown"),
        user_message_chars=len(str(user_message or "")),
        response_chars=len(response),
        tool_calls=len(tool_calls),
        successful_tool_calls=successful_tool_calls,
        failed_tool_calls=failed_tool_calls,
        route_checks=route_checks,
        correct_routes=correct_routes,
        task_completed=bool(succeeded and response),
        planned=any(
            isinstance(event, dict) and event.get("status") == "plan_preview"
            for event in status_events
        ),
        multi_app=any(
            isinstance(event, dict)
            and event.get("status") in {"workflow_plan", "workflow_summary"}
            for event in status_events
        ),
        delegated=any(
            isinstance(call, dict) and call.get("name") == "delegate_task"
            for call in tool_calls
        ),
        succeeded=bool(succeeded),
        error=str(error) if error else None,
    )


class AgentTrafficMetricsStore:
    def __init__(self, max_records: int = 500) -> None:
        self._records: deque[AgentTrafficRecord] = deque(maxlen=max_records)
        self._lock = threading.Lock()

    def record(self, record: AgentTrafficRecord) -> None:
        with self._lock:
            self._records.append(record)

    def clear(self) -> None:
        with self._lock:
            self._records.clear()

    def summary(self, *, recent_limit: int = 20) -> dict[str, Any]:
        with self._lock:
            records = list(self._records)

        return _summarize_records(records, recent_limit=recent_limit)


def _summarize_records(
    records: list[AgentTrafficRecord],
    *,
    recent_limit: int,
    include_groups: bool = True,
) -> dict[str, Any]:
    total_requests = len(records)
    completed_tasks = sum(1 for record in records if record.task_completed)
    tool_calls = sum(record.tool_calls for record in records)
    successful_tool_calls = sum(record.successful_tool_calls for record in records)
    failed_tool_calls = sum(record.failed_tool_calls for record in records)
    route_checks = sum(record.route_checks for record in records)
    correct_routes = sum(record.correct_routes for record in records)

    recent_records = records[-recent_limit:][::-1] if recent_limit > 0 else []
    summary = {
        "metricVersion": 1,
        "windowSize": total_requests,
        "totalRequests": total_requests,
        "completedTasks": completed_tasks,
        "taskCompletionRate": _rate(completed_tasks, total_requests),
        "toolCalls": tool_calls,
        "successfulToolCalls": successful_tool_calls,
        "failedToolCalls": failed_tool_calls,
        "toolSuccessRate": _rate(successful_tool_calls, tool_calls),
        "routeChecks": route_checks,
        "correctRoutes": correct_routes,
        "routeAccuracy": _rate(correct_routes, route_checks),
        "routeAccuracySource": "policy_validation_proxy",
        "plannedRequests": sum(1 for record in records if record.planned),
        "multiAppRequests": sum(1 for record in records if record.multi_app),
        "delegatedRequests": sum(1 for record in records if record.delegated),
        "failedRequests": sum(1 for record in records if not record.succeeded),
        "recent": [
            _serialize_record(record)
            for record in recent_records
        ],
    }
    if include_groups:
        summary["byProvider"] = _summarize_by(records, "provider_id")
        summary["byModel"] = _summarize_by(records, "model")
        summary["byApp"] = _summarize_by(records, "app_id")
    return summary


def _summarize_by(
    records: list[AgentTrafficRecord],
    attr: str,
) -> dict[str, dict[str, Any]]:
    grouped: dict[str, list[AgentTrafficRecord]] = {}
    for record in records:
        key = str(getattr(record, attr) or "unknown")
        grouped.setdefault(key, []).append(record)
    return {
        key: _summarize_records(
            group_records,
            recent_limit=0,
            include_groups=False,
        )
        for key, group_records in sorted(grouped.items())
    }


def _serialize_record(record: AgentTrafficRecord) -> dict[str, Any]:
    return {
        "requestId": record.request_id,
        "conversationId": record.conversation_id,
        "appId": record.app_id,
        "providerId": record.provider_id,
        "model": record.model,
        "userMessageChars": record.user_message_chars,
        "responseChars": record.response_chars,
        "toolCalls": record.tool_calls,
        "successfulToolCalls": record.successful_tool_calls,
        "failedToolCalls": record.failed_tool_calls,
        "routeChecks": record.route_checks,
        "correctRoutes": record.correct_routes,
        "taskCompleted": record.task_completed,
        "planned": record.planned,
        "multiApp": record.multi_app,
        "delegated": record.delegated,
        "succeeded": record.succeeded,
        "error": record.error,
        "createdAt": record.created_at,
    }


_TRAFFIC_METRICS_STORE = AgentTrafficMetricsStore()


def get_agent_traffic_metrics_store() -> AgentTrafficMetricsStore:
    return _TRAFFIC_METRICS_STORE
