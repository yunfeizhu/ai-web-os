from app.core.app_registry import AppRegistry
from app.core.app_manifest import normalize_manifest
from app.core.skill_context import _build_entry_app_context, _should_inject_full_skill


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
