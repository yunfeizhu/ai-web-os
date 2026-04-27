import asyncio

from app.core import tools as tools_module


def test_get_tools_for_model_can_skip_external_mcp_scan(monkeypatch):
    async def fail_external_mcp_scan():
        raise AssertionError("external MCP routes should not be loaded in offline eval mode")

    monkeypatch.setattr(tools_module, "_list_external_mcp_tool_routes", fail_external_mcp_scan)

    tools = asyncio.run(
        tools_module.get_tools_for_model(
            "gpt-4o",
            user_message="计算2+3",
            include_external_mcp=False,
        )
    )

    names = {
        str((tool.get("function") or {}).get("name") or "")
        for tool in tools
        if isinstance(tool, dict)
    }
    assert {"calculator", "fetch_url", "python_exec", "read_file", "delegate_task"} <= names
