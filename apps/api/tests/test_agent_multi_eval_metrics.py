from app.core.agent_multi_eval_metrics import (
    MultiAgentEvalCase,
    SubagentToolEval,
    summarize_multi_agent_eval_metrics,
)


def test_summarize_multi_agent_eval_metrics_reports_delegation_and_e2e_rates():
    summary = summarize_multi_agent_eval_metrics(
        [
            MultiAgentEvalCase(
                case_id="research-delegation",
                category="delegation-routing",
                expected_roles=["research"],
                actual_roles=["research"],
                subagent_tools=[
                    SubagentToolEval(agent_name="news", role="research", tool="mcp_search", ok=True)
                ],
                task_completed=True,
            ),
            MultiAgentEvalCase(
                case_id="wrong-role",
                category="delegation-routing",
                expected_roles=["system"],
                actual_roles=["writer"],
                subagent_tools=[
                    SubagentToolEval(agent_name="draft", role="writer", tool="write_file", ok=False)
                ],
                task_completed=False,
            ),
        ]
    )

    assert summary["totalCases"] == 2
    assert summary["delegationChecks"] == 2
    assert summary["correctDelegations"] == 1
    assert summary["delegationAccuracy"] == 0.5
    assert summary["subagentToolCalls"] == 2
    assert summary["successfulSubagentToolCalls"] == 1
    assert summary["subagentToolSuccessRate"] == 0.5
    assert summary["completedTasks"] == 1
    assert summary["taskCompletionRate"] == 0.5
    assert summary["byCategory"]["delegation-routing"]["delegationAccuracy"] == 0.5


def test_summarize_multi_agent_eval_metrics_handles_no_tool_cases():
    summary = summarize_multi_agent_eval_metrics(
        [
            MultiAgentEvalCase(
                case_id="writer-only",
                category="writer",
                expected_roles=["writer"],
                actual_roles=["writer"],
                subagent_tools=[],
                task_completed=True,
            )
        ]
    )

    assert summary["delegationAccuracy"] == 1
    assert summary["subagentToolSuccessRate"] is None
    assert summary["taskCompletionRate"] == 1
