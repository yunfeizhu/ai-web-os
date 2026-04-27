from __future__ import annotations

import hashlib
import re
from typing import Any


APP_LABELS: dict[str, str] = {
    "mail": "邮件",
    "calendar": "日历",
    "files": "文件",
    "documents": "文档",
    "notes": "笔记",
    "whiteboard": "白板",
}

APP_KEYWORDS: dict[str, tuple[str, ...]] = {
    "mail": ("邮件", "发邮件", "email", "mail"),
    "calendar": ("日历", "提醒", "日程", "calendar"),
    "files": ("文件", "/notes", "/documents", "file", "目录"),
    "documents": ("文档", "会议纪要", "报告", "document"),
    "notes": ("笔记", "todo", "notes"),
    "whiteboard": ("白板", "流程图", "结构图", "whiteboard"),
}

WRITE_KEYWORDS: tuple[str, ...] = (
    "写入",
    "保存",
    "创建",
    "新建",
    "修改",
    "更新",
    "删除",
    "发送",
    "发邮件",
    "导入",
    "导出",
)

MULTI_STEP_RE = re.compile(r"(然后|并且|并|同时|接着|最后|，.*，| and | then )", re.I)
DELEGATION_RE = re.compile(r"(调研|研究|对比|总结.*来源|多方面|分别|并行)")


def _matched_apps(message: str) -> list[str]:
    lower = message.lower()
    apps: list[str] = []
    for app_id, keywords in APP_KEYWORDS.items():
        if any(keyword.lower() in lower for keyword in keywords):
            apps.append(app_id)
    return apps


def _has_write_operation(message: str) -> bool:
    return any(keyword in message for keyword in WRITE_KEYWORDS)


def build_plan_preview(message: str) -> dict[str, Any] | None:
    text = str(message or "").strip()
    if not text:
        return None

    apps = _matched_apps(text)
    reasons: list[str] = []
    if len(apps) >= 2:
        reasons.append("multi_app")
    if _has_write_operation(text):
        reasons.append("write_operation")
    if MULTI_STEP_RE.search(text):
        reasons.append("multi_step")
    if DELEGATION_RE.search(text):
        reasons.append("delegation_candidate")

    if len(reasons) < 2:
        return None

    steps = [
        "确认任务目标、涉及的 App 和需要产出的结果。",
        "读取或检索必要上下文，优先使用本地 App / Skill / MCP 能力。",
        "按步骤执行工具调用；写入、发送、删除等风险操作会等待确认。",
        "汇总执行结果、失败点和后续可选动作。",
    ]

    return {
        "status": "plan_preview",
        "riskLevel": "confirmable" if "write_operation" in reasons else "low",
        "reasons": reasons,
        "apps": apps,
        "steps": steps,
    }


def build_multi_app_workflow_plan(message: str) -> dict[str, Any] | None:
    """Build a deterministic lightweight plan for requests spanning apps.

    This is intentionally a facade over the current ReAct loop: it does not
    execute anything or force routing. It gives the UI and checkpoint trace a
    stable, app-level view of what the agent is about to attempt.
    """
    preview = build_plan_preview(message)
    if not preview or "multi_app" not in preview.get("reasons", []):
        return None

    apps = list(preview.get("apps") or [])
    if len(apps) < 2:
        return None

    workflow_id = "wf_" + hashlib.sha1(str(message or "").encode("utf-8")).hexdigest()[:10]
    steps = [
        {
            "id": f"{workflow_id}_{index + 1}",
            "appId": app_id,
            "appName": APP_LABELS.get(app_id, app_id),
            "title": f"处理{APP_LABELS.get(app_id, app_id)}相关内容",
            "status": "pending",
        }
        for index, app_id in enumerate(apps)
    ]

    return {
        "status": "workflow_plan",
        "workflowId": workflow_id,
        "riskLevel": preview.get("riskLevel", "low"),
        "reasons": preview.get("reasons", []),
        "apps": [{"appId": app_id, "appName": APP_LABELS.get(app_id, app_id)} for app_id in apps],
        "steps": steps,
        "results": [],
        "appCount": len(apps),
        "completedSteps": 0,
        "failedSteps": 0,
        "pendingSteps": len(steps),
        "hasFailures": False,
    }


def _infer_file_app(args: dict[str, Any]) -> str:
    path = str(args.get("path") or "").replace("\\", "/").lower()
    if "/notes" in path or "note" in path or "todo" in path:
        return "notes"
    if "/documents" in path or "/docs" in path or "document" in path or "report" in path:
        return "documents"
    return "files"


def infer_app_from_tool_result(result: dict[str, Any]) -> str | None:
    name = str(result.get("name") or "").lower()
    display_name = str(result.get("displayName") or "").lower()
    args = result.get("args") if isinstance(result.get("args"), dict) else {}

    if name in {"list_files", "read_file", "write_file"}:
        return _infer_file_app(args)

    haystack = f"{name} {display_name}"
    for app_id, keywords in APP_KEYWORDS.items():
        if any(keyword.lower() in haystack for keyword in keywords):
            return app_id

    return None


def _preview_result_text(value: Any, max_chars: int = 120) -> str:
    text = str(value or "").strip()
    text = re.sub(r"\s+", " ", text)
    if len(text) <= max_chars:
        return text
    return text[: max_chars - 1].rstrip() + "…"


def build_workflow_summary(
    workflow_plan: dict[str, Any] | None,
    tool_results: list[dict[str, Any]],
) -> dict[str, Any] | None:
    """Summarize executed tool results by app for a multi-app workflow."""
    if not workflow_plan:
        return None

    plan_steps = workflow_plan.get("steps")
    if not isinstance(plan_steps, list) or not plan_steps:
        return None

    step_by_app: dict[str, dict[str, Any]] = {}
    steps: list[dict[str, Any]] = []
    for raw_step in plan_steps:
        if not isinstance(raw_step, dict):
            continue
        step = {**raw_step, "status": "pending"}
        app_id = str(step.get("appId") or "")
        if app_id:
            step_by_app[app_id] = step
        steps.append(step)

    results: list[dict[str, Any]] = []
    for tool_result in tool_results:
        if not isinstance(tool_result, dict):
            continue
        app_id = infer_app_from_tool_result(tool_result)
        if not app_id or app_id not in step_by_app:
            continue

        error = bool(tool_result.get("error"))
        step = step_by_app[app_id]
        if error:
            step["status"] = "failed"
        elif step.get("status") != "failed":
            step["status"] = "completed"

        results.append(
            {
                "id": tool_result.get("id"),
                "appId": app_id,
                "appName": step.get("appName") or APP_LABELS.get(app_id, app_id),
                "tool": tool_result.get("displayName") or tool_result.get("name"),
                "status": "failed" if error else "completed",
                "preview": _preview_result_text(tool_result.get("result")),
            }
        )

    completed = sum(1 for step in steps if step.get("status") == "completed")
    failed = sum(1 for step in steps if step.get("status") == "failed")
    pending = sum(1 for step in steps if step.get("status") == "pending")

    return {
        "status": "workflow_summary",
        "workflowId": workflow_plan.get("workflowId"),
        "riskLevel": workflow_plan.get("riskLevel", "low"),
        "apps": workflow_plan.get("apps", []),
        "steps": steps,
        "results": results,
        "appCount": len(steps),
        "completedSteps": completed,
        "failedSteps": failed,
        "pendingSteps": pending,
        "hasFailures": failed > 0,
    }
