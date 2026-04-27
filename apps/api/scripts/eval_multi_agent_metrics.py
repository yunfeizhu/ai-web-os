"""Offline Multi-Agent 2.0 eval metrics.

These checks are deterministic and do not call an LLM. They evaluate the
manager/sub-agent control-plane contract: role delegation, sub-agent tool
success, and end-to-end synthesis readiness.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

os.environ.setdefault("LITELLM_LOCAL_MODEL_COST_MAP", "True")

from app.core.agent_multi_eval_metrics import (  # noqa: E402
    MultiAgentEvalCase,
    SubagentToolEval,
    summarize_multi_agent_eval_metrics,
)
from app.core.evidence_bundle import fallback_evidence_bundle  # noqa: E402
from app.core.subagent import build_subagent_tool_result, normalize_subagent_specs  # noqa: E402


def _roles_from_specs(specs: list[dict]) -> list[str]:
    return [spec["role"] for spec in normalize_subagent_specs(specs)]


def _delegate_completed(payload: dict) -> bool:
    return (
        payload.get("mode") == "manager_subagents"
        and not payload.get("failed")
        and bool(payload.get("agents"))
    )


def build_multi_agent_metric_cases() -> list[MultiAgentEvalCase]:
    research_specs = [
        {
            "agent": "search",
            "task": "搜索贵州茅台最新公告并给出来源",
            "agent_name": "news_research",
        }
    ]
    research_payload = json.loads(build_subagent_tool_result([
        {
            "agentName": "news_research",
            "role": "research",
            "task": "搜索贵州茅台最新公告并给出来源",
            "answer": "找到公告来源。",
            "failed": False,
            "toolEvidence": [
                {
                    "tool": "mcp_search",
                    "displayName": "Search",
                    "capability": "search.discovery",
                    "error": False,
                    "content": "贵州茅台年度报告 https://example.com/moutai",
                }
            ],
            "evidence": fallback_evidence_bundle(
                task="搜索贵州茅台最新公告并给出来源",
                answer="找到公告来源。",
                tool_evidence=[
                    {
                        "tool": "mcp_search",
                        "displayName": "Search",
                        "capability": "search.discovery",
                        "error": False,
                        "content": "贵州茅台年度报告 https://example.com/moutai",
                    }
                ],
            ),
        }
    ]))

    parallel_specs = [
        {"role": "research", "task": "查找天气事实", "agent_name": "weather"},
        {"agent": "python", "task": "计算平均温度", "agent_name": "calc"},
        {"role": "writing", "task": "整理最终摘要", "agent_name": "summary"},
    ]
    parallel_payload = json.loads(build_subagent_tool_result([
        {
            "agentName": "weather",
            "role": "research",
            "task": "查找天气事实",
            "answer": "天气证据充分。",
            "failed": False,
            "toolEvidence": [
                {
                    "tool": "mcp_weather_search",
                    "displayName": "Weather Search",
                    "capability": "search.discovery",
                    "error": False,
                    "content": "杭州天气 15℃ ~ 20℃",
                }
            ],
        },
        {
            "agentName": "calc",
            "role": "coder",
            "task": "计算平均温度",
            "answer": "平均温度 17.5℃。",
            "failed": False,
            "toolEvidence": [
                {
                    "tool": "calculator",
                    "displayName": "Calculator",
                    "capability": "",
                    "error": False,
                    "content": "17.5",
                }
            ],
        },
        {
            "agentName": "summary",
            "role": "writer",
            "task": "整理最终摘要",
            "answer": "适合用简洁中文总结。",
            "failed": False,
            "toolEvidence": [],
        },
    ]))

    system_specs = [
        {"agent_role": "file", "task": "读取 /Notes/todo.md", "agent_name": "files"}
    ]
    system_payload = json.loads(build_subagent_tool_result([
        {
            "agentName": "files",
            "role": "system",
            "task": "读取 /Notes/todo.md",
            "answer": "已读取文件。",
            "failed": False,
            "toolEvidence": [
                {
                    "tool": "read_file",
                    "displayName": "Read File",
                    "capability": "",
                    "error": False,
                    "content": "todo content",
                }
            ],
        }
    ]))

    return [
        MultiAgentEvalCase(
            case_id="research-delegation-role",
            category="delegation-routing",
            expected_roles=["research"],
            actual_roles=_roles_from_specs(research_specs),
            subagent_tools=[
                SubagentToolEval("news_research", "research", "mcp_search", True)
            ],
            task_completed=_delegate_completed(research_payload),
        ),
        MultiAgentEvalCase(
            case_id="parallel-specialists",
            category="parallel-orchestration",
            expected_roles=["research", "coder", "writer"],
            actual_roles=_roles_from_specs(parallel_specs),
            subagent_tools=[
                SubagentToolEval("weather", "research", "mcp_weather_search", True),
                SubagentToolEval("calc", "coder", "calculator", True),
            ],
            task_completed=_delegate_completed(parallel_payload),
        ),
        MultiAgentEvalCase(
            case_id="system-agent-file-task",
            category="system-delegation",
            expected_roles=["system"],
            actual_roles=_roles_from_specs(system_specs),
            subagent_tools=[
                SubagentToolEval("files", "system", "read_file", True)
            ],
            task_completed=_delegate_completed(system_payload),
        ),
    ]


def main() -> None:
    cases = build_multi_agent_metric_cases()
    summary = summarize_multi_agent_eval_metrics(cases)
    summary["metricVersion"] = 1
    summary["caseIds"] = [case.case_id for case in cases]
    print(json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
