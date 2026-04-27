from app.core.agent_plan import (
    build_multi_app_workflow_plan,
    build_plan_preview,
    build_workflow_summary,
)


def test_build_plan_preview_for_multi_app_write_task():
    preview = build_plan_preview(
        "帮我整理 /Notes/todo.md，生成会议纪要，然后发邮件给张三并创建明天下午的日历提醒"
    )

    assert preview is not None
    assert preview["status"] == "plan_preview"
    assert preview["riskLevel"] == "confirmable"
    assert "multi_app" in preview["reasons"]
    assert "write_operation" in preview["reasons"]
    assert len(preview["steps"]) >= 3


def test_build_plan_preview_skips_simple_questions():
    assert build_plan_preview("2+3 等于几") is None


def test_build_multi_app_workflow_plan_has_per_app_steps():
    plan = build_multi_app_workflow_plan(
        "读取 /Notes/todo.md，生成会议纪要，然后写入文档并创建明天下午的日历提醒"
    )

    assert plan is not None
    assert plan["status"] == "workflow_plan"
    assert [step["appId"] for step in plan["steps"]] == ["calendar", "files", "documents", "notes"]
    assert plan["riskLevel"] == "confirmable"
    assert plan["completedSteps"] == 0
    assert plan["pendingSteps"] == 4


def test_build_multi_app_workflow_summary_maps_tool_results_to_steps():
    plan = build_multi_app_workflow_plan(
        "读取 /Notes/todo.md，生成会议纪要，然后写入文档并创建明天下午的日历提醒"
    )

    summary = build_workflow_summary(
        plan,
        [
            {
                "id": "call_read",
                "name": "read_file",
                "displayName": "读取文件",
                "args": {"path": "/Notes/todo.md"},
                "result": "todo 内容",
                "error": False,
            },
            {
                "id": "call_write",
                "name": "write_file",
                "displayName": "写入文件",
                "args": {"path": "/Documents/meeting.md"},
                "result": "已写入 /Documents/meeting.md（120 bytes）",
                "error": False,
            },
            {
                "id": "call_calendar",
                "name": "mcp_calendar_create_event_12345678",
                "displayName": "Calendar",
                "args": {"title": "会议提醒"},
                "result": "created",
                "error": False,
            },
        ],
    )

    assert summary is not None
    assert summary["status"] == "workflow_summary"
    assert summary["completedSteps"] == 3
    assert summary["failedSteps"] == 0
    assert summary["pendingSteps"] == 1
    assert [result["appId"] for result in summary["results"]] == ["notes", "documents", "calendar"]
    assert summary["steps"][0]["status"] == "completed"
    assert summary["steps"][-1]["status"] == "completed"
