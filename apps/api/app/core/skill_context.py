"""Build skill discovery context for the agent loop.

Skills follow the current function-calling-first design:
- Script-backed skills are exposed as direct function-calling tools.
- Their first call may return a compact SKILL.md guide before execution.
- Knowledge-only skills use load_skill_context as a lightweight hint tool.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.app_registry import get_app_registry
from app.models.conversation import Conversation


_WEEKDAYS_ZH = ["星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"]


def _current_time_context() -> str:
    timezone_name = get_settings().app_timezone or "Asia/Shanghai"
    try:
        tz = ZoneInfo(timezone_name)
    except ZoneInfoNotFoundError:
        timezone_name = "Asia/Shanghai"
        tz = timezone(timedelta(hours=8), name=timezone_name)

    now = datetime.now(tz)
    weekday = _WEEKDAYS_ZH[now.weekday()]
    return "\n".join([
        "## 当前时间",
        f"- 当前日期时间：{now.strftime('%Y-%m-%d %H:%M:%S')}（{weekday}，{timezone_name}）",
        f"- 当前年份：{now.year}",
        "",
        "## 时间与实时数据规则",
        "- 用户提到“今天、明天、后天、本周、周末、下周、五一、春节、黄金周、最近、实时、最新”等相对时间时，必须先按当前日期和时区解析成明确日期或日期范围。",
        "- 调用天气、搜索、行情、新闻、邮件、日历等依赖时间的工具时，工具参数或搜索 query 中必须包含解析后的绝对日期；不要只传“今天/明天/五一”等相对词。",
        "- 节假日或月份日期默认按当前年份解析；如果该日期已过去且用户明显是在做未来计划，则按下一次即将到来的年份解析。",
        "- 如果用户指定了年份、月份、时区或日期范围，优先使用用户指定的信息。",
        "- 如果时间范围仍有歧义，应先澄清，或在回答中明确说明采用的日期假设。",
    ])


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
    """Build an augmented prompt with App context and Skill discovery metadata."""
    sections = [base_system_prompt.rstrip(), _current_time_context()]

    entry_app_id = await resolve_app_id(
        db,
        conversation_id=conversation_id,
        requested_app_id=requested_app_id,
    )
    if not entry_app_id:
        return "\n\n".join(section for section in sections if section), None

    registry = get_app_registry()

    # ── 1. Load only entry app Skill metadata ─────────────────
    entry_app_name = entry_app_id
    entry_skill_desc = ""
    try:
        skill_payload = await registry.get_skill(db, entry_app_id)
        metadata = skill_payload.get("metadata") or {}
        entry_app_name = metadata.get("name") or entry_app_id
        entry_skill_desc = str(metadata.get("description") or "").strip()
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

    # ── 3. Load user Skill discovery metadata only ────────────
    user_skill_catalog: list[str] = []
    user_skill_infos: list[dict[str, Any]] = []
    for user_skill in registry.list_user_skills(enabled_only=True):
        tool_backed = _has_executable_script(user_skill)
        skill_name = user_skill.get("name") or user_skill["id"]
        skill_desc = user_skill.get("description") or ""
        skill_id = user_skill["id"]
        skill_type = "脚本型" if tool_backed else "知识型"
        env_text = f"，环境变量: {user_skill['primary_env']}" if user_skill.get("primary_env") else ""
        user_skill_catalog.append(
            f"- **{skill_name}** (`{skill_id}`，{skill_type}{env_text}): {skill_desc or '暂无描述'}"
        )

        user_skill_infos.append({
            "app_id": f"user-skill:{skill_id}",
            "name": skill_name,
            "description": skill_desc,
            "source": "user",
            "skill_key": user_skill.get("skill_key"),
            "primary_env": user_skill.get("primary_env"),
            "tool_backed": tool_backed,
            "path": user_skill.get("path"),
            "entrypoint": user_skill.get("entrypoint"),
        })

    # ── 4. Assemble augmented system prompt ───────────────────
    lines: list[str] = [
        "## 当前上下文",
        f"用户当前所在 App: **{entry_app_name}** ({entry_app_id})",
        f"当前 App 描述: {entry_skill_desc or '暂无描述'}",
        "",
        "## 可用 App 一览",
        *catalog_lines,
        "",
        (
            "你拥有上述 App 对应的内置工具（function calling），"
            "请根据用户的实际需求自主选择最合适的工具来完成任务。"
        ),
        "",
        "## 工具调用规则",
        (
            "- 只有当用户请求与某个工具的名称、描述和参数明显匹配时，才通过 function calling 调用工具。\n"
            "- 如果没有合适工具，不要为了调用工具而调用无关工具；请直接回答、说明无法执行，或向用户澄清。\n"
            "- 文件工具只能用于文件管理器虚拟路径，不能读取 Skill、本地运行时或系统内部路径。\n"
            "- **严禁** 根据之前对话中的工具返回结果来仿写或编造新的结果。\n"
            "- 如果用户明确要求查询最新数据，并且存在匹配工具，必须重新调用工具获取最新数据。\n"
            "- 不同的查询参数会返回不同的结果，不能复用旧结果。"
        ),
    ]

    if user_skill_catalog:
        lines.extend([
            "",
            "## 用户自定义 Skills",
            (
                "以下脚本型 Skill 已作为独立工具暴露，可直接调用（无需先调用 load_skill_context）。\n"
                "知识型 Skill 可通过 load_skill_context 加载详细说明。"
            ),
            *user_skill_catalog,
        ])

    sections.append("\n".join(lines))

    skill_context: dict[str, Any] = {
        "entry_app_id": entry_app_id,
        "user_skills": user_skill_infos,
    }

    return "\n\n".join(sections), skill_context
