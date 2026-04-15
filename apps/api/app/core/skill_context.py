from __future__ import annotations

import re
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.app_registry import get_app_registry
from app.models.conversation import Conversation

MAX_SKILLS_IN_PROMPT = 3


@dataclass(frozen=True, slots=True)
class IntentRule:
    intent_id: str
    keywords: tuple[str, ...]
    primary_skill: str
    support_skills: tuple[str, ...] = ()


INTENT_RULES: tuple[IntentRule, ...] = (
    IntentRule(
        intent_id="system_config",
        keywords=(
            "设置",
            "配置",
            "知识库",
            "记忆",
            "模型",
            "provider",
            "api key",
            "启用",
            "禁用",
            "app 管理",
            "应用管理",
        ),
        primary_skill="settings",
    ),
    IntentRule(
        intent_id="web_navigation",
        keywords=(
            "网页",
            "浏览器",
            "链接",
            "网址",
            "页面",
            "网站",
            "html",
            ".html",
            ".htm",
            "验证码",
            "打开网页",
        ),
        primary_skill="browser",
        support_skills=("ai-chat",),
    ),
    IntentRule(
        intent_id="note_authoring",
        keywords=(
            "笔记",
            "markdown",
            "/notes",
            "纪要",
            "总结",
            "大纲",
            "润色",
            "改写",
            "扩写",
            "写到 notes",
            "保存到 notes",
        ),
        primary_skill="notes",
        support_skills=("file-manager", "text-editor"),
    ),
    IntentRule(
        intent_id="text_edit",
        keywords=(
            ".txt",
            ".md",
            ".json",
            "文本",
            "纯文本",
            "txt",
            "改标题",
            "改第一行",
            "编辑文件",
            "保存文件",
            "修改内容",
            "替换内容",
        ),
        primary_skill="text-editor",
        support_skills=("file-manager",),
    ),
    IntentRule(
        intent_id="file_browse",
        keywords=(
            "文件",
            "文件夹",
            "目录",
            "路径",
            "下载",
            "桌面",
            "重命名",
            "移动",
            "复制",
            "删除",
            "新建文件",
            "新建文件夹",
            "list files",
            "read file",
            "write file",
            "/downloads",
            "/desktop",
        ),
        primary_skill="file-manager",
        support_skills=("text-editor",),
    ),
)

INTENT_PRIORITY: dict[str, int] = {
    "system_config": 100,
    "web_navigation": 90,
    "note_authoring": 80,
    "text_edit": 70,
    "file_browse": 60,
}


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


def _normalize_text(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip().lower()


def _score_intent(message: str, rule: IntentRule) -> int:
    return sum(1 for keyword in rule.keywords if keyword.lower() in message)


def route_skills(
    message: str,
    entry_app_id: str | None,
    max_skills: int = MAX_SKILLS_IN_PROMPT,
) -> dict:
    normalized = _normalize_text(message)

    matched: list[dict] = []
    for rule in INTENT_RULES:
        score = _score_intent(normalized, rule)
        if score > 0:
            matched.append(
                {
                    "intent_id": rule.intent_id,
                    "score": score,
                    "priority": INTENT_PRIORITY.get(rule.intent_id, 0),
                    "primary_skill": rule.primary_skill,
                    "support_skills": list(rule.support_skills),
                }
            )

    matched.sort(
        key=lambda item: (
            -item["priority"],
            -item["score"],
            item["intent_id"],
        )
    )

    primary_skill = entry_app_id or "ai-chat"
    if matched:
        primary_skill = str(matched[0]["primary_skill"])
    elif entry_app_id:
        primary_skill = entry_app_id

    secondary_skills: list[str] = []
    secondary_score: dict[str, int] = {}

    for item in matched:
        candidate_skills = [str(item["primary_skill"]), *[str(skill) for skill in item["support_skills"]]]
        for skill_id in candidate_skills:
            if skill_id == primary_skill:
                continue
            secondary_score[skill_id] = secondary_score.get(skill_id, 0) + int(item["score"])

    if entry_app_id and entry_app_id != primary_skill:
        secondary_score[entry_app_id] = secondary_score.get(entry_app_id, 0) + 1

    ranked_secondary = sorted(
        secondary_score.items(),
        key=lambda item: (-item[1], item[0]),
    )
    for skill_id, _ in ranked_secondary:
        if skill_id not in secondary_skills:
            secondary_skills.append(skill_id)

    selected = [primary_skill]
    for skill_id in secondary_skills:
        if skill_id not in selected:
            selected.append(skill_id)
        if len(selected) >= max_skills:
            break

    routing_mode = "semantic-router" if matched else "entry-app-fallback"
    conflict_resolution = build_conflict_resolution(
        primary_skill=primary_skill,
        selected_skills=selected,
        entry_app_id=entry_app_id,
    )

    return {
        "routing_mode": routing_mode,
        "entry_app_id": entry_app_id,
        "primary_skill": primary_skill,
        "secondary_skills": [skill for skill in selected if skill != primary_skill],
        "selected_skills": selected,
        "matched_intents": [
            {
                "intent_id": item["intent_id"],
                "score": item["score"],
                "primary_skill": item["primary_skill"],
            }
            for item in matched
        ],
        "conflict_resolution": conflict_resolution,
    }


def build_conflict_resolution(
    primary_skill: str,
    selected_skills: list[str],
    entry_app_id: str | None,
) -> list[str]:
    resolutions = [
        f"主 Skill `{primary_skill}` 对任务目标、核心约束和最终输出拥有最高优先级。",
        "次 Skill 仅提供补充能力和局部约束，不得覆盖主 Skill 的核心规则。",
    ]

    if entry_app_id and entry_app_id != primary_skill:
        resolutions.append(
            f"入口 App `{entry_app_id}` 主要约束交互外壳和呈现风格，不得破坏主 Skill 的任务目标。"
        )

    selected_set = set(selected_skills)

    if primary_skill == "notes" and "terminal" in selected_set:
        resolutions.append("当 `notes` 与 `terminal` 同时出现时，终端只影响回答语气，不能破坏 Markdown 结构或 `/Notes` 保存语义。")
    if primary_skill == "notes" and "text-editor" in selected_set:
        resolutions.append("当 `notes` 与 `text-editor` 同时出现时，`notes` 决定最终文档结构与归档位置，`text-editor` 仅负责原始文本处理。")
    if primary_skill == "text-editor" and "file-manager" in selected_set:
        resolutions.append("当 `text-editor` 与 `file-manager` 同时出现时，`file-manager` 负责定位和报告路径，`text-editor` 负责内容编辑与保存约束。")
    if primary_skill == "browser" and "ai-chat" in selected_set:
        resolutions.append("当 `browser` 与 `ai-chat` 同时出现时，网页导航和页面交互必须由 `browser` 主导，`ai-chat` 只做解释、总结或辅助决策。")
    if primary_skill == "browser" and "terminal" in selected_set:
        resolutions.append("当 `browser` 与 `terminal` 同时出现时，不能为了终端风格而把真实网页操作退化成文本模拟。")
    if primary_skill == "settings":
        resolutions.append("涉及系统配置时，`settings` 的边界优先于其他 App 的局部偏好，避免跨 App 擅自修改全局状态。")
    if primary_skill == "file-manager" and "text-editor" in selected_set:
        resolutions.append("当主任务是文件操作时，先完成对象级操作，再决定是否进入文本编辑，不要把文件管理任务误升级成全文改写。")

    return resolutions


async def build_skill_augmented_system_prompt(
    db: AsyncSession,
    base_system_prompt: str,
    user_message: str,
    conversation_id: str | None = None,
    requested_app_id: str | None = None,
) -> tuple[str, dict | None]:
    entry_app_id = await resolve_app_id(
        db,
        conversation_id=conversation_id,
        requested_app_id=requested_app_id,
    )
    if not entry_app_id:
        return base_system_prompt, None

    registry = get_app_registry()
    route = route_skills(user_message, entry_app_id)

    loaded_skills: list[dict] = []
    for skill_app_id in route["selected_skills"]:
        try:
            skill_payload = await registry.get_skill(db, skill_app_id)
        except ValueError:
            continue

        metadata = skill_payload.get("metadata") or {}
        descriptor = skill_payload.get("skill") or {}
        skill_name = metadata.get("name") or descriptor.get("name") or skill_app_id
        description = metadata.get("description") or descriptor.get("description") or ""
        skill_content = str(skill_payload.get("content") or "").strip()
        if not skill_content:
            continue

        loaded_skills.append(
            {
                "app_id": skill_app_id,
                "name": skill_name,
                "description": description,
                "entrypoint": descriptor.get("entrypoint"),
                "content": skill_content,
                "role": (
                    "primary"
                    if skill_app_id == route["primary_skill"]
                    else "secondary"
                ),
            }
        )

    if not loaded_skills:
        return base_system_prompt, None

    prompt_sections = [base_system_prompt.rstrip()]
    prompt_lines = [
        "## 当前 App Skills 路由上下文",
        f"- routing_mode: {route['routing_mode']}",
        f"- entry_app: {entry_app_id}",
        f"- primary_skill: {route['primary_skill']}",
        f"- secondary_skills: {', '.join(route['secondary_skills']) if route['secondary_skills'] else '(none)'}",
    ]

    if route["matched_intents"]:
        prompt_lines.append(
            "- matched_intents: "
            + ", ".join(
                f"{item['intent_id']}({item['score']})"
                for item in route["matched_intents"]
            )
        )

    prompt_lines.extend(
        [
            "请按主 Skill → 次 Skill → 入口 App 的优先级理解任务。",
            "当多个 Skills 同时出现时，先遵守主 Skill 的能力边界和产出要求，再利用次 Skill 补充完成任务。",
            "",
            "### 冲突消解规则",
            *[f"{idx}. {line}" for idx, line in enumerate(route["conflict_resolution"], start=1)],
        ]
    )

    for index, skill in enumerate(loaded_skills, start=1):
        prompt_lines.extend(
            [
                "",
                f"### Skill {index}",
                f"- app_id: {skill['app_id']}",
                f"- role: {skill['role']}",
                f"- skill: {skill['name']}",
                *([f"- description: {skill['description']}"] if skill["description"] else []),
                "",
                skill["content"],
            ]
        )

    prompt_sections.append("\n".join(prompt_lines))

    return "\n\n".join(prompt_sections), {
        "routing_mode": route["routing_mode"],
        "entry_app_id": entry_app_id,
        "primary_skill": route["primary_skill"],
        "secondary_skills": route["secondary_skills"],
        "matched_intents": route["matched_intents"],
        "conflict_resolution": route["conflict_resolution"],
        "skills": [
            {
                "app_id": skill["app_id"],
                "name": skill["name"],
                "description": skill["description"],
                "entrypoint": skill["entrypoint"],
                "role": skill["role"],
            }
            for skill in loaded_skills
        ],
    }
