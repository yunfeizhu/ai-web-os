"""Build skill-augmented system prompts for the agent loop.

Follows the OpenAI / Anthropic function-calling paradigm:
- Tools are self-describing via their JSON schemas (registered in tools.py).
- The system prompt provides operational context (which App the user is in,
  what each App does) but does NOT route or score skills.
- The LLM autonomously decides which tools to call based on tool descriptions.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.app_registry import get_app_registry
from app.models.conversation import Conversation


async def resolve_app_id(
    db: AsyncSession,
    conversation_id: str | None = None,
    requested_app_id: str | None = None,
) -> str | None:
    if requested_app_id:
        return requested_app_id

    if not conversation_id:
        return None

    result = await db.execute(select(Conversation.app_id).where(Conversation.id == conversation_id))
    return result.scalar_one_or_none()


def _has_executable_script(skill: dict) -> bool:
    """Fast check whether the skill directory contains an executable script."""
    try:
        skill_path = Path(str(skill.get("path") or ""))
        skill_dir = skill_path.parent if skill_path.is_file() else skill_path
        scripts_dir = skill_dir / "scripts"
        if scripts_dir.is_dir():
            for child in scripts_dir.iterdir():
                if child.is_file() and child.suffix.lower() in {".py", ".js", ".ts", ".sh"}:
                    return True
        root_cli = skill_dir / "cli.py"
        if root_cli.is_file():
            return True
    except (OSError, ValueError):
        pass
    return False


async def build_skill_augmented_system_prompt(
    db: AsyncSession,
    base_system_prompt: str,
    user_message: str,
    conversation_id: str | None = None,
    requested_app_id: str | None = None,
) -> tuple[str, dict | None]:
    """Build an augmented system prompt with app context and user skills.

    Instead of routing/scoring skills, this function:
    1. Identifies which App the user is currently in (entry app).
    2. Loads the entry app's SKILL.md as operational guidelines.
    3. Builds a brief catalog of all available apps so the LLM knows
       the conceptual model of the system.
    4. Appends any user-defined skills (for python_exec workflows).
    5. Lets the LLM's native function calling decide which tools to use.
    """
    entry_app_id = await resolve_app_id(
        db,
        conversation_id=conversation_id,
        requested_app_id=requested_app_id,
    )
    if not entry_app_id:
        return base_system_prompt, None

    registry = get_app_registry()

    # ── 1. Load entry app's SKILL.md ──────────────────────────
    entry_skill_content = ""
    entry_app_name = entry_app_id
    try:
        skill_payload = await registry.get_skill(db, entry_app_id)
        entry_skill_content = str(skill_payload.get("content") or "").strip()
        metadata = skill_payload.get("metadata") or {}
        entry_app_name = metadata.get("name") or entry_app_id
    except ValueError:
        pass

    # ── 2. Build brief app catalog ────────────────────────────
    apps = await registry.list_apps(db)
    catalog_lines: list[str] = []
    for app in apps:
        if not getattr(app, "enabled", True):
            continue
        manifest = app.manifest or {}
        desc = manifest.get("description") or ""
        tools_list = [
            t.get("name")
            for t in manifest.get("tools", [])
            if isinstance(t, dict) and t.get("name")
        ]
        tool_info = f"（工具: {', '.join(tools_list)}）" if tools_list else ""
        catalog_lines.append(f"- **{app.name}** ({app.id}): {desc}{tool_info}")

    # ── 3. Load user skills ───────────────────────────────────
    user_skill_catalog: list[str] = []
    knowledge_only_skills: list[tuple[str, str]] = []  # (name, content)
    user_skill_infos: list[dict[str, Any]] = []
    user_skill_contents: dict[str, str] = {}
    for user_skill in registry.list_user_skills(enabled_only=True):
        skill_content = str(user_skill.get("content") or "").strip()
        if not skill_content:
            continue
        tool_backed = _has_executable_script(user_skill)
        skill_name = user_skill.get("name") or user_skill["id"]
        skill_desc = user_skill.get("description") or ""
        skill_id = user_skill["id"]

        if tool_backed:
            # Tool-backed skills have dedicated function calling tools
            # registered in tools.py — just list them briefly here.
            slug = re.sub(r"[^a-zA-Z0-9]+", "_", skill_id.strip()).strip("_").lower()
            tool_name = f"skill_{slug}"
            user_skill_catalog.append(
                f"- **{skill_name}** → 工具 `{tool_name}(query)`: {skill_desc}"
            )
        else:
            # Knowledge-only skills: inject their SKILL.md as guidelines
            user_skill_catalog.append(f"- **{skill_name}**: {skill_desc}")
            knowledge_only_skills.append((skill_name, skill_content))

        user_skill_infos.append({
            "app_id": f"user-skill:{skill_id}",
            "name": skill_name,
            "description": skill_desc,
            "source": "user",
            "skill_key": user_skill.get("skill_key"),
            "primary_env": user_skill.get("primary_env"),
            "tool_backed": tool_backed,
        })
        user_skill_contents[skill_id] = skill_content

    # ── 4. Assemble augmented system prompt ───────────────────
    sections = [base_system_prompt.rstrip()]

    lines: list[str] = [
        "## 当前上下文",
        f"用户当前所在 App: **{entry_app_name}** ({entry_app_id})",
        "",
        "## 可用 App 一览",
        *catalog_lines,
        "",
        (
            "你拥有上述 App 对应的内置工具（function calling），"
            "请根据用户的实际需求自主选择最合适的工具来完成任务。"
        ),
        "",
        "## 重要：工具调用规则",
        (
            "- 每次用户请求涉及查询数据、执行操作时，你 **必须** 通过 function calling 实际调用工具。\n"
            "- **严禁** 根据之前对话中的工具返回结果来仿写或编造新的结果。\n"
            "- 即使用户的新请求与之前的请求相似，也必须重新调用工具获取最新数据。\n"
            "- 不同的查询参数会返回不同的结果，绝不能复用旧结果。"
        ),
    ]

    if entry_skill_content:
        lines.extend([
            "",
            f"## 当前 App 操作指南（{entry_app_id}）",
            entry_skill_content,
        ])

    if user_skill_catalog:
        lines.extend([
            "",
            "## 用户自定义技能",
            "以下是用户安装的额外技能：",
            *user_skill_catalog,
            "",
            (
                "标有 → 工具的技能已注册为 function calling 工具，"
                "直接调用对应工具即可。其余技能为知识型指南，参考其内容回答即可。"
            ),
        ])

    # Inject knowledge-only skill content as guidelines
    for skill_name, skill_content in knowledge_only_skills:
        lines.extend([
            "",
            f"### 知识技能: {skill_name}",
            skill_content,
        ])

    sections.append("\n".join(lines))

    skill_context: dict[str, Any] = {
        "entry_app_id": entry_app_id,
        "user_skills": user_skill_infos,
        "user_skill_contents": user_skill_contents,
    }

    return "\n\n".join(sections), skill_context
