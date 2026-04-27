from types import SimpleNamespace

from app.core.extension_registry import (
    serialize_app_extension,
    serialize_skill_extension,
)


def test_serialize_external_mcp_app_as_extension_summary():
    app = SimpleNamespace(
        id="tavily-mcp",
        name="Tavily MCP",
        version="1.0.0",
        description="Search tools",
        enabled=True,
        is_builtin=False,
        source_path="/home/user/.ai-native-os/mcp.json",
        status="inactive",
        manifest={
            "category": "research",
            "permissions": ["network"],
            "tools": [{"name": "search", "description": "Search web"}],
            "mcp": {"transport": "stdio"},
        },
        last_error=None,
    )

    summary = serialize_app_extension(app, {"status": "active", "tool_count": 1})

    assert summary["id"] == "tavily-mcp"
    assert summary["kind"] == "mcp"
    assert summary["source"] == "local"
    assert summary["status"] == "ok"
    assert summary["runtimeStatus"] == "active"
    assert summary["permissions"] == ["network"]
    assert summary["tools"][0]["name"] == "search"


def test_serialize_builtin_app_as_extension_summary():
    app = SimpleNamespace(
        id="calendar",
        name="Calendar",
        version="0.1.0",
        description="Calendar app",
        enabled=True,
        is_builtin=True,
        source_path="",
        status="active",
        manifest={"permissions": ["calendar"], "tools": []},
        last_error=None,
    )

    summary = serialize_app_extension(app, {"status": "active"})

    assert summary["kind"] == "app"
    assert summary["source"] == "builtin"
    assert summary["status"] == "ok"


def test_serialize_skill_as_extension_summary():
    skill = {
        "id": "stock-skill",
        "name": "Stock Skill",
        "description": "Quote stocks",
        "enabled": True,
        "path": "/home/user/.ai-native-os/skills/user/stock/SKILL.md",
        "entrypoint": "main.py",
        "skill_key": "stock",
        "primary_env": "STOCK_API_KEY",
        "has_api_key": True,
        "updated_at": "2026-04-27T00:00:00Z",
    }

    summary = serialize_skill_extension(skill)

    assert summary["id"] == "stock-skill"
    assert summary["kind"] == "skill"
    assert summary["source"] == "local"
    assert summary["status"] == "ok"
    assert summary["permissions"] == ["env:STOCK_API_KEY"]
    assert summary["tools"][0]["name"] == "skill_stock"
