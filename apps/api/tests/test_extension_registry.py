from types import SimpleNamespace

from app.core.extension_registry import (
    extension_validation_summary,
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
            "permissions": ["network", "subprocess"],
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
    assert summary["permissions"] == ["network", "subprocess"]
    assert summary["tools"][0]["name"] == "search"
    assert summary["validation"]["install"]["status"] == "ok"
    assert summary["validation"]["permissions"]["status"] == "ok"
    assert summary["validation"]["update"]["currentVersion"] == "1.0.0"


def test_serialize_mcp_app_warns_when_transport_permission_is_missing():
    app = SimpleNamespace(
        id="local-mcp",
        name="Local MCP",
        version="1.0.0",
        description="Local stdio tools",
        enabled=True,
        is_builtin=False,
        source_path="/home/user/.ai-native-os/mcp.json",
        status="inactive",
        manifest={
            "category": "automation",
            "permissions": [],
            "tools": [{"name": "run", "description": "Run command"}],
            "mcp": {"transport": "stdio"},
        },
        last_error=None,
    )

    summary = serialize_app_extension(app, {"status": "active"})

    assert summary["status"] == "ok"
    assert summary["validation"]["permissions"]["status"] == "warning"
    assert summary["validation"]["permissions"]["missing"] == ["subprocess"]


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


def test_serialize_builtin_app_without_runtime_as_available():
    app = SimpleNamespace(
        id="terminal",
        name="Terminal",
        version="1.0.0",
        description="Terminal app",
        enabled=True,
        is_builtin=True,
        source_path="/repo/apps_registry/terminal/manifest.json",
        status="inactive",
        manifest={
            "permissions": [],
            "tools": [],
            "mcp": {"transport": "builtin"},
        },
        last_error=None,
    )

    summary = serialize_app_extension(app, {"status": "inactive", "transport": None})

    assert summary["status"] == "ok"
    assert summary["runtimeStatus"] == "available"


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
        "primary_env_source": "declared",
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
    assert summary["validation"]["install"]["status"] == "ok"
    assert summary["validation"]["update"]["status"] == "warning"
    assert summary["validation"]["permissions"]["status"] == "ok"


def test_extension_validation_flags_inferred_skill_permissions_without_key():
    skill = {
        "id": "stock-skill",
        "name": "Stock Skill",
        "description": "Quote stocks",
        "enabled": True,
        "path": "/home/user/.ai-native-os/skills/user/stock/SKILL.md",
        "entrypoint": "SKILL.md",
        "skill_key": "stock",
        "primary_env": "STOCK_API_KEY",
        "primary_env_source": "inferred",
        "has_api_key": False,
        "version": "0.2.0",
    }

    summary = serialize_skill_extension(skill)

    assert summary["status"] == "ok"
    assert summary["validation"]["permissions"]["status"] == "warning"
    assert "API Key" in " ".join(summary["validation"]["permissions"]["issues"])


def test_extension_validation_summary_counts_install_update_and_permission_attention():
    summary = extension_validation_summary(
        [
            {
                "validation": {
                    "install": {"status": "ok"},
                    "update": {"status": "warning"},
                    "permissions": {"status": "ok"},
                }
            },
            {
                "validation": {
                    "install": {"status": "error"},
                    "update": {"status": "ok"},
                    "permissions": {"status": "warning"},
                }
            },
        ]
    )

    assert summary == {
        "installIssues": 1,
        "updateIssues": 1,
        "permissionIssues": 1,
    }
