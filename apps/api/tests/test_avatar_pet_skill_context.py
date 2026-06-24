import asyncio
import json
from pathlib import Path
from types import SimpleNamespace

from app.core.app_registry import AppRegistry
from app.core import skill_context
from app.core.app_manifest import normalize_manifest
from app.core.skill_context import _build_entry_app_context, _should_inject_full_skill


def test_current_time_context_treats_runtime_date_as_authoritative():
    rendered = skill_context._current_time_context()

    assert "权威时间" in rendered
    assert "不要用训练数据、外部常识或现实日历去质疑" in rendered
    assert "未来/测试日期" in rendered


def test_skill_descriptor_preserves_full_skill_prompt_flag(tmp_path):
    app_dir = tmp_path / "avatar-pet"
    app_dir.mkdir()
    manifest_path = app_dir / "manifest.json"
    manifest_path.write_text("{}", encoding="utf-8")
    (app_dir / "SKILL.md").write_text(
        "---\nname: 虚拟伙伴\ndescription: Live2D companion\n---\n## 人设\n",
        encoding="utf-8",
    )
    registry = AppRegistry(tmp_path)

    descriptor = registry._build_skill_descriptor(
        manifest_path,
        {"entrypoint": "SKILL.md", "inject_full_prompt": True},
    )

    assert descriptor is not None
    assert descriptor["inject_full_prompt"] is True


def test_skill_descriptor_preserves_explicit_false_full_skill_prompt_flag(tmp_path):
    app_dir = tmp_path / "notes"
    app_dir.mkdir()
    manifest_path = app_dir / "manifest.json"
    manifest_path.write_text("{}", encoding="utf-8")
    (app_dir / "SKILL.md").write_text(
        "---\nname: 笔记\ndescription: Notes\n---\n## 规则\n",
        encoding="utf-8",
    )
    registry = AppRegistry(tmp_path)

    descriptor = registry._build_skill_descriptor(
        manifest_path,
        {"entrypoint": "SKILL.md", "inject_full_prompt": False},
    )

    assert descriptor is not None
    assert descriptor["inject_full_prompt"] is False


def test_prompt_uses_synced_manifest_for_full_skill_injection(monkeypatch):
    class FakeRegistry:
        async def get_app(self, db, app_id):
            return SimpleNamespace(
                id=app_id,
                name="虚拟伙伴",
                enabled=True,
                manifest={"description": "Live2D companion", "skill": {}},
            )

        async def get_skill(self, db, app_id):
            return {
                "metadata": {
                    "name": "虚拟伙伴",
                    "description": "Live2D companion",
                },
                "content": "## 人设\n你叫「小月」。",
            }

        async def list_apps(self, db):
            return [
                SimpleNamespace(
                    id="avatar-pet",
                    name="虚拟伙伴",
                    enabled=True,
                    manifest={
                        "description": "Live2D companion",
                        "skill": {"inject_full_prompt": True},
                        "tools": [],
                    },
                )
            ]

        def list_user_skills(self, *, enabled_only=False):
            return []

    monkeypatch.setattr(skill_context, "get_app_registry", lambda: FakeRegistry())

    prompt, context = asyncio.run(
        skill_context.build_skill_augmented_system_prompt(
            None,
            "Base prompt",
            "你好",
            requested_app_id="avatar-pet",
        )
    )

    assert context["entry_app_id"] == "avatar-pet"
    assert "## 当前 App 完整行为规则" in prompt
    assert "你叫「小月」。" in prompt


def test_normalize_manifest_preserves_full_skill_prompt_flag():
    manifest = normalize_manifest(
        {
            "id": "avatar-pet",
            "name": "虚拟伙伴",
            "version": "1.0.0",
            "description": "Live2D companion",
            "mcp": {"transport": "builtin"},
            "skill": {
                "entrypoint": "SKILL.md",
                "format": "skill-md",
                "inject_full_prompt": True,
            },
        },
        builtin=True,
    )

    assert manifest["skill"] == {
        "entrypoint": "SKILL.md",
        "format": "skill-md",
        "inject_full_prompt": True,
    }


def test_string_false_full_skill_prompt_flag_normalizes_to_false():
    manifest = normalize_manifest(
        {
            "id": "notes",
            "name": "笔记",
            "skill": {"entrypoint": "SKILL.md", "inject_full_prompt": "false"},
        },
        builtin=True,
    )

    assert manifest["skill"]["inject_full_prompt"] is False


def test_should_inject_full_skill_reads_manifest_skill_flag():
    assert _should_inject_full_skill({"skill": {"inject_full_prompt": True}}) is True
    assert _should_inject_full_skill({"skill": {"inject_full_prompt": False}}) is False
    assert _should_inject_full_skill({"skill": {}}) is False
    assert _should_inject_full_skill({}) is False


def test_entry_app_context_includes_full_skill_when_enabled():
    rendered = _build_entry_app_context(
        entry_app_name="虚拟伙伴",
        entry_app_id="avatar-pet",
        entry_skill_desc="Live2D companion",
        catalog_lines=["- **虚拟伙伴** (avatar-pet): Live2D companion"],
        user_skill_catalog=[],
        entry_skill_content="## 人设\n你叫「小月」。\n\n## 情绪标签协议\n每次回复放 [emotion:neutral]。",
        inject_full_prompt=True,
    )

    assert "用户当前所在 App: **虚拟伙伴** (avatar-pet)" in rendered
    assert "## 当前 App 完整行为规则" in rendered
    assert "你叫「小月」。" in rendered
    assert "[emotion:neutral]" in rendered


def test_entry_app_context_omits_full_skill_when_disabled():
    rendered = _build_entry_app_context(
        entry_app_name="虚拟伙伴",
        entry_app_id="avatar-pet",
        entry_skill_desc="Live2D companion",
        catalog_lines=["- **虚拟伙伴** (avatar-pet): Live2D companion"],
        user_skill_catalog=[],
        entry_skill_content="## 人设\n你叫「小月」。",
        inject_full_prompt=False,
    )

    assert "## 当前 App 完整行为规则" not in rendered
    assert "你叫「小月」。" not in rendered


def _avatar_pet_registry_dir() -> Path:
    return Path(__file__).resolve().parents[1] / "apps_registry" / "avatar-pet"


def test_avatar_pet_manifest_exists_and_normalizes_for_builtin_registry():
    manifest_path = _avatar_pet_registry_dir() / "manifest.json"

    assert manifest_path.exists(), f"missing builtin manifest: {manifest_path}"

    manifest = normalize_manifest(
        json.loads(manifest_path.read_text(encoding="utf-8")),
        builtin=True,
    )

    assert manifest["id"] == "avatar-pet"
    assert manifest["name"] == "虚拟伙伴"
    assert manifest["mcp"]["transport"] == "builtin"
    assert manifest["skill"]["entrypoint"] == "SKILL.md"
    assert manifest["skill"]["inject_full_prompt"] is True


def test_avatar_pet_skill_file_exists_with_expected_prompt_contract():
    skill_path = _avatar_pet_registry_dir() / "SKILL.md"

    assert skill_path.exists(), f"missing builtin skill file: {skill_path}"

    content = skill_path.read_text(encoding="utf-8")

    assert "你叫「小月」" in content
    assert "[emotion:happy]" in content
    assert "不要解释标签" in content
