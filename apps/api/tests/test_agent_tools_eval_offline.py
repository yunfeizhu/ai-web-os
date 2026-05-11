import asyncio
from types import SimpleNamespace

from app.core import app_registry as app_registry_module
from app.core import tools as tools_module
from app.core.app_registry import AppRegistry


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


def test_get_tools_for_model_exposes_notes_tools_with_memory_boundary(monkeypatch):
    async def fail_external_mcp_scan():
        raise AssertionError("external MCP routes should not be loaded in offline eval mode")

    monkeypatch.setattr(tools_module, "_list_external_mcp_tool_routes", fail_external_mcp_scan)

    tools = asyncio.run(
        tools_module.get_tools_for_model(
            "gpt-4o",
            user_message="帮我新建一篇笔记",
            include_external_mcp=False,
        )
    )

    by_name = {
        str((tool.get("function") or {}).get("name") or ""): tool
        for tool in tools
        if isinstance(tool, dict)
    }

    assert "list_notes" in by_name
    assert "save_note" in by_name
    assert "/Notes" in by_name["save_note"]["function"]["description"]


def test_get_tools_for_model_exposes_local_memory_tools(monkeypatch):
    async def fail_external_mcp_scan():
        raise AssertionError("external MCP routes should not be loaded in offline eval mode")

    monkeypatch.setattr(tools_module, "_list_external_mcp_tool_routes", fail_external_mcp_scan)

    tools = asyncio.run(
        tools_module.get_tools_for_model(
            "gpt-4o",
            user_message="你记得我是谁吗",
            include_external_mcp=False,
        )
    )

    by_name = {
        str((tool.get("function") or {}).get("name") or ""): tool
        for tool in tools
        if isinstance(tool, dict)
    }
    assert "memory_search" in by_name
    assert "memory_get" in by_name
    assert "local Markdown memory" in by_name["memory_search"]["function"]["description"]


def test_research_subagent_keeps_read_only_memory_tools(monkeypatch):
    async def fail_external_mcp_scan():
        raise AssertionError("external MCP routes should not be loaded in offline eval mode")

    monkeypatch.setattr(tools_module, "_list_external_mcp_tool_routes", fail_external_mcp_scan)

    tools = asyncio.run(
        tools_module.get_tools_for_model(
            "gpt-4o",
            user_message="整理用户长期偏好",
            skill_context={"agent_role": "research", "agent_depth": 1},
            include_external_mcp=False,
        )
    )

    names = {
        str((tool.get("function") or {}).get("name") or "")
        for tool in tools
        if isinstance(tool, dict)
    }
    assert "memory_search" in names
    assert "memory_get" in names
    assert "save_note" not in names


class _FakeAsyncSession:
    async def __aenter__(self):
        return object()

    async def __aexit__(self, exc_type, exc, tb):
        return False


class _FakeMCPRegistry:
    def __init__(self):
        self.fail_tavily = True
        self.apps = [
            SimpleNamespace(
                id="context7-mcp",
                name="Context7 MCP",
                is_builtin=False,
                enabled=True,
                manifest={"mcp": {"transport": "stdio"}},
            ),
            SimpleNamespace(
                id="tavily-mcp",
                name="TavilyMcp",
                is_builtin=False,
                enabled=True,
                manifest={"mcp": {"transport": "streamable-http"}},
            ),
        ]

    async def list_apps(self, db):
        return self.apps

    async def get_tools(self, db, app_id: str):
        if app_id == "tavily-mcp" and self.fail_tavily:
            raise RuntimeError("temporary Tavily startup failure")
        return [
            {
                "name": "query_docs" if app_id == "context7-mcp" else "tavily_search",
                "description": "Search web" if app_id == "tavily-mcp" else "Query docs",
                "inputSchema": {"type": "object", "properties": {"query": {"type": "string"}}},
            }
        ]


def test_external_mcp_routes_do_not_cache_partial_scan_failures(monkeypatch):
    registry = _FakeMCPRegistry()
    tools_module.invalidate_mcp_routes_cache()
    monkeypatch.setattr(tools_module, "get_app_registry", lambda: registry)
    monkeypatch.setattr(tools_module, "AsyncSessionLocal", lambda: _FakeAsyncSession())

    first_routes = asyncio.run(tools_module._list_external_mcp_tool_routes())
    assert {route["app_id"] for route in first_routes} == {"context7-mcp"}

    registry.fail_tavily = False
    second_routes = asyncio.run(tools_module._list_external_mcp_tool_routes())

    assert {route["app_id"] for route in second_routes} == {"context7-mcp", "tavily-mcp"}


def test_external_mcp_settings_update_invalidates_agent_route_cache(monkeypatch, tmp_path):
    registry = AppRegistry(tmp_path)
    manifest = {
        "id": "tavily-mcp",
        "name": "TavilyMcp",
        "mcp": {"transport": "streamable-http", "url": "https://example.test/mcp"},
        "permissions": ["network"],
    }
    app = SimpleNamespace(
        id="tavily-mcp",
        is_builtin=False,
        enabled=True,
        settings={},
        manifest=manifest,
    )
    invalidations: list[bool] = []

    async def fake_get_app(db, app_id: str):
        assert app_id == "tavily-mcp"
        return app

    async def fake_update_external_records(db, updater):
        return updater(
            [
                {
                    "id": "tavily-mcp",
                    "name": "TavilyMcp",
                    "enabled": True,
                    "settings": {},
                    "manifest": manifest,
                }
            ]
        )

    monkeypatch.setattr(registry, "get_app", fake_get_app)
    monkeypatch.setattr(registry, "_update_external_records", fake_update_external_records)
    monkeypatch.setattr(
        app_registry_module,
        "_invalidate_agent_mcp_routes_cache",
        lambda: invalidations.append(True),
    )

    updated = asyncio.run(
        registry.update_app_settings(object(), "tavily-mcp", {"mode": "search"})
    )

    assert updated.id == "tavily-mcp"
    assert invalidations == [True]
