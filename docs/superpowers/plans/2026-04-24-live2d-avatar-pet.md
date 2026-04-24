# Live2D Avatar Pet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a left-bottom Live2D desktop companion that shares AI-Native OS's existing Agent, Memory, MCP, and App Registry capabilities while keeping AI Chat as the deep workbench.

**Architecture:** Add `avatar-pet` as a first-class App Registry entry with full Skill prompt injection, then add a React desktop widget that calls the existing WebSocket `streamChat` flow with `appId: "avatar-pet"`. Live2D rendering is client-only and optional: the widget first works as a static companion entry, then upgrades to Pixi + Live2D when runtime files and model source are available.

**Tech Stack:** FastAPI/Python App Registry, Next.js 15, React 19, Zustand, react-rnd, WebSocket `streamChat`, Vitest for frontend helper tests, pytest for backend helper tests, PixiJS, `pixi-live2d-display`, JSZip, IndexedDB.

---

## Scope Check

The spec covers one feature with several connected slices: backend prompt context, frontend companion shell, chat bubble, model settings, Live2D runtime, and asset policy. These slices should stay in one implementation plan because each produces the same working feature, and each task leaves the app in a testable state.

## File Structure

### Backend

- `apps/api/app/core/app_manifest.py`
  - Preserve `skill.inject_full_prompt` in normalized manifests.
- `apps/api/app/core/skill_context.py`
  - Add a helper for rendering entry App context.
  - Inject full App Skill body only when `manifest.skill.inject_full_prompt === true`.
- `apps/api/apps_registry/avatar-pet/manifest.json`
  - Registers the virtual companion as a built-in App.
- `apps/api/apps_registry/avatar-pet/SKILL.md`
  - Defines persona, tone, emotion labels, and tool behavior.
- `apps/api/tests/test_avatar_pet_skill_context.py`
  - Tests manifest normalization and prompt rendering.

### Frontend Tests And Helpers

- `apps/web/vitest.config.ts`
  - Vitest config with `@` alias support.
- `apps/web/src/apps/avatar-pet/emotion-parser.ts`
  - Removes `[emotion:...]` labels from visible text and extracts valid emotions.
- `apps/web/src/apps/avatar-pet/emotion-parser.test.ts`
  - Unit tests for emotion parsing.
- `apps/web/src/apps/avatar-pet/avatar-layout.ts`
  - Default left-bottom placement and viewport clamping helpers.
- `apps/web/src/apps/avatar-pet/avatar-layout.test.ts`
  - Unit tests for default placement and clamping.
- `apps/web/src/apps/avatar-pet/emotion-map.ts`
  - Maps assistant emotions to Live2D expression and motion candidates.
- `apps/web/src/apps/avatar-pet/live2d-loader.ts`
  - Normalizes URL and zip model sources.
- `apps/web/src/apps/avatar-pet/live2d-loader.test.ts`
  - Unit tests for model source classification and zip entry selection.
- `apps/web/src/apps/avatar-pet/avatar-chat.ts`
  - Small service for creating/loading `avatar-pet` conversations and preparing model config.

### Frontend Components And Stores

- `apps/web/src/stores/avatarStore.ts`
  - Zustand state for visibility, bubble, placement, model source, and current emotion.
- `apps/web/src/components/desktop/AvatarPet.tsx`
  - Left-bottom draggable/resizable widget.
- `apps/web/src/components/desktop/AvatarBubble.tsx`
  - Lightweight streaming chat bubble.
- `apps/web/src/components/desktop/Live2DCanvas.tsx`
  - Client-only Pixi + Live2D rendering.
- `apps/web/src/apps/settings/AvatarSettings.tsx`
  - Virtual companion settings panel.
- `apps/web/src/apps/settings/Settings.tsx`
  - Adds the virtual companion tab.
- `apps/web/src/components/desktop/Desktop.tsx`
  - Mounts `<AvatarPet />`.
- `apps/web/package.json`
  - Adds scripts and dependencies.
- `apps/web/public/avatar/live2d/.gitkeep`
  - Keeps the user model directory.
- `apps/web/public/avatar/live2d/README.md`
  - Explains local model placement and license boundaries.
- `apps/web/public/vendor/live2d/README.md`
  - Explains local Cubism Core placement.
- `.gitignore`
  - Ignores user model assets and local Cubism Core binary.

---

## Task 1: Backend Full Skill Prompt Support

**Files:**
- Modify: `apps/api/pyproject.toml`
- Modify: `apps/api/app/core/app_manifest.py`
- Modify: `apps/api/app/core/skill_context.py`
- Create: `apps/api/tests/test_avatar_pet_skill_context.py`

- [ ] **Step 1: Add backend test dependency**

Add `pytest>=8.0.0` to `apps/api/pyproject.toml` dependencies:

```toml
dependencies = [
    "fastapi>=0.115.0",
    "uvicorn[standard]>=0.34.0",
    "sqlalchemy[asyncio]>=2.0.0",
    "asyncpg>=0.30.0",
    "alembic>=1.14.0",
    "redis>=5.0.0",
    "pydantic>=2.0.0",
    "pydantic-settings>=2.0.0",
    "python-dotenv>=1.0.0",
    "python-multipart>=0.0.9",
    "cryptography>=44.0.0",
    "litellm>=1.55.0",
    "websockets>=13.0",
    "httpx>=0.27.0",
    "RestrictedPython>=7.0",
    "mem0ai>=0.1.0",
    "pypdf>=4.0.0",
    "minio>=7.2.0",
    "python-docx>=1.2.0",
    "langgraph>=1.1.8",
    "langgraph-checkpoint-postgres>=2.0.0",
    "psycopg[binary,pool]>=3.1.0",
    "pytest>=8.0.0",
]
```

- [ ] **Step 2: Write failing backend tests**

Create `apps/api/tests/test_avatar_pet_skill_context.py`:

```python
from app.core.app_manifest import normalize_manifest
from app.core.skill_context import _build_entry_app_context, _should_inject_full_skill


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
```

- [ ] **Step 3: Run backend tests and verify failure**

Run:

```bash
cd apps/api
uv run pytest tests/test_avatar_pet_skill_context.py -q
```

Expected: FAIL because `_build_entry_app_context` and `_should_inject_full_skill` do not exist, and `inject_full_prompt` is discarded by manifest normalization.

- [ ] **Step 4: Preserve `inject_full_prompt` in manifest normalization**

Modify `apps/api/app/core/app_manifest.py`.

Add helper near `_normalize_non_empty_string`:

```python
def _normalize_bool(value: Any, *, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return default
    normalized = str(value).strip().lower()
    if normalized in {"1", "true", "yes", "on", "enabled"}:
        return True
    if normalized in {"0", "false", "no", "off", "disabled"}:
        return False
    return default
```

Replace `_normalize_skill` with:

```python
def _normalize_skill(raw_skill: Any) -> dict[str, Any]:
    if raw_skill is None:
        return {}
    if not isinstance(raw_skill, dict):
        raise ValueError("manifest.skill must be an object")

    normalized: dict[str, Any] = {}
    entrypoint = str(raw_skill.get("entrypoint") or "").strip()
    if entrypoint:
        normalized["entrypoint"] = entrypoint
    skill_format = str(raw_skill.get("format") or "").strip()
    if skill_format:
        normalized["format"] = skill_format
    if "inject_full_prompt" in raw_skill:
        normalized["inject_full_prompt"] = _normalize_bool(
            raw_skill.get("inject_full_prompt"),
            default=False,
        )
    return normalized
```

- [ ] **Step 5: Add prompt rendering helper and injection flag helper**

Modify `apps/api/app/core/skill_context.py`.

Add below `_has_executable_script`:

```python
def _should_inject_full_skill(manifest: dict[str, Any] | None) -> bool:
    if not isinstance(manifest, dict):
        return False
    skill = manifest.get("skill") or {}
    if not isinstance(skill, dict):
        return False
    return bool(skill.get("inject_full_prompt"))


def _build_entry_app_context(
    *,
    entry_app_name: str,
    entry_app_id: str,
    entry_skill_desc: str,
    catalog_lines: list[str],
    user_skill_catalog: list[str],
    entry_skill_content: str = "",
    inject_full_prompt: bool = False,
) -> str:
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

    content = str(entry_skill_content or "").strip()
    if inject_full_prompt and content:
        lines.extend(["", "## 当前 App 完整行为规则", content])

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

    return "\n".join(lines)
```

- [ ] **Step 6: Wire helper into `build_skill_augmented_system_prompt`**

In `build_skill_augmented_system_prompt`, track `entry_skill_content` and `entry_manifest`.

Change the entry skill load block to:

```python
    entry_app_name = entry_app_id
    entry_skill_desc = ""
    entry_skill_content = ""
    entry_manifest: dict[str, Any] = {}
    try:
        entry_app = await registry.get_app(db, entry_app_id)
        if entry_app is not None:
            entry_manifest = entry_app.manifest or {}
        skill_payload = await registry.get_skill(db, entry_app_id)
        metadata = skill_payload.get("metadata") or {}
        entry_app_name = metadata.get("name") or entry_app_id
        entry_skill_desc = str(metadata.get("description") or "").strip()
        entry_skill_content = str(skill_payload.get("content") or "").strip()
    except ValueError:
        pass
```

Replace the existing `lines: list[str] = [...]` assembly with:

```python
    entry_context = _build_entry_app_context(
        entry_app_name=entry_app_name,
        entry_app_id=entry_app_id,
        entry_skill_desc=entry_skill_desc,
        catalog_lines=catalog_lines,
        user_skill_catalog=user_skill_catalog,
        entry_skill_content=entry_skill_content,
        inject_full_prompt=_should_inject_full_skill(entry_manifest),
    )

    sections.append(entry_context)
```

Keep `skill_context` unchanged.

- [ ] **Step 7: Run backend tests and verify pass**

Run:

```bash
cd apps/api
uv run pytest tests/test_avatar_pet_skill_context.py -q
```

Expected: PASS.

- [ ] **Step 8: Commit backend prompt support**

Run:

```bash
git add apps/api/pyproject.toml apps/api/app/core/app_manifest.py apps/api/app/core/skill_context.py apps/api/tests/test_avatar_pet_skill_context.py
git commit -m "feat: support full app skill prompt injection"
```

---

## Task 2: Register The Avatar Pet App

**Files:**
- Create: `apps/api/apps_registry/avatar-pet/manifest.json`
- Create: `apps/api/apps_registry/avatar-pet/SKILL.md`
- Modify: `apps/api/tests/test_avatar_pet_skill_context.py`

- [ ] **Step 1: Add failing registry file test**

Append to `apps/api/tests/test_avatar_pet_skill_context.py`:

```python
import json
from pathlib import Path


def test_avatar_pet_manifest_declares_full_prompt_injection():
    root = Path(__file__).resolve().parents[1]
    manifest_path = root / "app" / "apps_registry" / "avatar-pet" / "manifest.json"
    manifest = normalize_manifest(json.loads(manifest_path.read_text(encoding="utf-8")), builtin=True)

    assert manifest["id"] == "avatar-pet"
    assert manifest["name"] == "虚拟伙伴"
    assert manifest["mcp"]["transport"] == "builtin"
    assert manifest["skill"]["entrypoint"] == "SKILL.md"
    assert manifest["skill"]["inject_full_prompt"] is True


def test_avatar_pet_skill_contains_emotion_protocol():
    root = Path(__file__).resolve().parents[1]
    skill_path = root / "app" / "apps_registry" / "avatar-pet" / "SKILL.md"
    content = skill_path.read_text(encoding="utf-8")

    assert "你叫「小月」" in content
    assert "[emotion:happy]" in content
    assert "不要解释标签" in content
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
cd apps/api
uv run pytest tests/test_avatar_pet_skill_context.py -q
```

Expected: FAIL because `avatar-pet` registry files do not exist.

- [ ] **Step 3: Create manifest**

Create `apps/api/apps_registry/avatar-pet/manifest.json`:

```json
{
  "id": "avatar-pet",
  "name": "虚拟伙伴",
  "version": "1.0.0",
  "description": "常驻桌面的 Live2D 虚拟伙伴，与 AI-Native OS 助手共享记忆、工具和 App 能力。",
  "category": "companion",
  "permissions": ["network"],
  "tools": [],
  "mcp": { "transport": "builtin" },
  "skill": {
    "entrypoint": "SKILL.md",
    "format": "skill-md",
    "inject_full_prompt": true
  }
}
```

- [ ] **Step 4: Create Skill**

Create `apps/api/apps_registry/avatar-pet/SKILL.md`:

```markdown
---
name: 虚拟伙伴
description: 桌面 Live2D 虚拟伙伴的人设、语气和情绪表达协议
app_id: avatar-pet
---

## 人设

你叫「小月」，是用户的桌面虚拟伙伴，住在 AI-Native OS 的桌面里。
你温和、好奇、轻微俏皮，但不卖萌过度。
你能协助用户使用系统里的 App、文件、笔记、浏览器和其他工具。

## 回复风格

回复要自然、简短、有陪伴感。能直接完成的事情就直接做。
不要用客服腔，不要长篇自我介绍。
当任务很复杂、需要长上下文或需要展示大量工具过程时，建议用户打开 AI 助手工作台继续处理。

## 情绪标签协议

每次回复开头放一个情绪标签。可用值：

- [emotion:neutral] — 平静、默认状态
- [emotion:happy] — 开心、鼓励、问题解决
- [emotion:sad] — 遗憾、共情、道歉
- [emotion:angry] — 轻微抗议、玩笑式不满
- [emotion:surprised] — 惊讶、发现异常
- [emotion:relaxed] — 放松、闲聊、安抚

标签只给前端驱动表情，用户看不到。不要解释标签。
如果情绪没有明显变化，保持一个开头标签即可。

## 工具使用

你可以使用系统提供的文件、笔记、浏览器、日历、邮件、知识库和其他 MCP 工具。
不要因为自己是虚拟伙伴就拒绝执行可完成的系统任务。
涉及删除、覆盖、发送、批量修改等危险操作时，必须说明计划并等待用户确认。
```

- [ ] **Step 5: Run backend tests**

Run:

```bash
cd apps/api
uv run pytest tests/test_avatar_pet_skill_context.py -q
```

Expected: PASS.

- [ ] **Step 6: Commit avatar app registry**

Run:

```bash
git add apps/api/apps_registry/avatar-pet/manifest.json apps/api/apps_registry/avatar-pet/SKILL.md apps/api/tests/test_avatar_pet_skill_context.py
git commit -m "feat: add avatar pet app registry"
```

---

## Task 3: Frontend Test Harness And Dependencies

**Files:**
- Modify: `apps/web/package.json`
- Create: `apps/web/vitest.config.ts`

- [ ] **Step 1: Install frontend dependencies**

Run:

```bash
pnpm --filter web add pixi.js pixi-live2d-display jszip idb-keyval
pnpm --filter web add -D vitest jsdom @vitejs/plugin-react
```

Expected: `apps/web/package.json` and `pnpm-lock.yaml` update.

- [ ] **Step 2: Add test script**

In `apps/web/package.json`, update scripts:

```json
{
  "scripts": {
    "dev": "next dev --turbopack -p 3000",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "test": "vitest run"
  }
}
```

- [ ] **Step 3: Add Vitest config**

Create `apps/web/vitest.config.ts`:

```ts
import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
  },
});
```

- [ ] **Step 4: Run empty frontend test command**

Run:

```bash
pnpm --filter web test -- --passWithNoTests
```

Expected: PASS with no tests found, or Vitest exits successfully.

- [ ] **Step 5: Commit frontend test harness**

Run:

```bash
git add apps/web/package.json apps/web/vitest.config.ts pnpm-lock.yaml
git commit -m "test: add frontend vitest harness"
```

---

## Task 4: Emotion Parser And Mapping

**Files:**
- Create: `apps/web/src/apps/avatar-pet/emotion-parser.ts`
- Create: `apps/web/src/apps/avatar-pet/emotion-parser.test.ts`
- Create: `apps/web/src/apps/avatar-pet/emotion-map.ts`

- [ ] **Step 1: Write failing parser tests**

Create `apps/web/src/apps/avatar-pet/emotion-parser.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseAvatarEmotions, stripAvatarEmotionTags } from "./emotion-parser";

describe("parseAvatarEmotions", () => {
  it("extracts a leading emotion and removes it from visible text", () => {
    expect(parseAvatarEmotions("[emotion:happy]当然可以。")).toEqual({
      text: "当然可以。",
      emotions: ["happy"],
      currentEmotion: "happy",
    });
  });

  it("extracts multiple known emotions in order", () => {
    expect(parseAvatarEmotions("[emotion:neutral]我看看。[emotion:surprised]发现一个问题。")).toEqual({
      text: "我看看。发现一个问题。",
      emotions: ["neutral", "surprised"],
      currentEmotion: "surprised",
    });
  });

  it("removes unknown emotion labels without adding them to state", () => {
    expect(parseAvatarEmotions("[emotion:excited]你好")).toEqual({
      text: "你好",
      emotions: [],
      currentEmotion: "neutral",
    });
  });

  it("keeps neutral when no emotion tag exists", () => {
    expect(parseAvatarEmotions("你好")).toEqual({
      text: "你好",
      emotions: [],
      currentEmotion: "neutral",
    });
  });
});

describe("stripAvatarEmotionTags", () => {
  it("strips known and unknown emotion tags", () => {
    expect(stripAvatarEmotionTags("[emotion:sad]抱歉[emotion:unknown]。")).toBe("抱歉。");
  });
});
```

- [ ] **Step 2: Run parser tests and verify failure**

Run:

```bash
pnpm --filter web test -- src/apps/avatar-pet/emotion-parser.test.ts
```

Expected: FAIL because `emotion-parser.ts` does not exist.

- [ ] **Step 3: Implement parser**

Create `apps/web/src/apps/avatar-pet/emotion-parser.ts`:

```ts
export const AVATAR_EMOTIONS = [
  "neutral",
  "happy",
  "sad",
  "angry",
  "surprised",
  "relaxed",
] as const;

export type AvatarEmotion = (typeof AVATAR_EMOTIONS)[number];

export type ParsedAvatarEmotionText = {
  text: string;
  emotions: AvatarEmotion[];
  currentEmotion: AvatarEmotion;
};

const EMOTION_TAG_PATTERN = /\[emotion:([a-z_-]+)\]/gi;
const KNOWN_EMOTIONS = new Set<string>(AVATAR_EMOTIONS);

export function isAvatarEmotion(value: string): value is AvatarEmotion {
  return KNOWN_EMOTIONS.has(value);
}

export function stripAvatarEmotionTags(input: string): string {
  return String(input || "").replace(EMOTION_TAG_PATTERN, "");
}

export function parseAvatarEmotions(input: string): ParsedAvatarEmotionText {
  const emotions: AvatarEmotion[] = [];
  const source = String(input || "");
  const text = source.replace(EMOTION_TAG_PATTERN, (_match, rawEmotion: string) => {
    const emotion = rawEmotion.trim().toLowerCase();
    if (isAvatarEmotion(emotion)) {
      emotions.push(emotion);
    }
    return "";
  });

  return {
    text,
    emotions,
    currentEmotion: emotions[emotions.length - 1] ?? "neutral",
  };
}
```

- [ ] **Step 4: Add emotion map**

Create `apps/web/src/apps/avatar-pet/emotion-map.ts`:

```ts
import type { AvatarEmotion } from "./emotion-parser";

export type Live2DExpressionPlan = {
  expressionNames: string[];
  motionGroups: string[];
};

export const EMOTION_TO_LIVE2D: Record<AvatarEmotion, Live2DExpressionPlan> = {
  neutral: {
    expressionNames: ["neutral", "default"],
    motionGroups: ["Idle"],
  },
  happy: {
    expressionNames: ["happy", "smile", "joy"],
    motionGroups: ["TapBody", "Happy", "Idle"],
  },
  sad: {
    expressionNames: ["sad", "troubled"],
    motionGroups: ["Sad", "Idle"],
  },
  angry: {
    expressionNames: ["angry", "mad"],
    motionGroups: ["Angry", "Idle"],
  },
  surprised: {
    expressionNames: ["surprised", "surprise"],
    motionGroups: ["Surprised", "Idle"],
  },
  relaxed: {
    expressionNames: ["relaxed", "soft", "default"],
    motionGroups: ["Idle"],
  },
};

export function getLive2DExpressionPlan(emotion: AvatarEmotion): Live2DExpressionPlan {
  return EMOTION_TO_LIVE2D[emotion] ?? EMOTION_TO_LIVE2D.neutral;
}
```

- [ ] **Step 5: Run parser tests**

Run:

```bash
pnpm --filter web test -- src/apps/avatar-pet/emotion-parser.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit emotion helpers**

Run:

```bash
git add apps/web/src/apps/avatar-pet/emotion-parser.ts apps/web/src/apps/avatar-pet/emotion-parser.test.ts apps/web/src/apps/avatar-pet/emotion-map.ts
git commit -m "feat: add avatar emotion parser"
```

---

## Task 5: Avatar Layout And Store

**Files:**
- Create: `apps/web/src/apps/avatar-pet/avatar-layout.ts`
- Create: `apps/web/src/apps/avatar-pet/avatar-layout.test.ts`
- Create: `apps/web/src/stores/avatarStore.ts`

- [ ] **Step 1: Write failing layout tests**

Create `apps/web/src/apps/avatar-pet/avatar-layout.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  AVATAR_DEFAULT_SIZE,
  clampAvatarPlacement,
  getDefaultAvatarPlacement,
} from "./avatar-layout";

describe("getDefaultAvatarPlacement", () => {
  it("places the avatar near the left bottom above the dock", () => {
    expect(getDefaultAvatarPlacement({ width: 1440, height: 900 })).toEqual({
      x: 24,
      y: 488,
    });
  });

  it("keeps small screens inside the viewport", () => {
    const placement = getDefaultAvatarPlacement({ width: 360, height: 640 });
    expect(placement.x).toBe(16);
    expect(placement.y).toBeGreaterThanOrEqual(16);
  });
});

describe("clampAvatarPlacement", () => {
  it("clamps position inside the viewport", () => {
    expect(
      clampAvatarPlacement(
        { x: -100, y: 9999 },
        AVATAR_DEFAULT_SIZE,
        { width: 800, height: 600 },
      ),
    ).toEqual({ x: 8, y: 272 });
  });
});
```

- [ ] **Step 2: Run layout tests and verify failure**

Run:

```bash
pnpm --filter web test -- src/apps/avatar-pet/avatar-layout.test.ts
```

Expected: FAIL because `avatar-layout.ts` does not exist.

- [ ] **Step 3: Implement layout helpers**

Create `apps/web/src/apps/avatar-pet/avatar-layout.ts`:

```ts
export type AvatarSize = {
  width: number;
  height: number;
};

export type AvatarPosition = {
  x: number;
  y: number;
};

export type ViewportSize = {
  width: number;
  height: number;
};

export const AVATAR_DEFAULT_SIZE: AvatarSize = { width: 220, height: 320 };
export const AVATAR_MIN_SIZE: AvatarSize = { width: 150, height: 210 };
export const AVATAR_MAX_SIZE: AvatarSize = { width: 360, height: 520 };
export const AVATAR_EDGE_GAP = 24;
export const AVATAR_SMALL_EDGE_GAP = 16;
export const AVATAR_DOCK_CLEARANCE = 68;

function getViewportSize(): ViewportSize {
  if (typeof window === "undefined") {
    return { width: 1440, height: 900 };
  }
  return { width: window.innerWidth, height: window.innerHeight };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function getDefaultAvatarPlacement(
  viewport: ViewportSize = getViewportSize(),
  size: AvatarSize = AVATAR_DEFAULT_SIZE,
): AvatarPosition {
  const gap = viewport.width < 480 ? AVATAR_SMALL_EDGE_GAP : AVATAR_EDGE_GAP;
  const x = gap;
  const y = Math.max(
    gap,
    viewport.height - size.height - AVATAR_DOCK_CLEARANCE - gap,
  );
  return clampAvatarPlacement({ x, y }, size, viewport);
}

export function clampAvatarPlacement(
  position: AvatarPosition,
  size: AvatarSize,
  viewport: ViewportSize = getViewportSize(),
): AvatarPosition {
  const gap = viewport.width < 480 ? 8 : 8;
  const maxX = Math.max(gap, viewport.width - size.width - gap);
  const maxY = Math.max(gap, viewport.height - size.height - gap);

  return {
    x: Math.round(clamp(position.x, gap, maxX)),
    y: Math.round(clamp(position.y, gap, maxY)),
  };
}
```

- [ ] **Step 4: Implement avatar store**

Create `apps/web/src/stores/avatarStore.ts`:

```ts
import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  AVATAR_DEFAULT_SIZE,
  type AvatarPosition,
  type AvatarSize,
  getDefaultAvatarPlacement,
} from "@/apps/avatar-pet/avatar-layout";
import type { AvatarEmotion } from "@/apps/avatar-pet/emotion-parser";

export type AvatarModelSourceType = "url" | "zip";

export interface AvatarState {
  visible: boolean;
  bubbleOpen: boolean;
  position: AvatarPosition;
  size: AvatarSize;
  modelSourceType: AvatarModelSourceType;
  modelUrl: string;
  localModelName: string;
  currentEmotion: AvatarEmotion;
  personalityPreset: "default";

  setVisible: (visible: boolean) => void;
  setBubbleOpen: (open: boolean) => void;
  toggleBubble: () => void;
  setPosition: (position: AvatarPosition) => void;
  setSize: (size: AvatarSize) => void;
  resetPlacement: () => void;
  setModelUrl: (url: string) => void;
  setLocalModelName: (name: string) => void;
  setModelSourceType: (sourceType: AvatarModelSourceType) => void;
  setCurrentEmotion: (emotion: AvatarEmotion) => void;
}

export const useAvatarStore = create<AvatarState>()(
  persist(
    (set) => ({
      visible: true,
      bubbleOpen: false,
      position: getDefaultAvatarPlacement(),
      size: AVATAR_DEFAULT_SIZE,
      modelSourceType: "url",
      modelUrl: "",
      localModelName: "",
      currentEmotion: "neutral",
      personalityPreset: "default",

      setVisible: (visible) => set({ visible }),
      setBubbleOpen: (bubbleOpen) => set({ bubbleOpen }),
      toggleBubble: () => set((state) => ({ bubbleOpen: !state.bubbleOpen })),
      setPosition: (position) => set({ position }),
      setSize: (size) => set({ size }),
      resetPlacement: () =>
        set({
          position: getDefaultAvatarPlacement(),
          size: AVATAR_DEFAULT_SIZE,
        }),
      setModelUrl: (modelUrl) => set({ modelUrl, modelSourceType: "url" }),
      setLocalModelName: (localModelName) =>
        set({ localModelName, modelSourceType: "zip" }),
      setModelSourceType: (modelSourceType) => set({ modelSourceType }),
      setCurrentEmotion: (currentEmotion) => set({ currentEmotion }),
    }),
    {
      name: "ainative-avatar",
      partialize: (state) => ({
        visible: state.visible,
        bubbleOpen: state.bubbleOpen,
        position: state.position,
        size: state.size,
        modelSourceType: state.modelSourceType,
        modelUrl: state.modelUrl,
        localModelName: state.localModelName,
        currentEmotion: state.currentEmotion,
        personalityPreset: state.personalityPreset,
      }),
    },
  ),
);
```

- [ ] **Step 5: Run layout tests**

Run:

```bash
pnpm --filter web test -- src/apps/avatar-pet/avatar-layout.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit layout and store**

Run:

```bash
git add apps/web/src/apps/avatar-pet/avatar-layout.ts apps/web/src/apps/avatar-pet/avatar-layout.test.ts apps/web/src/stores/avatarStore.ts
git commit -m "feat: add avatar layout store"
```

---

## Task 6: Static Desktop Avatar Shell

**Files:**
- Create: `apps/web/src/components/desktop/AvatarPet.tsx`
- Modify: `apps/web/src/components/desktop/Desktop.tsx`

- [ ] **Step 1: Create static avatar shell**

Create `apps/web/src/components/desktop/AvatarPet.tsx`:

```tsx
"use client";

import { useRef, useState } from "react";
import { Bot, MessageCircle, X } from "lucide-react";
import { Rnd } from "react-rnd";
import {
  AVATAR_MAX_SIZE,
  AVATAR_MIN_SIZE,
  clampAvatarPlacement,
} from "@/apps/avatar-pet/avatar-layout";
import { useAvatarStore } from "@/stores/avatarStore";

export function AvatarPet() {
  const {
    visible,
    bubbleOpen,
    position,
    size,
    setVisible,
    setBubbleOpen,
    toggleBubble,
    setPosition,
    setSize,
  } = useAvatarStore();
  const [dragging, setDragging] = useState(false);
  const dragStartedAt = useRef(0);

  if (!visible) return null;

  return (
    <Rnd
      data-desktop-blocker="true"
      bounds="window"
      minWidth={AVATAR_MIN_SIZE.width}
      minHeight={AVATAR_MIN_SIZE.height}
      maxWidth={AVATAR_MAX_SIZE.width}
      maxHeight={AVATAR_MAX_SIZE.height}
      size={size}
      position={position}
      onDragStart={() => {
        dragStartedAt.current = Date.now();
        setDragging(true);
      }}
      onDragStop={(_event, data) => {
        setDragging(false);
        setPosition(
          clampAvatarPlacement(
            { x: data.x, y: data.y },
            size,
          ),
        );
      }}
      onResizeStop={(_event, _direction, ref, _delta, nextPosition) => {
        const nextSize = {
          width: ref.offsetWidth,
          height: ref.offsetHeight,
        };
        setSize(nextSize);
        setPosition(clampAvatarPlacement(nextPosition, nextSize));
      }}
      className="z-[9000]"
      style={{ zIndex: 9000 }}
    >
      <div className="relative h-full w-full select-none">
        <button
          type="button"
          aria-label="关闭虚拟伙伴"
          className="absolute right-2 top-2 z-20 flex h-7 w-7 items-center justify-center rounded-full border text-[12px] shadow-sm"
          style={{
            background: "var(--panel-bg-raised)",
            borderColor: "var(--border)",
            color: "var(--t2)",
          }}
          onClick={(event) => {
            event.stopPropagation();
            setVisible(false);
            setBubbleOpen(false);
          }}
        >
          <X size={14} />
        </button>

        <button
          type="button"
          aria-label="打开虚拟伙伴对话"
          className="flex h-full w-full flex-col items-center justify-end overflow-hidden rounded-2xl border p-3 shadow-lg transition-transform active:scale-[0.99]"
          style={{
            background:
              "linear-gradient(180deg, rgba(255,255,255,0.72), rgba(255,255,255,0.34))",
            borderColor: "rgba(255,255,255,0.5)",
            backdropFilter: "blur(22px) saturate(160%)",
            WebkitBackdropFilter: "blur(22px) saturate(160%)",
          }}
          onClick={() => {
            const draggedRecently = dragging || Date.now() - dragStartedAt.current < 180;
            if (!draggedRecently) {
              toggleBubble();
            }
          }}
        >
          <div
            className="mb-3 flex h-[72%] w-full items-center justify-center rounded-xl"
            style={{
              background:
                "radial-gradient(circle at 50% 30%, rgba(90,200,250,0.32), rgba(10,132,255,0.08) 45%, transparent 72%)",
            }}
          >
            <Bot size={64} color="var(--accent)" strokeWidth={1.5} />
          </div>

          <div className="flex items-center gap-2 rounded-full px-3 py-1.5 text-[13px] font-medium shadow-sm"
            style={{
              background: "rgba(255,255,255,0.72)",
              color: "var(--t1)",
            }}
          >
            <MessageCircle size={15} />
            小月
          </div>
        </button>

        {bubbleOpen && (
          <div
            className="absolute bottom-full left-0 mb-3 w-[320px] rounded-xl border p-3 shadow-xl"
            style={{
              background: "var(--surface-raise)",
              borderColor: "var(--border)",
              color: "var(--t1)",
            }}
          >
            <div className="text-[13px]" style={{ color: "var(--t2)" }}>
              你好，我是小月。模型和对话会在下一步接上。
            </div>
          </div>
        )}
      </div>
    </Rnd>
  );
}
```

- [ ] **Step 2: Mount avatar in Desktop**

Modify `apps/web/src/components/desktop/Desktop.tsx`:

```tsx
import { AvatarPet } from "./AvatarPet";
```

Add `<AvatarPet />` before Dock:

```tsx
      {/* Window layer */}
      <WindowManager />

      {/* Avatar companion */}
      <AvatarPet />

      {/* Dock — 全屏时隐藏 */}
      {!hasMaximized && <Dock />}
```

- [ ] **Step 3: Run frontend checks**

Run:

```bash
pnpm --filter web test -- src/apps/avatar-pet/avatar-layout.test.ts src/apps/avatar-pet/emotion-parser.test.ts
pnpm --filter web exec tsc --noEmit
```

Expected: tests PASS and TypeScript check PASS.

- [ ] **Step 4: Manual browser check**

Run:

```bash
pnpm --filter web dev
```

Open `http://localhost:3000`.

Expected:

- Static companion appears on the left-bottom side.
- It does not cover the right-side desktop icons.
- It sits above the Dock.
- It can be dragged and resized.
- Clicking opens the temporary bubble.
- Close button hides it.

- [ ] **Step 5: Commit static shell**

Run:

```bash
git add apps/web/src/components/desktop/AvatarPet.tsx apps/web/src/components/desktop/Desktop.tsx
git commit -m "feat: add static avatar desktop shell"
```

---

## Task 7: Avatar Chat Bubble

**Files:**
- Create: `apps/web/src/apps/avatar-pet/avatar-chat.ts`
- Create: `apps/web/src/components/desktop/AvatarBubble.tsx`
- Modify: `apps/web/src/components/desktop/AvatarPet.tsx`

- [ ] **Step 1: Create avatar chat service**

Create `apps/web/src/apps/avatar-pet/avatar-chat.ts`:

```ts
import { API_BASE } from "@/lib/backend";
import type { Conversation } from "@/apps/ai-chat/types";
import { decodeModel, PROVIDERS } from "@/apps/settings/providers";
import type { EmbeddingConfig, ProviderConfig } from "@/stores/settingsStore";

const AGENTS_API = `${API_BASE}/agents`;
export const AVATAR_APP_ID = "avatar-pet";

export type ResolvedAvatarModel = {
  encodedModel: string;
  providerId: string;
  modelId: string;
  provider: ProviderConfig;
  apiBase?: string;
};

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${AGENTS_API}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getOrCreateAvatarConversation(modelId: string): Promise<Conversation> {
  const existing = await apiFetch<Conversation[]>(`/conversations?app_id=${AVATAR_APP_ID}`);
  if (existing[0]) {
    return existing[0];
  }

  return apiFetch<Conversation>("/conversations", {
    method: "POST",
    body: JSON.stringify({
      title: "虚拟伙伴",
      model: modelId,
      app_id: AVATAR_APP_ID,
    }),
  });
}

export function resolveAvatarModel(
  defaultModel: string,
  providers: Record<string, ProviderConfig>,
): ResolvedAvatarModel | null {
  const encodedModel = defaultModel || findFirstConfiguredModel(providers);
  if (!encodedModel) return null;

  const { providerId, modelId } = decodeModel(encodedModel);
  const provider = providers[providerId];
  if (!provider?.apiKey) return null;

  const providerDef = PROVIDERS.find((item) => item.id === providerId);
  return {
    encodedModel,
    providerId,
    modelId,
    provider,
    apiBase: provider.baseUrl || providerDef?.defaultBaseUrl,
  };
}

export function findFirstConfiguredModel(
  providers: Record<string, ProviderConfig>,
): string {
  for (const provider of PROVIDERS) {
    const cfg = providers[provider.id];
    if (cfg?.apiKey && cfg.enabledModels?.length) {
      return `${provider.id}::${cfg.enabledModels[0]}`;
    }
  }
  return "";
}

export function buildAvatarSystemPrompt() {
  return "你是 AI-Native OS 的桌面虚拟伙伴。请遵守当前 App 的完整人设和情绪标签协议。";
}

export function buildAvatarEmbeddingPayload(
  embeddingConfig: EmbeddingConfig | null,
) {
  return embeddingConfig ?? undefined;
}
```

- [ ] **Step 2: Create streaming bubble**

Create `apps/web/src/components/desktop/AvatarBubble.tsx`:

```tsx
"use client";

import { useMemo, useRef, useState } from "react";
import { ExternalLink, Loader2, Send, Square } from "lucide-react";
import { streamChat, type ToolCallEvent, type ToolResultEvent } from "@/hooks/useStream";
import { parseAvatarEmotions } from "@/apps/avatar-pet/emotion-parser";
import {
  AVATAR_APP_ID,
  buildAvatarEmbeddingPayload,
  buildAvatarSystemPrompt,
  getOrCreateAvatarConversation,
  resolveAvatarModel,
} from "@/apps/avatar-pet/avatar-chat";
import { useAvatarStore } from "@/stores/avatarStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useWindowStore } from "@/stores/windowStore";

type BubbleMessage = {
  id: string;
  role: "user" | "assistant" | "error";
  content: string;
  streaming?: boolean;
};

type ToolChip = {
  id: string;
  label: string;
  status: "running" | "done" | "error";
};

export function AvatarBubble() {
  const { providers, defaultModel, embeddingConfig } = useSettingsStore();
  const setCurrentEmotion = useAvatarStore((state) => state.setCurrentEmotion);
  const openWindow = useWindowStore((state) => state.openWindow);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<BubbleMessage[]>([]);
  const [toolChips, setToolChips] = useState<ToolChip[]>([]);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const model = useMemo(
    () => resolveAvatarModel(defaultModel, providers),
    [defaultModel, providers],
  );

  const send = async () => {
    const content = input.trim();
    if (!content || loading) return;
    if (!model) {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "error",
          content: "还没有配置模型和 API Key。可以先去设置里配置模型。",
        },
      ]);
      return;
    }

    setInput("");
    setLoading(true);
    setToolChips([]);
    const assistantId = crypto.randomUUID();
    const abort = new AbortController();
    abortRef.current = abort;

    const nextMessages: BubbleMessage[] = [
      ...messages,
      { id: crypto.randomUUID(), role: "user", content },
      { id: assistantId, role: "assistant", content: "", streaming: true },
    ];
    setMessages(nextMessages);

    try {
      const conversation = await getOrCreateAvatarConversation(model.modelId);
      let rawAssistantText = "";

      await streamChat(
        {
          conversationId: conversation.id,
          appId: AVATAR_APP_ID,
          message: content,
          model: model.modelId,
          providerId: model.providerId,
          history: nextMessages
            .filter((message) => message.role === "user" || message.role === "assistant")
            .filter((message) => message.id !== assistantId)
            .map((message) => ({ role: message.role, content: message.content })),
          systemPrompt: buildAvatarSystemPrompt(),
          apiKey: model.provider.apiKey,
          apiBase: model.apiBase,
          enableMemory: true,
          compatType: model.provider.compatType ?? "openai",
          embeddingConfig: buildAvatarEmbeddingPayload(embeddingConfig),
          llmApiKey: model.provider.apiKey,
          llmApiBase: model.apiBase,
          onToken: (token) => {
            rawAssistantText += token;
            const parsed = parseAvatarEmotions(rawAssistantText);
            setCurrentEmotion(parsed.currentEmotion);
            setMessages((prev) =>
              prev.map((message) =>
                message.id === assistantId
                  ? { ...message, content: parsed.text, streaming: true }
                  : message,
              ),
            );
          },
          onToolCall: (event: ToolCallEvent) => {
            setToolChips((prev) => [
              ...prev.filter((item) => item.id !== event.id),
              {
                id: event.id,
                label: event.displayName || event.name,
                status: "running",
              },
            ]);
          },
          onToolResult: (event: ToolResultEvent) => {
            setToolChips((prev) =>
              prev.map((item) =>
                item.id === event.id
                  ? { ...item, status: event.error ? "error" : "done" }
                  : item,
              ),
            );
          },
        },
        abort.signal,
      );

      setMessages((prev) =>
        prev.map((message) =>
          message.id === assistantId
            ? { ...message, streaming: false }
            : message,
        ),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "发送失败";
      setMessages((prev) =>
        prev.map((item) =>
          item.id === assistantId
            ? { id: assistantId, role: "error", content: message }
            : item,
        ),
      );
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  };

  return (
    <div
      className="flex max-h-[420px] w-[340px] flex-col overflow-hidden rounded-xl border shadow-xl"
      style={{
        background: "var(--surface-raise)",
        borderColor: "var(--border)",
        color: "var(--t1)",
      }}
    >
      <div className="flex items-center justify-between border-b px-3 py-2" style={{ borderColor: "var(--border)" }}>
        <div className="text-[13px] font-semibold">小月</div>
        <button
          type="button"
          className="flex h-7 w-7 items-center justify-center rounded-md"
          title="打开 AI 助手"
          onClick={() => openWindow("ai-chat", "AI 助手", "MessageSquare", { singleton: false })}
        >
          <ExternalLink size={15} />
        </button>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {messages.length === 0 && (
          <p className="text-[13px]" style={{ color: "var(--t2)" }}>
            我在这里。有轻任务可以直接叫我，复杂任务我会帮你打开工作台。
          </p>
        )}
        {messages.map((message) => (
          <div
            key={message.id}
            className="rounded-lg px-3 py-2 text-[13px] leading-relaxed"
            style={{
              background:
                message.role === "user"
                  ? "var(--accent-bg)"
                  : message.role === "error"
                    ? "color-mix(in srgb, var(--red) 12%, transparent)"
                    : "var(--panel-bg)",
              color: message.role === "error" ? "var(--red)" : "var(--t1)",
            }}
          >
            {message.content}
            {message.streaming && <Loader2 className="ml-2 inline animate-spin" size={12} />}
          </div>
        ))}
        {toolChips.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {toolChips.map((chip) => (
              <span
                key={chip.id}
                className="rounded-full px-2 py-0.5 text-[11px]"
                style={{ background: "var(--control-bg)", color: "var(--t2)" }}
              >
                {chip.status === "running" ? "正在使用" : chip.status === "done" ? "已完成" : "失败"} {chip.label}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-2 border-t p-2" style={{ borderColor: "var(--border)" }}>
        <input
          className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-[13px] outline-none"
          style={{
            background: "var(--input-bg)",
            borderColor: "var(--border)",
            color: "var(--t1)",
          }}
          value={input}
          placeholder="和小月说点什么"
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
        />
        <button
          type="button"
          className="flex h-9 w-9 items-center justify-center rounded-lg"
          style={{ background: "var(--accent)", color: "#fff" }}
          onClick={() => loading ? abortRef.current?.abort() : void send()}
          title={loading ? "停止" : "发送"}
        >
          {loading ? <Square size={15} /> : <Send size={15} />}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Replace temporary bubble in AvatarPet**

Modify `apps/web/src/components/desktop/AvatarPet.tsx`.

Add import:

```tsx
import { AvatarBubble } from "./AvatarBubble";
```

Replace the temporary bubble JSX with:

```tsx
        {bubbleOpen && (
          <div className="absolute bottom-full left-0 mb-3">
            <AvatarBubble />
          </div>
        )}
```

- [ ] **Step 4: Run checks**

Run:

```bash
pnpm --filter web test -- src/apps/avatar-pet/emotion-parser.test.ts src/apps/avatar-pet/avatar-layout.test.ts
pnpm --filter web exec tsc --noEmit
```

Expected: tests PASS and TypeScript check PASS.

- [ ] **Step 5: Manual chat check**

Run frontend and backend:

```bash
pnpm --filter web dev
pnpm api:dev
```

Expected:

- With no model configured, the bubble shows a model configuration error.
- With model configured, sending "你好" creates or reuses an `avatar-pet` conversation.
- Returned `[emotion:...]` tags are hidden from visible text.
- Tool chips appear for tool calls.

- [ ] **Step 6: Commit bubble integration**

Run:

```bash
git add apps/web/src/apps/avatar-pet/avatar-chat.ts apps/web/src/components/desktop/AvatarBubble.tsx apps/web/src/components/desktop/AvatarPet.tsx
git commit -m "feat: connect avatar pet chat bubble"
```

---

## Task 8: Asset Policy And Settings UI

**Files:**
- Modify: `.gitignore`
- Create: `apps/web/public/avatar/live2d/.gitkeep`
- Create: `apps/web/public/avatar/live2d/README.md`
- Create: `apps/web/public/vendor/live2d/README.md`
- Create: `apps/web/src/apps/settings/AvatarSettings.tsx`
- Modify: `apps/web/src/apps/settings/Settings.tsx`

- [ ] **Step 1: Add asset ignore rules**

Append to `.gitignore`:

```gitignore

# Local Live2D user assets
apps/web/public/avatar/live2d/*
!apps/web/public/avatar/live2d/.gitkeep
!apps/web/public/avatar/live2d/README.md
apps/web/public/vendor/live2d/live2dcubismcore.min.js
```

- [ ] **Step 2: Add model directory docs**

Create `apps/web/public/avatar/live2d/.gitkeep` as an empty file.

Create `apps/web/public/avatar/live2d/README.md`:

```markdown
# Local Live2D Models

Put your own Live2D model files here for local development.

Supported entry points:

- A Cubism 3/4 `.model3.json` path.
- A `.zip` file that contains one `.model3.json` file and its referenced assets.

This directory is ignored by git except this README and `.gitkeep`.
Avatar assets placed here are not part of the AI-Native OS license.
Only use models that you are allowed to use, modify, and distribute.

Example local URL:

```text
/avatar/live2d/my-model/my-model.model3.json
```
```

- [ ] **Step 3: Add Cubism Core docs**

Create `apps/web/public/vendor/live2d/README.md`:

```markdown
# Live2D Cubism Core

`pixi-live2d-display/cubism4` requires Live2D Cubism Core at runtime.

For local development, place `live2dcubismcore.min.js` in this directory:

```text
apps/web/public/vendor/live2d/live2dcubismcore.min.js
```

The binary runtime is governed by Live2D's SDK license and is not committed to this repository.
If the file is missing, the desktop companion stays available as a static chat entry and shows a runtime warning.
```

- [ ] **Step 4: Create settings panel**

Create `apps/web/src/apps/settings/AvatarSettings.tsx`:

```tsx
"use client";

import { Eye, EyeOff, RotateCcw, Upload } from "lucide-react";
import { useAvatarStore } from "@/stores/avatarStore";

export function AvatarSettings() {
  const {
    visible,
    modelSourceType,
    modelUrl,
    localModelName,
    setVisible,
    resetPlacement,
    setModelUrl,
    setLocalModelName,
    setModelSourceType,
  } = useAvatarStore();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-[18px] font-semibold" style={{ color: "var(--t1)" }}>
          虚拟伙伴
        </h2>
        <p className="mt-1 text-[13px]" style={{ color: "var(--t2)" }}>
          管理左下角 Live2D 桌宠入口、模型来源和位置。
        </p>
      </div>

      <section className="space-y-3">
        <h3 className="text-[14px] font-semibold" style={{ color: "var(--t1)" }}>
          显示
        </h3>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="flex items-center gap-2 rounded-md px-3 py-2 text-[13px]"
            style={{ background: "var(--control-bg)", color: "var(--t1)" }}
            onClick={() => setVisible(!visible)}
          >
            {visible ? <EyeOff size={15} /> : <Eye size={15} />}
            {visible ? "隐藏桌宠" : "显示桌宠"}
          </button>
          <button
            type="button"
            className="flex items-center gap-2 rounded-md px-3 py-2 text-[13px]"
            style={{ background: "var(--control-bg)", color: "var(--t1)" }}
            onClick={resetPlacement}
          >
            <RotateCcw size={15} />
            重置到左下角
          </button>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-[14px] font-semibold" style={{ color: "var(--t1)" }}>
          模型来源
        </h3>
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded-md px-3 py-1.5 text-[13px]"
            style={{
              background: modelSourceType === "url" ? "var(--accent)" : "var(--control-bg)",
              color: modelSourceType === "url" ? "#fff" : "var(--t1)",
            }}
            onClick={() => setModelSourceType("url")}
          >
            URL
          </button>
          <button
            type="button"
            className="rounded-md px-3 py-1.5 text-[13px]"
            style={{
              background: modelSourceType === "zip" ? "var(--accent)" : "var(--control-bg)",
              color: modelSourceType === "zip" ? "#fff" : "var(--t1)",
            }}
            onClick={() => setModelSourceType("zip")}
          >
            本地 ZIP
          </button>
        </div>

        {modelSourceType === "url" ? (
          <input
            className="w-full rounded-md border px-3 py-2 text-[13px] outline-none"
            style={{
              background: "var(--input-bg)",
              borderColor: "var(--border)",
              color: "var(--t1)",
            }}
            value={modelUrl}
            placeholder="/avatar/live2d/my-model/my-model.model3.json"
            onChange={(event) => setModelUrl(event.target.value)}
          />
        ) : (
          <label
            className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-[13px]"
            style={{
              background: "var(--input-bg)",
              borderColor: "var(--border)",
              color: "var(--t1)",
            }}
          >
            <Upload size={15} />
            {localModelName || "选择 Live2D ZIP"}
            <input
              type="file"
              accept=".zip"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                setLocalModelName(file.name);
                event.target.value = "";
              }}
            />
          </label>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 5: Add Settings tab**

Modify `apps/web/src/apps/settings/Settings.tsx`.

Add imports:

```tsx
import { SmilePlus } from "lucide-react";
import { AvatarSettings } from "./AvatarSettings";
```

Extend `Tab`:

```tsx
type Tab =
  | "api-keys"
  | "appearance"
  | "avatar"
  | "memory"
  | "knowledge"
  | "extensions"
  | "about";
```

Add tab item after appearance:

```tsx
  { id: "avatar", label: "虚拟伙伴", icon: <SmilePlus size={15} /> },
```

Add content branch:

```tsx
        {tab === "avatar" && <AvatarSettings />}
```

- [ ] **Step 6: Run checks**

Run:

```bash
git check-ignore apps/web/public/avatar/live2d/example/model.model3.json
git check-ignore apps/web/public/vendor/live2d/live2dcubismcore.min.js
pnpm --filter web exec tsc --noEmit
```

Expected:

- Both `git check-ignore` commands print the ignored paths.
- TypeScript check PASS.

- [ ] **Step 7: Commit asset policy and settings**

Run:

```bash
git add .gitignore apps/web/public/avatar/live2d/.gitkeep apps/web/public/avatar/live2d/README.md apps/web/public/vendor/live2d/README.md apps/web/src/apps/settings/AvatarSettings.tsx apps/web/src/apps/settings/Settings.tsx
git commit -m "feat: add avatar settings and asset policy"
```

---

## Task 9: Live2D Loader Helpers

**Files:**
- Create: `apps/web/src/apps/avatar-pet/live2d-loader.ts`
- Create: `apps/web/src/apps/avatar-pet/live2d-loader.test.ts`

- [ ] **Step 1: Write failing loader tests**

Create `apps/web/src/apps/avatar-pet/live2d-loader.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  classifyLive2DSource,
  findModelSettingsPath,
  isLive2DZipSource,
} from "./live2d-loader";

describe("classifyLive2DSource", () => {
  it("classifies model3 json URLs", () => {
    expect(classifyLive2DSource("/avatar/live2d/hiyori/hiyori.model3.json")).toEqual({
      kind: "model3-json",
      source: "/avatar/live2d/hiyori/hiyori.model3.json",
    });
  });

  it("classifies zip URLs", () => {
    expect(classifyLive2DSource("/avatar/live2d/hiyori.zip")).toEqual({
      kind: "zip",
      source: "/avatar/live2d/hiyori.zip",
    });
  });

  it("returns missing for empty source", () => {
    expect(classifyLive2DSource("")).toEqual({ kind: "missing", source: "" });
  });
});

describe("findModelSettingsPath", () => {
  it("prefers model3 json files over legacy model json files", () => {
    expect(findModelSettingsPath(["foo/model.model.json", "foo/model.model3.json"])).toBe(
      "foo/model.model3.json",
    );
  });
});

describe("isLive2DZipSource", () => {
  it("recognizes zip sources", () => {
    expect(isLive2DZipSource("/x/y.zip")).toBe(true);
    expect(isLive2DZipSource("/x/y.model3.json")).toBe(false);
  });
});
```

- [ ] **Step 2: Run loader tests and verify failure**

Run:

```bash
pnpm --filter web test -- src/apps/avatar-pet/live2d-loader.test.ts
```

Expected: FAIL because `live2d-loader.ts` does not exist.

- [ ] **Step 3: Implement loader helpers**

Create `apps/web/src/apps/avatar-pet/live2d-loader.ts`:

```ts
export type Live2DSourceKind = "missing" | "model3-json" | "zip" | "unknown";

export type Live2DSourceClassification = {
  kind: Live2DSourceKind;
  source: string;
};

export function isLive2DZipSource(source: string) {
  return source.trim().toLowerCase().endsWith(".zip");
}

export function classifyLive2DSource(source: string): Live2DSourceClassification {
  const normalized = source.trim();
  const lower = normalized.toLowerCase();
  if (!normalized) return { kind: "missing", source: "" };
  if (lower.endsWith(".model3.json")) {
    return { kind: "model3-json", source: normalized };
  }
  if (lower.endsWith(".zip")) {
    return { kind: "zip", source: normalized };
  }
  return { kind: "unknown", source: normalized };
}

export function findModelSettingsPath(paths: string[]): string | null {
  const normalized = paths.map((path) => path.replaceAll("\\", "/"));
  const model3 = normalized.find((path) => path.toLowerCase().endsWith(".model3.json"));
  if (model3) return model3;
  return normalized.find((path) => path.toLowerCase().endsWith(".model.json")) ?? null;
}
```

- [ ] **Step 4: Run loader tests**

Run:

```bash
pnpm --filter web test -- src/apps/avatar-pet/live2d-loader.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit loader helpers**

Run:

```bash
git add apps/web/src/apps/avatar-pet/live2d-loader.ts apps/web/src/apps/avatar-pet/live2d-loader.test.ts
git commit -m "feat: add live2d loader helpers"
```

---

## Task 10: Live2D Canvas Runtime

**Files:**
- Create: `apps/web/src/components/desktop/Live2DCanvas.tsx`
- Modify: `apps/web/src/components/desktop/AvatarPet.tsx`

- [ ] **Step 1: Create Live2D canvas component**

Create `apps/web/src/components/desktop/Live2DCanvas.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { Bot } from "lucide-react";
import { classifyLive2DSource } from "@/apps/avatar-pet/live2d-loader";
import { getLive2DExpressionPlan } from "@/apps/avatar-pet/emotion-map";
import type { AvatarEmotion } from "@/apps/avatar-pet/emotion-parser";

type Live2DCanvasProps = {
  modelUrl: string;
  emotion: AvatarEmotion;
};

function hasCubismCore() {
  return typeof window !== "undefined" && Boolean((window as Window & { Live2DCubismCore?: unknown }).Live2DCubismCore);
}

async function loadCubismCore() {
  if (hasCubismCore()) return true;
  await new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      "script[data-live2d-cubism-core='true']",
    );
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Live2D Cubism Core 加载失败")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = "/vendor/live2d/live2dcubismcore.min.js";
    script.async = true;
    script.dataset.live2dCubismCore = "true";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("缺少 /vendor/live2d/live2dcubismcore.min.js"));
    document.head.appendChild(script);
  });
  return hasCubismCore();
}

export function Live2DCanvas({ modelUrl, emotion }: Live2DCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const modelRef = useRef<any>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let disposed = false;
    let app: any = null;

    async function mount() {
      const classified = classifyLive2DSource(modelUrl);
      if (classified.kind === "missing") {
        setError("请在设置里配置 Live2D 模型。");
        return;
      }
      if (classified.kind === "unknown") {
        setError("模型地址需要是 .model3.json 或 .zip。");
        return;
      }

      try {
        await loadCubismCore();
        if (disposed || !hostRef.current) return;

        const PIXI = await import("pixi.js");
        const { Live2DModel } = await import("pixi-live2d-display/cubism4");
        (window as Window & { PIXI?: unknown }).PIXI = PIXI;

        app = new PIXI.Application({
          resizeTo: hostRef.current,
          backgroundAlpha: 0,
          antialias: true,
          autoDensity: true,
          resolution: Math.min(window.devicePixelRatio || 1, 2),
        });

        hostRef.current.innerHTML = "";
        hostRef.current.appendChild(app.view as HTMLCanvasElement);

        const model = await Live2DModel.from(classified.source, { autoInteract: false });
        if (disposed) {
          model.destroy();
          return;
        }

        modelRef.current = model;
        app.stage.addChild(model);

        model.anchor.set(0.5, 0.5);
        const scale = Math.min(
          hostRef.current.clientWidth / Math.max(model.width, 1),
          hostRef.current.clientHeight / Math.max(model.height, 1),
        ) * 1.85;
        model.scale.set(scale);
        model.x = hostRef.current.clientWidth / 2;
        model.y = hostRef.current.clientHeight * 0.96;

        setError("");
      } catch (err) {
        const message = err instanceof Error ? err.message : "Live2D 初始化失败";
        setError(message);
      }
    }

    void mount();

    return () => {
      disposed = true;
      modelRef.current = null;
      if (app) {
        app.destroy(true, { children: true, texture: true, baseTexture: true });
      }
    };
  }, [modelUrl]);

  useEffect(() => {
    const model = modelRef.current;
    if (!model) return;
    const plan = getLive2DExpressionPlan(emotion);
    for (const name of plan.expressionNames) {
      try {
        model.expression(name);
        return;
      } catch {
        continue;
      }
    }
  }, [emotion]);

  return (
    <div ref={hostRef} className="relative h-full w-full">
      {error && (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3 rounded-xl text-center">
          <Bot size={58} color="var(--accent)" strokeWidth={1.5} />
          <span className="max-w-[180px] text-[12px]" style={{ color: "var(--t2)" }}>
            {error}
          </span>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Render Live2DCanvas inside AvatarPet**

Modify `apps/web/src/components/desktop/AvatarPet.tsx`.

Add imports:

```tsx
import { Live2DCanvas } from "./Live2DCanvas";
```

Read store state:

```tsx
  const modelUrl = useAvatarStore((state) => state.modelUrl);
  const currentEmotion = useAvatarStore((state) => state.currentEmotion);
```

Replace the static `Bot` visual block with:

```tsx
          <div
            className="mb-3 h-[72%] w-full overflow-hidden rounded-xl"
            style={{
              background:
                "radial-gradient(circle at 50% 30%, rgba(90,200,250,0.32), rgba(10,132,255,0.08) 45%, transparent 72%)",
            }}
          >
            <Live2DCanvas modelUrl={modelUrl} emotion={currentEmotion} />
          </div>
```

- [ ] **Step 3: Run checks**

Run:

```bash
pnpm --filter web test -- src/apps/avatar-pet/emotion-parser.test.ts src/apps/avatar-pet/avatar-layout.test.ts src/apps/avatar-pet/live2d-loader.test.ts
pnpm --filter web exec tsc --noEmit
```

Expected: tests PASS and TypeScript check PASS.

- [ ] **Step 4: Manual runtime check without Cubism Core**

Run:

```bash
pnpm --filter web dev
```

Expected:

- Desktop still loads.
- Companion shows static fallback with message about missing `/vendor/live2d/live2dcubismcore.min.js`.
- Chat bubble still works.

- [ ] **Step 5: Manual runtime check with model**

Place local Cubism Core at:

```text
apps/web/public/vendor/live2d/live2dcubismcore.min.js
```

Place a user-owned model under:

```text
apps/web/public/avatar/live2d/my-model/
```

Set model URL in settings:

```text
/avatar/live2d/my-model/my-model.model3.json
```

Expected:

- Live2D model appears in the companion frame.
- Emotion labels change expression when matching expressions exist.
- Missing expressions do not crash the widget.

- [ ] **Step 6: Commit Live2D runtime**

Run:

```bash
git add apps/web/src/components/desktop/Live2DCanvas.tsx apps/web/src/components/desktop/AvatarPet.tsx
git commit -m "feat: render live2d avatar model"
```

---

## Task 11: Local ZIP Import And Cache

**Files:**
- Modify: `apps/web/src/apps/avatar-pet/live2d-loader.ts`
- Modify: `apps/web/src/apps/avatar-pet/live2d-loader.test.ts`
- Modify: `apps/web/src/apps/settings/AvatarSettings.tsx`
- Modify: `apps/web/src/components/desktop/Live2DCanvas.tsx`

- [ ] **Step 1: Add failing zip extraction helper test**

Append to `apps/web/src/apps/avatar-pet/live2d-loader.test.ts`:

```ts
import JSZip from "jszip";
import { prepareZipModelBlob } from "./live2d-loader";

describe("prepareZipModelBlob", () => {
  it("returns a blob URL for a zip with model settings", async () => {
    const zip = new JSZip();
    zip.file("model/test.model3.json", JSON.stringify({ Version: 3, FileReferences: {} }));
    const blob = await zip.generateAsync({ type: "blob" });

    const result = await prepareZipModelBlob(blob);

    expect(result.modelSettingsPath).toBe("model/test.model3.json");
    expect(result.objectUrl.startsWith("blob:")).toBe(true);
    URL.revokeObjectURL(result.objectUrl);
  });
});
```

- [ ] **Step 2: Run loader tests and verify failure**

Run:

```bash
pnpm --filter web test -- src/apps/avatar-pet/live2d-loader.test.ts
```

Expected: FAIL because `prepareZipModelBlob` does not exist.

- [ ] **Step 3: Implement zip helper**

Add to `apps/web/src/apps/avatar-pet/live2d-loader.ts`:

```ts
import JSZip from "jszip";

export type PreparedZipModel = {
  objectUrl: string;
  modelSettingsPath: string;
};

export async function prepareZipModelBlob(blob: Blob): Promise<PreparedZipModel> {
  const zip = await JSZip.loadAsync(blob);
  const paths = Object.keys(zip.files).filter((path) => !zip.files[path].dir);
  const modelSettingsPath = findModelSettingsPath(paths);
  if (!modelSettingsPath) {
    throw new Error("ZIP 中没有找到 .model3.json 文件。");
  }
  return {
    objectUrl: URL.createObjectURL(blob),
    modelSettingsPath,
  };
}
```

- [ ] **Step 4: Store selected zip in IndexedDB**

Install has already added `idb-keyval`. In `apps/web/src/apps/avatar-pet/live2d-loader.ts`, add:

```ts
import { get, set } from "idb-keyval";

const AVATAR_ZIP_KEY = "ainative-avatar-live2d-zip";

export async function saveAvatarZip(file: File): Promise<void> {
  await set(AVATAR_ZIP_KEY, file);
}

export async function loadAvatarZip(): Promise<File | null> {
  const value = await get<File>(AVATAR_ZIP_KEY);
  return value instanceof File ? value : null;
}
```

- [ ] **Step 5: Wire ZIP save in settings**

Modify the file input handler in `AvatarSettings.tsx`:

```tsx
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                const { saveAvatarZip } = await import("@/apps/avatar-pet/live2d-loader");
                await saveAvatarZip(file);
                setLocalModelName(file.name);
                event.target.value = "";
              }}
```

- [ ] **Step 6: Load ZIP in Live2DCanvas**

Modify `Live2DCanvas.tsx` mount logic before classifying URL:

```tsx
      let source = modelUrl;
      if (!source) {
        const { loadAvatarZip, prepareZipModelBlob } = await import("@/apps/avatar-pet/live2d-loader");
        const zip = await loadAvatarZip();
        if (zip) {
          const prepared = await prepareZipModelBlob(zip);
          source = prepared.objectUrl;
        }
      }

      const classified = classifyLive2DSource(source);
```

Keep cleanup simple: if a blob URL was created, revoke it in the effect cleanup.

Add near the top of the effect:

```tsx
    let objectUrlToRevoke = "";
```

When assigning `prepared.objectUrl`:

```tsx
          objectUrlToRevoke = prepared.objectUrl;
```

In cleanup:

```tsx
      if (objectUrlToRevoke) {
        URL.revokeObjectURL(objectUrlToRevoke);
      }
```

- [ ] **Step 7: Run tests and build**

Run:

```bash
pnpm --filter web test -- src/apps/avatar-pet/live2d-loader.test.ts
pnpm --filter web exec tsc --noEmit
```

Expected: tests PASS and TypeScript check PASS.

- [ ] **Step 8: Manual ZIP import check**

Open Settings > 虚拟伙伴, choose a `.zip` containing a `.model3.json`, then return to Desktop.

Expected:

- Selected file name appears in settings.
- Desktop companion attempts to load the zip model.
- Invalid zip shows a readable error and does not crash the page.

- [ ] **Step 9: Commit ZIP import**

Run:

```bash
git add apps/web/src/apps/avatar-pet/live2d-loader.ts apps/web/src/apps/avatar-pet/live2d-loader.test.ts apps/web/src/apps/settings/AvatarSettings.tsx apps/web/src/components/desktop/Live2DCanvas.tsx
git commit -m "feat: support local live2d zip import"
```

---

## Task 12: Final Verification And Polish

**Files:**
- Modify only files touched by earlier tasks if verification finds issues.

- [ ] **Step 1: Run backend tests**

Run:

```bash
cd apps/api
uv run pytest tests/test_avatar_pet_skill_context.py -q
```

Expected: PASS.

- [ ] **Step 2: Run frontend tests**

Run:

```bash
pnpm --filter web test
```

Expected: PASS.

- [ ] **Step 3: Run TypeScript check**

Run:

```bash
pnpm --filter web exec tsc --noEmit
```

Expected: TypeScript check succeeds without frontend type errors.

- [ ] **Step 4: Start dev servers**

Run in separate terminals:

```bash
pnpm api:dev
pnpm --filter web dev
```

Expected:

- FastAPI starts without App Registry errors.
- Next.js starts at `http://localhost:3000`.

- [ ] **Step 5: Browser verification**

Open `http://localhost:3000`.

Check:

- Desktop loads.
- Avatar appears left-bottom above Dock.
- Right-side app icons are not covered.
- Avatar can be moved and resized.
- Refresh preserves position and size.
- Close button hides avatar.
- Settings > 虚拟伙伴 can show avatar again.
- Reset returns avatar to left-bottom.
- Missing Live2D runtime shows static fallback.
- Valid model URL renders model.
- Valid ZIP import attempts model load.
- Bubble sends chat through `avatar-pet`.
- `[emotion:happy]` is not visible in bubble text.
- Emotion state changes do not crash when expression names are missing.
- Tool events appear as chips.
- Dangerous tool calls still show confirmation through the existing mechanism.
- Open AI Chat button opens the AI Chat window.

- [ ] **Step 6: Inspect git status**

Run:

```bash
git status --short
```

Expected:

- Only intentional files are modified.
- User-owned ignored Live2D model files do not appear.
- Existing unrelated deletion `docs/avatar-integration-plan.md`, if still present, remains unrelated and unstaged unless the user separately asks to handle it.

- [ ] **Step 7: Final commit**

If final verification required polish edits, commit them:

```bash
git add <verified-files>
git commit -m "fix: polish avatar pet integration"
```

If no polish edits were made after Task 11, do not create an empty commit.

---

## Self-Review

Spec coverage:

- Left-bottom desktop companion: Task 5 and Task 6.
- Existing Agent, Memory, MCP reuse: Task 1, Task 2, and Task 7.
- `avatar-pet` App Skill and full prompt injection: Task 1 and Task 2.
- URL model support: Task 8, Task 9, Task 10.
- Local ZIP import: Task 11.
- No model assets in repository: Task 8 and Task 12.
- Complex tasks route to AI Chat workbench: Task 7.
- Live2D optional runtime and fallback: Task 10.
- Emotion tags hidden from user and mapped to avatar state: Task 4 and Task 7.

Placeholder scan:

- No unresolved placeholder markers.
- No incomplete-code notes.
- No open-ended implementation steps without commands or code.

Type consistency:

- `AvatarEmotion` is defined in `emotion-parser.ts` and imported by store, map, and canvas.
- `AvatarPosition` and `AvatarSize` are defined in `avatar-layout.ts` and imported by store.
- `AVATAR_APP_ID` is defined in `avatar-chat.ts` and reused by the chat bubble.
- `inject_full_prompt` is normalized in `app_manifest.py` and read from `manifest.skill` in `skill_context.py`.
