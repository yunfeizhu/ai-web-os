from app.core.agent_eval_metrics import EvalMetricCase, summarize_eval_metrics


def test_summarize_eval_metrics_reports_core_agent_rates():
    summary = summarize_eval_metrics(
        [
            EvalMetricCase(
                case_id="calculator-route",
                category="tool-routing",
                expected_tool="calculator",
                actual_tool="calculator",
                tool_result_ok=True,
                task_completed=True,
            ),
            EvalMetricCase(
                case_id="file-route-miss",
                category="tool-routing",
                expected_tool="read_file",
                actual_tool="fetch_url",
                tool_result_ok=False,
                task_completed=False,
            ),
            EvalMetricCase(
                case_id="subagent-summary",
                category="delegation",
                expected_tool="delegate_task",
                actual_tool="delegate_task",
                tool_result_ok=True,
                task_completed=True,
            ),
        ]
    )

    assert summary["totalCases"] == 3
    assert summary["toolSuccessRate"] == 2 / 3
    assert summary["routeAccuracy"] == 2 / 3
    assert summary["taskCompletionRate"] == 2 / 3
    assert summary["byCategory"]["tool-routing"]["routeAccuracy"] == 0.5
    assert summary["byCategory"]["delegation"]["taskCompletionRate"] == 1.0


def test_summarize_eval_metrics_handles_cases_without_tool_expectations():
    summary = summarize_eval_metrics(
        [
            EvalMetricCase(
                case_id="plain-answer",
                category="conversation",
                expected_tool=None,
                actual_tool=None,
                tool_result_ok=None,
                task_completed=True,
            )
        ]
    )

    assert summary["totalCases"] == 1
    assert summary["toolSuccessRate"] is None
    assert summary["routeAccuracy"] is None
    assert summary["taskCompletionRate"] == 1.0
