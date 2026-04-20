# 虚拟人接入 AI-Native-OS（桌宠模式 + VRM + 统一人设）

## Context

用户希望在 AI-Native-OS 中接入一个轻量级卡通虚拟人，并把 AI 助手功能跟虚拟人结合。参考了 MiniMax-AI/OpenRoom 和 moeru-ai/airi。关键诉求：
- 虚拟人**不要过重**（避免 OpenRoom 那种需要建模师自产 GLB 的重资产路线）。
- **统一人设**：用户直接跟虚拟人对话，背后仍是现有 agent_loop + MCP 工具，保持一致。

## 关键决策（已确认）

| 决策项 | 选择 |
|---|---|
| 渲染格式 | **VRM 3D**（`@pixiv/three-vrm` + `@react-three/fiber`），MIT / 免费模型 / 标准 blendshapes |
| 承载形式 | **桌面浮窗 / 桌宠模式**（始终挂在 Desktop 上的浮动 widget） |
| v1 范围 | **只做视觉 + 文本**，TTS + 口型同步留到 v2 |
| 人设 | **统一人设**：SKILL.md 注入角色人格；LLM 输出里嵌 emotion 标签驱动表情 |

## 候选方案调研摘要

| 方案 | 运行时 | 模型资产 | License | 表情 | 口型 | React 集成 |
|---|---|---|---|---|---|---|
| **VRM（@pixiv/three-vrm + R3F）** ⭐ | 300–500 KB gz | ✅ VRoid Studio 免费；VRoid Hub 海量免费模型 | ✅ MIT | ✅ 标准 blendshapes | ✅ 标准 viseme | 最好 |
| Live2D（pixi-live2d-display） | ~400 KB + Cubism Core | ⚠️ 需购买/授权 | ⚠️ **年营收 ¥10M 以上需商授，AI chatbot 用途需 Live2D 额外审核** | ✅ | ✅ | 可用 |
| Rive | ~200 KB | 必须自己画 | ✅ | 有限 | 需自建 | 好 |
| Lottie | 最小 | 自制 | ✅ | 差 | ❌ | 好 |
| 自研 GLB（OpenRoom 路线） | — | ❌ 需建模师 | — | 实现而异 | 实现而异 | 好 |

参考：
- MiniMax-AI/OpenRoom 实际用的是 `three` + `@react-three/fiber` + `@react-three/drei` + `@react-spring/three` + 自研 GLB，重资产。
- moeru-ai/airi 双轨都做（`stage-ui-live2d` / `stage-ui-three`）；3D 轨用的正是 `@pixiv/three-vrm` + `wlipsync`。airi 是 Vue，迁到 React 就是把 `@tresjs/core` 换成 `@react-three/fiber`。

## 架构总览

```
┌──────────────────────────────────────────────────────────────┐
│ Desktop.tsx                                                   │
│                                                               │
│   <AvatarPet />   ←── react-rnd 浮动 widget，始终在线        │
│     ├── <Canvas>   R3F 画布                                   │
│     │     └── VRMScene (VRM 模型 + 待机动画 + 看鼠标 + 眨眼) │
│     └── <AvatarBubble>  点击角色弹出的对话气泡               │
│            └── 调用 streamChat(/api/v1/agents/stream)        │
│                ← SSE 流，边收边解析 [emotion:happy] 标签     │
│                ← 驱动 VRM blendshape + idle animation 切换  │
└──────────────────────────────────────────────────────────────┘

后端零入侵——完全复用现有 agent_loop：
  appId: "avatar-pet" → skill_context.py 自动注入 avatar-pet/SKILL.md
  SKILL.md 里定义：人设、说话风格、emotion 标签协议
  MCP 工具依然可用（打开应用、读文件等，跟 ai-chat 完全等价）
```

## 前端改动

### 新增依赖（apps/web/package.json）

```
three                @latest   // WebGL 基础
@react-three/fiber   @latest   // React 绑定
@react-three/drei    @latest   // 常用 helper（OrbitControls、useGLTF 等）
@pixiv/three-vrm     @latest   // VRM 加载 + blendshape + lookAt
```

合计 gzip 后约 300–500 KB；用 Next.js 的 `dynamic(() => ..., { ssr: false })` 动态载入，不影响首屏。

### 新增文件

| 路径 | 作用 |
|---|---|
| `apps/web/src/components/desktop/AvatarPet.tsx` | 桌宠容器（react-rnd 浮窗 + Canvas + 气泡） |
| `apps/web/src/components/desktop/VRMScene.tsx` | R3F 场景：加载 VRM、待机动画、lookAt、自动眨眼 |
| `apps/web/src/components/desktop/AvatarBubble.tsx` | 对话气泡：输入框 + 流式回复展示 |
| `apps/web/src/apps/avatar-pet/emotion-parser.ts` | 从流式文本里剥离 `[emotion:xxx]` 标签，产出 `{text, emotions[]}` |
| `apps/web/src/apps/avatar-pet/vrm-expressions.ts` | emotion 名 → VRM blendshape preset 的映射（neutral/happy/sad/angry/surprised/relaxed） |
| `apps/web/src/stores/avatarStore.ts` | Zustand：`visible`、`position`、`size`、`vrmUrl`、`currentEmotion`、`bubbleOpen` |
| `apps/web/public/avatar/default.vrm` | 默认免费模型（VRM Consortium AvatarSample_A/B/F，CC0） |

### 修改的文件

- `apps/web/src/components/desktop/Desktop.tsx` — 在 Dock/Window 同级挂载 `<AvatarPet />`，受 `avatarStore.visible` 控制。
- `apps/web/src/apps/settings/AppManager.tsx` 或新增 `AvatarSettings.tsx` — 设置项：开关桌宠、切换 VRM 模型（上传 .vrm 文件）、位置复位、角色人设预设。
- `apps/web/src/hooks/useStream.ts` — 不改实现，复用。`AvatarBubble` 调用同一个 `streamChat`，只是传 `appId: "avatar-pet"`。

### 交互流程

1. Desktop 加载 → 若 `avatarStore.visible`，渲染 AvatarPet（react-rnd 默认锁定在右下角，可拖动）。
2. VRM 模型 mount → 启动 idle breathing 动画 + 自动眨眼 + eye lookAt 跟鼠标。
3. 用户点击角色 → `bubbleOpen = true`，气泡展开带输入框。
4. 用户发送消息 → `streamChat({ appId: "avatar-pet", message, systemPrompt, model })` 流式返回。
5. 前端一边渲染文字，一边用 `emotion-parser` 剥离 `[emotion:happy]` 之类标签，调 `vrmExpressionManager.setValue("happy", 1.0)` 并在 1s 后回落到 neutral。
6. 工具调用：跟 ai-chat 完全一致——后端 agent_loop 自动处理 tool_call / tool_result，前端气泡里用小 chip 展示"正在打开文件管理器…"。

## 后端改动（最小）

### 新增：`apps/api/apps_registry/avatar-pet/`

**manifest.json**
```json
{
  "id": "avatar-pet",
  "name": "虚拟伙伴",
  "version": "1.0.0",
  "description": "带情感人设的桌面虚拟人，与 AI 助手共享工具能力",
  "category": "companion",
  "permissions": ["network"],
  "tools": [],
  "mcp": { "transport": "builtin" },
  "skill": { "entrypoint": "SKILL.md", "format": "skill-md" }
}
```

**SKILL.md**（核心——人设 + emotion 标签协议）

```markdown
---
name: 虚拟伙伴
description: 桌面虚拟人的人设、语气、情感表达协议
app_id: avatar-pet
---

## 人设

你叫「小月」，是用户的桌面虚拟伙伴。性格温和、好奇、偶尔俏皮。第一人称用「我」，对用户称「你」。回复简短自然，像朋友聊天，不要像客服。

## 情感标签协议（重要）

在你的每段回复里，用 `[emotion:xxx]` 标签标记当前情绪，前端会据此切换表情。可用值：
- `[emotion:neutral]` — 平静（默认）
- `[emotion:happy]`   — 开心、被夸奖、解决问题时
- `[emotion:sad]`     — 表达遗憾、共情
- `[emotion:angry]`   — 轻微抗议、开玩笑的生气
- `[emotion:surprised]` — 惊讶、意外
- `[emotion:relaxed]` — 放松、闲聊

规则：
1. 每次回复开头先放一个 emotion 标签。
2. 情感发生变化时再插一个新标签。
3. 不要解释标签，用户看不到它。

## 工具使用

你可以使用系统提供的所有工具（文件、浏览器、终端、笔记等）——使用方式与 AI 助手完全一致。不要因为人设就拒绝工具调用。
```

**不需要改动** `app_registry.py` / `skill_context.py` 的代码——它们已经是"扫描目录 + manifest.json 注册 + 按 appId/关键词选 skill"的机制，新增一个目录就会被自动识别（见 `apps/api/app/core/skill_context.py` 的 `get_app_registry()` 调用链）。

## 默认 VRM 模型

放一个永久免费、MIT 或 CC0 的示例模型到 `apps/web/public/avatar/default.vrm`。推荐 **VRM Consortium 的 AvatarSample_A/B/F**（官方 CC0）或 Nikechan（VRoid Hub CC-BY）。用户可在设置里上传自己的 .vrm 替换。

## Verification（端到端验证）

1. `cd apps/web && npm install && npm run dev`
2. 访问桌面，右下角应出现虚拟人浮窗，idle 待机动画、眨眼、视线跟随鼠标都正常。
3. 点击虚拟人 → 气泡弹出，输入"你好" → 流式返回带人设语气的回复。
4. 输入"我刚才解决了一个大 bug，好开心" → 观察表情是否切到 happy（通过 `[emotion:happy]` 标签驱动）。
5. 输入"帮我新建一个笔记叫 test" → 后端 agent_loop 调用 notes 工具，气泡里展示 tool_call chip，确认工具链路跟 ai-chat 一致。
6. 进设置 → 关闭桌宠 → 浮窗消失；重新打开 → 位置记忆。
7. 上传自定义 .vrm → 模型应能正确替换。

## v2 预留口子（本期不做）

- TTS：后端 agent_loop 新增一路 SSE 事件 `audio_chunk`，前端对接（建议 ElevenLabs 或 MiniMax T2A）。
- 口型：用 `wlipsync` 或 VRM viseme，接收音频流实时算口型。
- 桌面级透明穿透：需要 Electron / Tauri 打包才能真正挂在桌面上层，v2 再做。
- 多角色切换、用户自定义人设预设。

## 不做的事（避免 scope 膨胀）

- 不碰 OpenRoom 那种自研 GLB 路线。
- 不引入 Live2D（许可证风险，且需要额外模型授权）。
- 不在 v1 做语音和口型——范围控制。
- 不改现有 ai-chat 布局；桌宠是独立挂件，不强耦合。
