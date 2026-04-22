# AI-Native OS — 架构与实施方案

## 1. 愿景

AI-Native OS is a web 端完全体 AI 操作系统。它不是一个"套了 Windows 皮肤的网页"，而是一个以 **AI Agent 为核心运行时**的新计算范式。

- 传统 OS 的核心是 **进程调度 + 文件系统**
- AI OS 的核心是 **Agent 调度 + 知识系统**

每一个"应用"都是一个 App：它可以带有独立 UI、运行时配置，以及按需启用的 Agent 能力。只有明确属于 Agent 的能力单元时，才使用 Skill 这个术语。操作系统本身是一个 Meta-Agent，负责理解用户意图、路由到对应 App / Agent，并协调多 Agent 协作。

### 1.1 核心范式对比

| 传统操作系统      | AI 操作系统                                          |
| ----------------- | ---------------------------------------------------- |
| 应用程序（.exe）  | App（UI Component + Agent Runtime）                  |
| 文件系统          | 宿主文件映射 + 知识库（PostgreSQL + Qdrant + MinIO） |
| 进程间通信（IPC） | Agent 消息总线（WebSocket + Redis Pub/Sub）          |
| 系统 API          | 工具调用（MCP Protocol）                             |
| 内存管理          | 上下文管理 + 长期记忆（Mem0）                        |
| 应用商店          | App 市场                                             |
| 用户偏好设置      | Agent 人格 / 行为配置                                |
| 任务管理器        | Agent 状态仪表盘                                     |
| 内核              | Meta-Agent（LangGraph 编排器）                       |

### 1.2 设计哲学：Harness Engineering

> "与其追逐更强的模型，不如构建更好的驾驭系统。"

本项目的核心设计思想源自 **Harness Engineering** 范式（2026年业界共识）：AI Agent 就像一匹动力强劲但难以预测的马，Harness（马具）是那套让它既能跑得快、又不会跑偏的缰绳与马鞍。

AI OS 本质上就是一套 **Super Agent Harness**——不优化模型本身，而是构建运行模型的完整环境：

```
┌─────────────────────────────────────────────────────────────┐
│                    AI OS = Agent Harness                    │
│                                                             │
│  约束（Constrain）   ── 沙箱隔离、权限边界、MCP 协议        │
│  告知（Inform）      ── 记忆系统、RAG、App/Skill 上下文注入 │
│  验证（Verify）      ── 工具调用结果校验、Human-in-the-loop  │
│  纠正（Correct）     ── 反馈循环、Agent 自我修复机制         │
└─────────────────────────────────────────────────────────────┘
```

四个支柱在本系统中的体现：

| Harness 支柱 | 在本系统的实现                                             |
| ------------ | ---------------------------------------------------------- |
| 约束         | MCP 进程隔离、Docker 沙箱、工具权限声明（manifest.json）   |
| 告知         | Mem0 长期记忆、Qdrant RAG、按 App / Skill 动态加载上下文   |
| 验证         | 工具调用结果可视化、Human-in-the-loop 确认节点             |
| 纠正         | Agent 循环中的错误重试、用户反馈写回记忆、LangGraph 检查点 |

---

## 2. 技术栈

### 2.1 前端

| 层级     | 选型                     | 理由                                    |
| -------- | ------------------------ | --------------------------------------- |
| 框架     | Next.js 15 + TypeScript  | App Router、RSC、API Routes，生态最丰富 |
| 窗口管理 | react-rnd                | daedalOS 生产验证，支持拖拽与缩放       |
| 状态管理 | Zustand                  | 轻量、TypeScript 友好、支持中间件       |
| 样式     | Tailwind CSS + shadcn/ui | 快速开发 + 高质量组件库                 |
| 实时通信 | WebSocket（原生）        | LLM 流式响应 + Agent 间通信             |
| 图标     | Lucide React             | 一致的图标系统                          |

### 2.2 后端

| 层级       | 选型                       | 理由                                            |
| ---------- | -------------------------- | ----------------------------------------------- |
| API 服务   | Python FastAPI             | 异步、高性能、AI/ML 生态兼容                    |
| Agent 编排 | LangGraph                  | 图状态机、检查点、人工干预节点                  |
| 工具协议   | MCP                        | 标准化工具发现与调用、Anthropic 官方标准        |
| LLM 集成   | LiteLLM                    | 统一接口，支持 100+ 模型提供商，用户自带 Key    |
| 代码沙箱   | Docker（AIO Sandbox 模式） | 每个任务独立容器，完整文件系统 + Bash，隔离安全 |

#### 后端分层原则（借鉴 DeerFlow）

严格单向依赖：**App 层 → Harness 层**，Harness 层不引用 App 层。

```
apps/api/app/
  core/        ← Harness 层：Agent 编排、Tools、Memory、RAG（不依赖 FastAPI）
  api/         ← App 层：FastAPI 路由、WebSocket（依赖 core）
```

这样 `core/` 可以独立测试，未来替换 Web 框架也不影响 Agent 逻辑。

### 2.3 数据层

| 层级      | 选型           | 理由                                                |
| --------- | -------------- | --------------------------------------------------- |
| 主数据库  | PostgreSQL 16  | 关系数据 + pgvector 向量扩展一体化                  |
| 向量检索  | Qdrant         | 高性能向量数据库，支持 score_threshold、分批 upsert |
| 缓存/消息 | Redis 7        | Session 状态、Agent 消息总线、缓存                  |
| 对象存储  | MinIO          | S3 兼容、自托管，用于知识库原始文档与二进制对象存储 |
| 长期记忆  | Mem0           | 跨会话用户记忆、Agent 记忆                          |
| ORM       | SQLAlchemy 2.0 | 异步支持、成熟稳定                                  |

### 2.4 基础设施

| 层级        | 选型           | 理由                     |
| ----------- | -------------- | ------------------------ |
| Monorepo    | Turborepo      | 快速构建、缓存、依赖管理 |
| 包管理器    | pnpm           | 高效磁盘使用、严格依赖   |
| 容器化      | Docker Compose | 本地开发一键启动         |
| Python 环境 | uv             | 极速 Python 包管理       |

---

## 3. 项目结构

```
ai-native-os/
│
├── apps/
│   ├── web/                          # Next.js 前端
│   │   ├── src/
│   │   │   ├── app/                  # Next.js App Router
│   │   │   │   ├── layout.tsx        # Root layout
│   │   │   │   ├── page.tsx          # Desktop entry (login → desktop)
│   │   │   │   └── api/              # API routes (proxy to backend)
│   │   │   │       └── [...proxy]/route.ts
│   │   │   │
│   │   │   ├── components/
│   │   │   │   ├── desktop/
│   │   │   │   │   ├── Desktop.tsx           # 桌面容器（壁纸、图标网格、右键菜单）
│   │   │   │   │   ├── DesktopIcon.tsx       # 桌面图标（双击打开 App）
│   │   │   │   │   ├── Taskbar.tsx           # 底部任务栏
│   │   │   │   │   ├── StartMenu.tsx         # 开始菜单（App 列表、搜索）
│   │   │   │   │   ├── SystemTray.tsx        # 系统托盘（时钟、网络、通知）
│   │   │   │   │   └── ContextMenu.tsx       # 右键菜单
│   │   │   │   │
│   │   │   │   ├── window/
│   │   │   │   │   ├── WindowManager.tsx     # 窗口管理容器
│   │   │   │   │   ├── Window.tsx            # 窗口组件（react-rnd wrapper）
│   │   │   │   │   ├── TitleBar.tsx          # 标题栏（拖拽、最小化/最大化/关闭）
│   │   │   │   │   └── WindowSnapZone.tsx    # 窗口吸附区域
│   │   │   │   │
│   │   │   │   └── ui/                       # shadcn/ui 基础组件
│   │   │   │
│   │   │   ├── apps/                         # 内置 App UI 组件
│   │   │   │   ├── ai-chat/
│   │   │   │   │   ├── AiChat.tsx            # AI 对话主界面
│   │   │   │   │   ├── MessageBubble.tsx     # 消息气泡
│   │   │   │   │   ├── ToolCallDisplay.tsx   # 工具调用可视化
│   │   │   │   │   └── ModelSelector.tsx     # 模型选择器
│   │   │   │   │
│   │   │   │   ├── file-manager/
│   │   │   │   │   ├── FileManager.tsx       # 文件管理器主界面
│   │   │   │   │   ├── FileTree.tsx          # 文件树
│   │   │   │   │   ├── FileGrid.tsx          # 文件网格视图
│   │   │   │   │   └── FilePreview.tsx       # 文件预览
│   │   │   │   │
│   │   │   │   ├── document-editor/
│   │   │   │   │   ├── DocumentEditor.tsx    # 文档编辑器（Tiptap/ProseMirror）
│   │   │   │   │   ├── AiWritingAssist.tsx   # AI 写作辅助面板
│   │   │   │   │   └── FormatToolbar.tsx     # 格式工具栏
│   │   │   │   │
│   │   │   │   ├── terminal/
│   │   │   │   │   └── Terminal.tsx           # 终端（当前为自定义 AI 终端实现，可选升级到 xterm.js）
│   │   │   │   │
│   │   │   │   ├── browser/
│   │   │   │   │   ├── Browser.tsx           # 内置浏览器（iframe）
│   │   │   │   │   └── AiSummary.tsx         # AI 网页摘要
│   │   │   │   │
│   │   │   │   ├── settings/
│   │   │   │   │   ├── Settings.tsx          # 设置面板
│   │   │   │   │   ├── ApiKeyConfig.tsx      # API Key 配置
│   │   │   │   │   ├── ThemeConfig.tsx       # 主题配置
│   │   │   │   │   ├── MemoryConfig.tsx      # 记忆管理
│   │   │   │   │   └── AppConfig.tsx         # App 管理
│   │   │   │   │
│   │   │   │   ├── calendar/
│   │   │   │   │   └── Calendar.tsx          # 日历
│   │   │   │   │
│   │   │   │   ├── email/
│   │   │   │   │   └── EmailClient.tsx       # 邮件客户端
│   │   │   │   │
│   │   │   │   ├── notes/
│   │   │   │   │   └── Notes.tsx             # 笔记（Markdown）
│   │   │   │   │
│   │   │   │   └── whiteboard/
│   │   │   │       └── Whiteboard.tsx        # 画板（tldraw/excalidraw）
│   │   │   │
│   │   │   ├── stores/                       # Zustand Stores
│   │   │   │   ├── windowStore.ts            # 窗口状态（打开的窗口、焦点、z-index）
│   │   │   │   ├── desktopStore.ts           # 桌面状态（图标、壁纸、主题）
│   │   │   │   ├── memoryStore.ts            # 前端记忆缓存
│   │   │   │   └── settingsStore.ts          # 用户设置（API Keys、偏好）
│   │   │   │
│   │   │   ├── hooks/
│   │   │   │   ├── useWindow.ts              # 窗口操作 hook
│   │   │   │   ├── useAgent.ts               # Agent 交互 hook
│   │   │   │   ├── useStream.ts              # LLM 流式响应 hook
│   │   │   │   ├── useMemory.ts              # 记忆读写 hook
│   │   │   │   ├── useFileSystem.ts          # 文件操作 hook
│   │   │   │
│   │   │   ├── lib/
│   │   │   │   ├── api-client.ts             # HTTP 客户端
│   │   │   │   ├── ws-client.ts              # WebSocket 客户端
│   │   │   │   ├── app-registry.ts           # 前端 App 注册
│   │   │   │   └── utils.ts                  # 工具函数
│   │   │   │
│   │   │   └── types/
│   │   │       ├── window.ts                 # 窗口类型定义
│   │   │       ├── app.ts                    # App 类型定义
│   │   │       ├── agent.ts                  # Agent 类型定义
│   │   │       └── memory.ts                 # Memory 类型定义
│   │   │
│   │   ├── public/
│   │   │   ├── wallpapers/                   # 壁纸
│   │   │   ├── icons/                        # App 图标
│   │   │   └── sounds/                       # 系统音效
│   │   │
│   │   ├── next.config.ts
│   │   ├── tailwind.config.ts
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   └── api/                                  # Python FastAPI 后端
│       ├── app/
│       │   ├── main.py                       # FastAPI 入口
│       │   ├── config.py                     # 配置管理
│       │   │
│       │   ├── api/                          # API Routes
│       │   │   ├── v1/
│       │   │   │   ├── agents.py             # Agent 交互端点
│       │   │   │   ├── apps.py               # App 管理端点
│       │   │   │   ├── memory.py             # Memory 端点
│       │   │   │   ├── files.py              # 文件管理端点
│       │   │   │   ├── rag.py                # RAG 检索端点
│       │   │   │   └── settings.py           # 设置端点
│       │   │   └── websocket.py              # WebSocket 端点
│       │   │
│       │   ├── core/                         # 核心服务
│       │   │   ├── orchestrator.py           # LangGraph Meta-Agent
│       │   │   ├── app_registry.py           # App 注册与生命周期管理
│       │   │   ├── memory_manager.py         # 记忆管理（Mem0 + Redis）
│       │   │   ├── rag_engine.py             # RAG 引擎（pgvector）
│       │   │   ├── mcp_manager.py            # MCP Server 管理
│       │   │   ├── llm_provider.py           # LiteLLM 多模型统一接口
│       │   │   └── file_manager.py           # 宿主文件映射与虚拟文件系统管理
│       │   │
│       │   ├── models/                       # SQLAlchemy Models
│       │   │   ├── user.py
│       │   │   ├── app.py
│       │   │   ├── memory.py
│       │   │   ├── document.py
│       │   │   └── conversation.py
│       │   │
│       │   ├── schemas/                      # Pydantic Schemas
│       │   │   ├── agent.py
│       │   │   ├── app.py
│       │   │   ├── memory.py
│       │   │   └── file.py
│       │   │
│       │   └── websocket/
│       │       ├── agent_stream.py           # LLM 流式响应
│       │       └── agent_bus.py              # Agent 间通信总线
│       │
│       ├── apps_registry/                    # 内置 App Manifest 与运行时配置
│       │   ├── web_search/
│       │   │   ├── server.py                 # MCP server
│       │   │   └── manifest.json             # App 清单
│       │   ├── code_executor/
│       │   │   ├── server.py
│       │   │   └── manifest.json
│       │   ├── file_ops/
│       │   │   ├── server.py
│       │   │   └── manifest.json
│       │   └── email_client/
│       │       ├── server.py
│       │       └── manifest.json
│       │
│       ├── alembic/                          # 数据库迁移
│       │   ├── versions/
│       │   └── env.py
│       │
│       ├── pyproject.toml
│       └── alembic.ini
│
├── packages/
│   └── shared/                               # 共享类型（前后端同步）
│       ├── src/
│       │   ├── types.ts                      # 共享 TypeScript 类型
│       │   └── constants.ts                  # 共享常量
│       ├── tsconfig.json
│       └── package.json
│
├── docker/
│   ├── docker-compose.yml                    # PostgreSQL, Redis, MinIO
│   ├── docker-compose.prod.yml               # 生产环境
│   └── nginx.conf                            # 反向代理
│
├── turbo.json                                # Turborepo 配置
├── package.json                              # Root package.json (pnpm workspace)
├── pnpm-workspace.yaml                       # pnpm workspace 配置
├── .env.example                              # 环境变量模板
├── ARCHITECTURE.md                           # 本文件
└── README.md
```

---

## 4. 核心系统设计

### 4.1 窗口管理器

窗口管理是 OS 体验的核心。参考 daedalOS 的经过生产验证的方案：

#### 窗口状态模型

```typescript
// types/window.ts

interface WindowState {
  id: string; // 唯一窗口 ID
  appId: string; // 对应的 App ID
  title: string; // 窗口标题
  icon: string; // 图标
  position: { x: number; y: number };
  size: { width: number; height: number };
  minSize: { width: number; height: number };
  state: "normal" | "minimized" | "maximized";
  zIndex: number;
  isFocused: boolean;
  isAnimating: boolean;
  // 每个窗口可以持有该 App 实例的局部状态
  appState?: Record<string, unknown>;
}

interface WindowManagerState {
  windows: Map<string, WindowState>;
  focusOrder: string[]; // z-index 栈
  nextZIndex: number;

  // 操作方法
  openWindow: (appId: string, props?: Record<string, unknown>) => string;
  closeWindow: (windowId: string) => void;
  focusWindow: (windowId: string) => void;
  minimizeWindow: (windowId: string) => void;
  maximizeWindow: (windowId: string) => void;
  restoreWindow: (windowId: string) => void;
  updatePosition: (
    windowId: string,
    position: { x: number; y: number },
  ) => void;
  updateSize: (
    windowId: string,
    size: { width: number; height: number },
  ) => void;
  snapWindow: (
    windowId: string,
    zone: "left" | "right" | "top" | "maximize",
  ) => void;
}
```

#### 窗口组件架构

```
Desktop (full viewport)
├── WallpaperLayer (background image/gradient)
├── IconGrid (desktop icons, drag-to-arrange)
├── WindowManager
│   ├── Window[0] (react-rnd)
│   │   ├── TitleBar (drag handle)
│   │   │   ├── Icon + Title
│   │   │   └── MinimizeBtn | MaximizeBtn | CloseBtn
│   │   └── Content (Skill UI component)
│   ├── Window[1] ...
│   └── Window[n] ...
├── ContextMenu (right-click overlay)
├── Taskbar (fixed bottom)
│   ├── StartButton → StartMenu (App launcher)
│   ├── WindowTabs (每个打开的窗口一个 tab)
│   └── SystemTray (clock, notifications, quick settings)
└── SnapZones (窗口拖到边缘时的吸附提示)
```

#### 核心实现细节

```typescript
// Window.tsx — core pattern
import { Rnd } from 'react-rnd';

function Window({ windowId }: { windowId: string }) {
  const window = useWindowStore(s => s.windows.get(windowId));
  const { focusWindow, updatePosition, updateSize } = useWindowStore();
  const AppComponent = useAppComponent(window.appId);

  if (window.state === 'minimized') return null;

  return (
    <Rnd
      position={window.state === 'maximized' ? { x: 0, y: 0 } : window.position}
      size={window.state === 'maximized'
        ? { width: '100vw', height: 'calc(100vh - 48px)' }
        : window.size}
      minWidth={window.minSize.width}
      minHeight={window.minSize.height}
      dragHandleClassName="window-titlebar"
      style={{ zIndex: window.zIndex, contain: 'strict' }}
      enableResizing={window.state !== 'maximized'}
      disableDragging={window.state === 'maximized'}
      onDragStart={() => focusWindow(windowId)}
      onDragStop={(_, d) => updatePosition(windowId, { x: d.x, y: d.y })}
      onResizeStop={(_, __, ref, ___, pos) => {
        updateSize(windowId, {
          width: parseInt(ref.style.width),
          height: parseInt(ref.style.height),
        });
        updatePosition(windowId, pos);
      }}
      bounds="parent"
    >
      <div className="window-frame" onMouseDown={() => focusWindow(windowId)}>
        <TitleBar
          className="window-titlebar"
          title={window.title}
          icon={window.icon}
          windowId={windowId}
        />
        <div className="window-content">
          <AppComponent
            windowId={windowId}
            appState={window.appState}
          />
        </div>
      </div>
    </Rnd>
  );
}
```

### 4.2 App 注册与 Agent Skills 架构

#### App 与 Skill 的职责边界

产品层统一使用 App：文件管理器、笔记、终端、浏览器都是 App。

Agent 层仍然保留 Skill 概念，但它只表示某个 Agent 可调用的能力单元或工作流，不再等同于桌面上的应用。

Skill 的工作流定义采用 **`SKILL.md` Markdown 文件**，而非硬编码逻辑。这解决了两个问题：

1. **上下文控制**：不全量注入所有 Agent Skills 描述，Lead Agent 按任务动态加载相关 Skill，节省 token
2. **可扩展性**：任何人都可以用写文档的方式创建新 Agent Skill，无需修改 App 代码

这里推荐对齐 `skills.sh` / `SKILL.md` 生态：`manifest.json` 负责声明能力边界，`SKILL.md` 负责描述 Agent 如何使用该 App。

```
apps_registry/
  web-search/
    manifest.json       ← App / Agent 清单元数据
    SKILL.md            ← Agent Skill 工作流指令（Lead Agent 按需加载）
    server.py           ← MCP server 实现
  code-executor/
    manifest.json
    SKILL.md            ← "如何执行代码、处理错误、返回结果"
    server.py
  deep-research/
    manifest.json
    SKILL.md            ← "搜索→抓取→分析→报告 完整步骤"
    server.py
```

`SKILL.md` 示例：

```markdown
---
name: deep-research
description: Conduct a multi-source research workflow and return a structured report with citations.
---

# Deep Research

## 目标

对给定主题进行深度研究，生成结构化报告。

## 步骤

1. 使用 web_search 搜索主题相关的最新资料（至少 5 个来源）
2. 使用 fetch_url 抓取最相关的 3 个页面全文
3. 提取关键信息，按"背景/现状/趋势/结论"结构组织
4. 为每个观点标注来源 URL

## 输出格式

Markdown 报告，包含摘要、正文（带引用）、参考链接列表。
```

#### App 清单格式

```jsonc
// apps_registry/web_search/manifest.json
{
  "id": "web-search",
  "name": "Web Search",
  "version": "1.0.0",
  "description": "具备摘要能力的 AI 网页搜索",
  "author": "AI-Native-OS",
  "category": "productivity",

  // Agent 定义
  "agent": {
    "systemPrompt": "你是一个网页搜索助手。使用搜索工具查找信息，并提供简洁准确的答案和信息来源。",
    "defaultModel": "claude-sonnet-4-6",
    "temperature": 0.3,
    "maxTokens": 4096,
    "tools": ["web_search", "web_fetch", "summarize"],
    "permissions": ["network"],
  },

  // UI 组件（前端）
  "ui": {
    "component": "WebSearchSkill", // React 组件名
    "icon": "search", // Lucide 图标名
    "defaultSize": { "width": 700, "height": 500 },
    "minSize": { "width": 400, "height": 300 },
    "supportedActions": ["search", "summarize"],
  },

  // MCP 服务（后端）
  "mcp": {
    "transport": "stdio",
    "command": "python",
    "args": ["-m", "skills.web_search.server"],
    "env": {},
  },

  // 依赖项
  "requires": {
    "skills": [], // 依赖的其他 skills
    "permissions": ["network"], // 系统权限
    "apiKeys": ["tavily"], // 需要的 API Keys（可选）
  },

  // 设置模式（用户可配置项）
  "settings": {
    "type": "object",
    "properties": {
      "maxResults": {
        "type": "number",
        "default": 10,
        "title": "最大搜索结果数",
      },
      "preferredSources": {
        "type": "array",
        "items": { "type": "string" },
        "default": [],
        "title": "偏好来源",
      },
    },
  },
}
```

#### Skill 注册流程

```
1. Install: 用户从 Marketplace 安装 Skill
   → 下载 manifest.json + MCP server code + UI component
   → 验证依赖（API Keys, permissions）
   → 存入 PostgreSQL skill 表

2. Activate: 用户首次打开 Skill
   → SkillRegistry 加载 manifest
   → 启动 MCP server 进程
   → 注册 tools 到全局 tool registry
   → 前端动态加载 UI component

3. Invoke: 用户与 Skill 交互
   → 前端 UI → WebSocket → Backend Agent
   → Agent 通过 MCP client 调用 Skill tools
   → 流式返回结果 → 前端渲染

4. Deactivate: 用户关闭最后一个该 Skill 窗口
   → 优雅关闭 MCP server 进程
   → 释放资源（保留注册信息）

5. Uninstall: 用户卸载 Skill
   → 关闭所有窗口和进程
   → 从 registry 移除
   → 清理文件和数据
```

#### Skill 注册表（后端）

```python
# core/skill_registry.py

class SkillRegistry:
    """管理所有 Skill 的注册、生命周期和工具发现"""

    def __init__(self, db: AsyncSession, mcp_manager: MCPManager):
        self.db = db
        self.mcp_manager = mcp_manager
        self._active_skills: dict[str, ActiveSkill] = {}

    async def install_skill(self, manifest: SkillManifest) -> Skill:
        """安装 Skill：验证、存储、注册"""
        # 1. 验证 manifest 合法性
        self._validate_manifest(manifest)

        # 2. 检查依赖
        await self._check_dependencies(manifest)

        # 3. 存入数据库
        skill = Skill(
            id=manifest.id,
            name=manifest.name,
            version=manifest.version,
            manifest=manifest.model_dump(),
            status="installed",
        )
        self.db.add(skill)
        await self.db.commit()

        return skill

    async def activate_skill(self, skill_id: str) -> ActiveSkill:
        """激活 Skill：启动 MCP server，注册 tools"""
        if skill_id in self._active_skills:
            return self._active_skills[skill_id]

        skill = await self.db.get(Skill, skill_id)
        manifest = SkillManifest(**skill.manifest)

        # 启动 MCP server
        mcp_session = await self.mcp_manager.start_server(
            skill_id=skill_id,
            transport=manifest.mcp.transport,
            command=manifest.mcp.command,
            args=manifest.mcp.args,
        )

        # 发现 tools
        tools = await mcp_session.list_tools()

        active = ActiveSkill(
            skill_id=skill_id,
            manifest=manifest,
            mcp_session=mcp_session,
            tools=tools,
        )
        self._active_skills[skill_id] = active

        return active

    async def get_tools_for_agent(
        self, agent_id: str, skill_ids: list[str] | None = None
    ) -> list[Tool]:
        """获取指定 Agent 可用的所有 tools"""
        tools = []
        target_skills = skill_ids or list(self._active_skills.keys())

        for sid in target_skills:
            if sid in self._active_skills:
                tools.extend(self._active_skills[sid].tools)

        return tools

    async def call_tool(
        self, skill_id: str, tool_name: str, arguments: dict
    ) -> ToolResult:
        """调用指定 Skill 的 tool"""
        active = self._active_skills.get(skill_id)
        if not active:
            active = await self.activate_skill(skill_id)

        result = await active.mcp_session.call_tool(tool_name, arguments)
        return result
```

### 4.3 Agent 编排（LangGraph + Manager Subagents）

当前实现采用 **单 Agent 优先、必要时升级为 Manager Subagents** 的模式：

- 默认路径是一个增强型 ReAct Agent：模型直接使用工具、Harness 负责策略守卫、结果校验、checkpoint 与 human-in-the-loop。
- 多 Agent 路径是 OpenAI Agents SDK 所说的 **agents as tools / manager pattern**：Lead Agent 仍拥有用户对话和最终回答，只把边界清晰的子任务委派给专业 Agent。
- 暂不启用真正的 conversation handoff：当前产品只有一个 AI 助手流，若让 specialist 接管用户对话，会让前端状态、记忆写入和确认节点变复杂。handoff 保留为后续“多阶段对话 / App 专属助手”模式。
- LangGraph 当前承担 checkpoint facade 与节点状态记录；完整 StateGraph 编排会在多 Agent 评测稳定后逐步迁移。

参考来源：

- [OpenAI Agents SDK：agents as tools 与 handoffs 的取舍](https://openai.github.io/openai-agents-python/multi_agent/)
- [Anthropic：先保持简单，只在复杂任务中使用 orchestrator-workers](https://www.anthropic.com/engineering/building-effective-agents)
- [Anthropic Research：lead agent 并行创建 specialized subagents](https://www.anthropic.com/engineering/multi-agent-research-system)
- [LangChain multi-agent：subagents、handoffs、skills、router 的模式边界](https://docs.langchain.com/oss/python/langchain/multi-agent/index)
- [LangGraph/LangChain handoffs：跨 agent 传递消息必须控制上下文](https://docs.langchain.com/oss/python/langchain/multi-agent/handoffs)

#### 当前运行拓扑

```
用户请求
  │
  ▼
Lead Agent（用户对话所有者 + 工具选择 + 结果综合）
  │
  ├── 简单任务 / 一次工具可完成
  │      └── 直接走单 Agent ReAct
  │
  └── 复杂且可隔离的子任务
         └── delegate_task（specialists as tools）
                │
                ├── Research Agent ──► fetch_url / retrieve_knowledge / browser / search MCP
                ├── Coder Agent    ──► calculator / python_exec / virtual files
                ├── System Agent   ──► virtual files / calendar / mail / notes MCP
                └── Writer Agent   ──► retrieve_knowledge / read_file / write_file
                       │
                       ▼
                Lead Agent 综合结果、补充上下文、向用户流式回答
```

#### Agent 模式选择

| 模式 | 当前状态 | 使用条件 | 所有权 |
| --- | --- | --- | --- |
| Single Agent | 已实现，默认路径 | 简单问答、一次工具调用、需要连续澄清、子任务强依赖 | 主 Agent |
| Manager Subagents | 已实现，auto 启用 | 并行搜索/分析、跨领域任务、长上下文隔离、工具面过大 | Lead Agent |
| Router Workflow | 设计保留 | 分类稳定且下游路径固定，如 App 启动、固定业务流程 | 代码 / Lead Agent |
| Conversation Handoff | 暂缓 | specialist 需要连续和用户对话，如客服式多阶段流程 | 被 handoff 的 Agent |
| Evaluator Optimizer | 暂缓 | 有明确质量门槛，如高风险写作、代码审查、安全检查 | 代码工作流 |

#### 角色注册表

`apps/api/app/core/agent_types.py` 是当前多 Agent 控制面来源：

| Role | 责任边界 | 工具边界 |
| --- | --- | --- |
| `research` | 实时信息、网页/知识库检索、事实核查、资料归纳 | `fetch_url`、`retrieve_knowledge`、`load_skill_context`、浏览器工具、搜索类 MCP、`skill_` 数据工具 |
| `coder` | Python、数学、数据处理、可验证计算 | `python_exec`、`calculator`、虚拟文件读写 |
| `system` | 文件、日历、邮件、笔记、文档类系统动作 | 虚拟文件工具、系统类 MCP |
| `writer` | 写作、翻译、改写、Markdown/文档排版 | 知识检索、虚拟文件读写 |

每个 Sub-Agent 拥有：

- 独立的上下文（不污染其他 Agent）
- 独立的系统提示词与输出契约
- 由 Harness 强制裁剪的工具集，而不是只靠提示词自觉
- 独立的终止条件与 `max_iterations`
- 并行执行上限（当前最多 4 个，禁止递归委派）
- 只向 Lead Agent 返回最终摘要、来源、失败原因和少量元信息

#### ThreadState：带 Reducer 的显式状态管理（目标形态）

不再用简单的 `messages list`，而是用带 **Reducer 函数**的显式状态字段，防止长任务状态膨胀或错乱：

```python
# core/orchestrator.py

from typing import Annotated
from langgraph.graph import add_messages

def _deduplicate(existing: list, new: list) -> list:
    """Reducer: 自动去重"""
    seen = set(existing)
    return existing + [x for x in new if x not in seen]

def _merge_dict(existing: dict, new: dict) -> dict:
    """Reducer: 字典合并，空字典表示清空"""
    if new == {}:
        return {}
    return {**existing, **new}

class AgentState(TypedDict):
    # 消息历史（LangGraph 内置 Reducer：追加）
    messages: Annotated[list, add_messages]

    # 任务产出物路径（Reducer: 自动去重，防止重复）
    artifacts: Annotated[list[str], _deduplicate]

    # 已查看的图像 base64（Reducer: 空字典=清空，防止无限膨胀）
    viewed_images: Annotated[dict[str, str], _merge_dict]

    # 当前执行计划
    todos: list[dict]

    # 沙箱状态
    sandbox_id: str | None

    # 工作目录（虚拟文件系统路径）
    workspace_path: str

    # 记忆上下文（检索结果，每轮刷新）
    memory_context: list[str]

    # 意图解析结果
    intent: dict | None

    # 用户 ID
    user_id: str
```

#### 长期目标：完整 LangGraph Meta-Agent

当前实现不是一次性切到完整图编排，而是保留 `llm_provider.agent_loop` 作为稳定执行环，在 `AgentGraphRuntime` 中记录 LangGraph checkpoint。下面的 Meta-Agent 图是迁移目标：当 Manager Subagents 的评测、状态可视化和失败恢复稳定后，再把节点体逐步从 ReAct loop 迁移到显式 StateGraph。

```python
# core/orchestrator.py

from langgraph.graph import StateGraph, MessagesState
from langgraph.checkpoint.postgres import PostgresSaver

class AIKernel:
    """AI OS 的核心 — Meta-Agent 编排器"""

    def __init__(
        self,
        skill_registry: SkillRegistry,
        memory_manager: MemoryManager,
        llm_provider: LLMProvider,
    ):
        self.skill_registry = skill_registry
        self.memory_manager = memory_manager
        self.llm_provider = llm_provider
        self.graph = self._build_graph()

    def _build_graph(self) -> StateGraph:
        """构建 Meta-Agent 状态图"""

        graph = StateGraph(AgentState)

        # 节点
        graph.add_node("understand", self._understand_intent)
        graph.add_node("retrieve_memory", self._retrieve_memory)
        graph.add_node("route", self._route_to_skill)
        graph.add_node("execute_skill", self._execute_skill)
        graph.add_node("synthesize", self._synthesize_response)
        graph.add_node("update_memory", self._update_memory)

        # 边
        graph.set_entry_point("understand")
        graph.add_edge("understand", "retrieve_memory")
        graph.add_edge("retrieve_memory", "route")
        graph.add_conditional_edges(
            "route",
            self._should_execute_skill,
            {
                "execute": "execute_skill",
                "direct_answer": "synthesize",
            },
        )
        graph.add_edge("execute_skill", "synthesize")
        graph.add_edge("synthesize", "update_memory")
        graph.add_edge("update_memory", END)

        return graph.compile(
            checkpointer=PostgresSaver(connection_string=DATABASE_URL)
        )

    async def _understand_intent(self, state: AgentState) -> AgentState:
        """理解用户意图，提取所需 Skills 和 tools"""
        available_skills = await self.skill_registry.list_active_skills()

        response = await self.llm_provider.complete(
            system=INTENT_UNDERSTANDING_PROMPT,
            messages=state["messages"],
            tools=[{
                "name": "route_intent",
                "description": "Route user intent to appropriate skills",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "intent": {"type": "string"},
                        "skills_needed": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": f"Available: {[s.id for s in available_skills]}"
                        },
                        "is_multi_step": {"type": "boolean"},
                        "plan": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "Execution plan steps if multi-step"
                        }
                    }
                }
            }]
        )

        state["intent"] = response.tool_calls[0].arguments
        return state

    async def _retrieve_memory(self, state: AgentState) -> AgentState:
        """从长期记忆检索相关上下文"""
        query = state["messages"][-1].content
        memories = await self.memory_manager.search(
            user_id=state["user_id"],
            query=query,
            limit=10,
        )
        state["memory_context"] = memories
        return state

    async def _execute_skill(self, state: AgentState) -> AgentState:
        """执行具体 Skill 的 Agent"""
        skill_id = state["intent"]["skills_needed"][0]
        active_skill = await self.skill_registry.activate_skill(skill_id)

        # 构建专属 Skill 的 Agent
        tools = await self.skill_registry.get_tools_for_agent(
            agent_id=skill_id,
            skill_ids=[skill_id],
        )

        # Agent 循环：LLM → 工具调用 → 结果 → LLM → ...
        messages = state["messages"].copy()
        if state.get("memory_context"):
            messages.insert(0, SystemMessage(
                content=f"Relevant memory:\n{state['memory_context']}"
            ))

        while True:
            response = await self.llm_provider.complete(
                system=active_skill.manifest.agent.system_prompt,
                messages=messages,
                tools=self._convert_mcp_tools(tools),
                model=active_skill.manifest.agent.default_model,
                stream=True,
            )

            if not response.tool_calls:
                break

            # 执行工具调用
            for tool_call in response.tool_calls:
                result = await self.skill_registry.call_tool(
                    skill_id=skill_id,
                    tool_name=tool_call.name,
                    arguments=tool_call.arguments,
                )
                messages.append(ToolResultMessage(
                    tool_call_id=tool_call.id,
                    content=str(result),
                ))

        state["skill_response"] = response
        return state

    async def _update_memory(self, state: AgentState) -> AgentState:
        """将重要信息存入长期记忆"""
        await self.memory_manager.add(
            user_id=state["user_id"],
            messages=[
                {"role": "user", "content": state["messages"][-1].content},
                {"role": "assistant", "content": state["skill_response"].content},
            ],
        )
        return state
```

#### Manager Subagents 工作流示例

```
用户: "帮我搜索最新的 AI Agent 框架对比，整理成一份文档保存到桌面"

Lead Agent 决策:
  - research 子任务：搜索/抓取最新 AI Agent 框架信息，输出带来源摘要
  - writer 子任务：根据 research 结果整理文档结构和正文
  - system 子任务：在虚拟文件系统保存最终文档

执行流:
  Research Agent → [search_tool, fetch_tool] → 搜索结果
       ↓
  Writer Agent → [retrieve_knowledge/read_file/write_file] → 文档内容
       ↓
  System Agent → [write_file] → 保存完成
       ↓
  Lead Agent → 综合结果 → 返回用户
```

### 4.4 SOUL.md 人格系统

参考 [openclaw/soul.md](https://github.com/aaronjmars/soul.md) 设计，为 AI 提供持久化人格。

#### 设计理念

> "每次对话时，AI 先读自己的 SOUL.md，再开始交谈。编辑文件，即改变人格。"

SOUL.md 是一个普通 Markdown 文件（`apps/api/soul.md`），定义 AI 的身份、称谓、工作方向和沟通风格。用户可以通过对话更新，也可以在文件管理器中直接手动编辑。

#### 文件格式

```markdown
# AI Soul

## 基本信息

- **AI 名字**：小助
- **用户称谓**：云飞
- **用户时区**：Asia/Shanghai

## 工作方向

主要协助前端开发、AI 工程相关问题，兼顾日常效率工具使用。

## 沟通风格

简洁直接，技术问题给出可运行的代码，避免过度解释。
```

#### 工作机制

```
首次对话（soul.md 为空）
  │
  ▼
AI 发起 onboarding 问答：
  1. "你好！我还没有名字，你想叫我什么？"
  2. "我该怎么称呼你？"
  3. "你在哪个时区？"
  4. "你希望我主要帮你做什么？"
  5. "你偏好什么沟通风格？"
  │
  ▼
收集完成 → 调用 update_soul 工具生成并写入 soul.md

后续对话
  │
  ▼
每次对话：读取 soul.md → 前置到 system prompt
用户说"把你的名字改成xxx" → AI 识别意图 → 调用 update_soul 更新

文件管理器（阶段四实现后）
  │
  ▼
soul.md 在虚拟文件系统中直接可见，用户可手动编辑，下次对话自动生效
```

#### 后端实现

```python
# api/v1/soul.py
GET  /api/v1/soul        # 读取 soul.md 内容
PUT  /api/v1/soul        # 写入 soul.md 内容
GET  /api/v1/soul/exists # 检查 soul.md 是否存在且非空

# core/tools.py 中注册 update_soul 工具
{
  "name": "update_soul",
  "description": "更新 AI 人格文件（soul.md），当用户要求修改 AI 名字、称谓或行为时调用",
  "parameters": {
    "content": "新的 soul.md 完整内容（Markdown 格式）"
  }
}
```

#### 注入方式

```python
# agents.py generate() 中
soul_content = read_soul_file()  # 读 soul.md
if soul_content:
    effective_system = f"{soul_content}\n\n---\n\n{base_system_prompt}"
else:
    effective_system = ONBOARDING_PROMPT  # 触发首次引导
```

### 4.5 记忆系统

#### 记忆写入：异步队列 + 去重 + 防抖（借鉴 DeerFlow Memory 系统）

记忆更新**不阻塞主对话流**，走异步队列处理：

```python
# core/memory_manager.py（异步写入设计）

import asyncio
from collections import deque

class MemoryManager:
    def __init__(self, ...):
        self._write_queue: asyncio.Queue = asyncio.Queue()
        self._debounce_tasks: dict[str, asyncio.Task] = {}
        # 启动后台写入 worker
        asyncio.create_task(self._write_worker())

    async def add_async(self, user_id: str, messages: list[dict]):
        """非阻塞：将记忆写入请求放入队列，不卡 SSE 流"""
        await self._write_queue.put({"user_id": user_id, "messages": messages})

    async def _write_worker(self):
        """后台 worker：去重 + 防抖后批量写入"""
        while True:
            item = await self._write_queue.get()
            user_id = item["user_id"]

            # 防抖：500ms 内的同一用户写入合并为一次
            if user_id in self._debounce_tasks:
                self._debounce_tasks[user_id].cancel()

            async def _flush(uid, msg):
                await asyncio.sleep(0.5)
                await self._write_with_dedup(uid, msg)

            self._debounce_tasks[user_id] = asyncio.create_task(
                _flush(user_id, item["messages"])
            )

    async def _write_with_dedup(self, user_id: str, messages: list[dict]):
        """去重写入：相同语义内容不重复存储"""
        existing = await self.mem0.search(
            query=messages[-1]["content"], user_id=user_id, limit=3
        )
        # 相似度 > 0.95 则跳过（已有相同记忆）
        if existing and existing[0].get("score", 0) > 0.95:
            return
        await self.mem0.add(messages=messages, user_id=user_id)
```

**三层记忆架构：**

```
┌─────────────────────────────────────────────────────────┐
│                    Memory System                        │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │  Layer 1: Working Memory (Redis)                │   │
│  │  - 当前会话上下文                                │   │
│  │  - Agent 执行状态                                │   │
│  │  - 临时计算结果                                  │   │
│  │  - TTL: 会话结束后 24h 过期                      │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │  Layer 2: Long-term Memory (Mem0)               │   │
│  │  - 用户偏好和习惯                                │   │
│  │  - Agent 学习到的模式                            │   │
│  │  - 重要事实和决策                                │   │
│  │  - 跨会话持久化                                  │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │  Layer 3: Knowledge Base (Qdrant RAG)            │   │
│  │  - 用户知识文档与外部资料（原始文件可存于 MinIO） │   │
│  │  - 外部知识库                                    │   │
│  │  - Chunk → Embed → Qdrant → Retrieve            │   │
│  │  - 支持语义搜索（score_threshold 过滤）           │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

```python
# core/memory_manager.py

class MemoryManager:
    """统一记忆管理接口"""

    def __init__(self, redis: Redis, mem0: MemoryClient, db: AsyncSession):
        self.redis = redis
        self.mem0 = mem0
        self.db = db

    # --- 第一层：工作记忆 ---

    async def set_working_memory(
        self, session_id: str, key: str, value: Any, ttl: int = 86400
    ):
        await self.redis.setex(
            f"wm:{session_id}:{key}", ttl, json.dumps(value)
        )

    async def get_working_memory(self, session_id: str, key: str) -> Any:
        raw = await self.redis.get(f"wm:{session_id}:{key}")
        return json.loads(raw) if raw else None

    # --- 第二层：长期记忆 ---

    async def add(self, user_id: str, messages: list[dict], metadata: dict = None):
        """添加长期记忆（Mem0 自动提取关键信息）"""
        await self.mem0.add(
            messages=messages,
            user_id=user_id,
            metadata=metadata or {},
        )

    async def search(self, user_id: str, query: str, limit: int = 10) -> list[Memory]:
        """语义搜索长期记忆"""
        results = await self.mem0.search(
            query=query,
            user_id=user_id,
            limit=limit,
        )
        return [Memory(**r) for r in results]

    # --- 第三层：知识库（RAG）---

    async def ingest_document(self, user_id: str, file_path: str, metadata: dict):
        """文档摄入：分块 → 嵌入 → 存储"""
        # 1. 读取文件
        content = await self._read_file(file_path)

        # 2. 分块
        chunks = self._chunk_document(content, chunk_size=512, overlap=50)

        # 3. 嵌入 + 存储到 pgvector
        for i, chunk in enumerate(chunks):
            embedding = await self._embed(chunk)
            doc = DocumentChunk(
                user_id=user_id,
                content=chunk,
                embedding=embedding,
                metadata={**metadata, "chunk_index": i},
            )
            self.db.add(doc)

        await self.db.commit()

    async def rag_search(
        self, user_id: str, query: str, limit: int = 5
    ) -> list[DocumentChunk]:
        """RAG 语义检索"""
        query_embedding = await self._embed(query)

        results = await self.db.execute(
            select(DocumentChunk)
            .where(DocumentChunk.user_id == user_id)
            .order_by(DocumentChunk.embedding.cosine_distance(query_embedding))
            .limit(limit)
        )
        return results.scalars().all()
```

### 4.6 实时通信

#### WebSocket 协议

```typescript
// 前后端 WebSocket 消息协议

// --- 客户端 → 服务端 ---

interface WSClientMessage {
  type: "agent_invoke" | "agent_cancel" | "skill_action" | "ping";
  requestId: string; // 请求唯一 ID
  payload: AgentInvokePayload | SkillActionPayload;
}

interface AgentInvokePayload {
  appId: string; // 目标 App
  sessionId: string; // 会话 ID
  message: string; // 用户消息
  attachments?: Attachment[]; // 附件（文件、图片）
  model?: string; // 模型覆盖
}

// --- 服务端 → 客户端 ---

interface WSServerMessage {
  type:
    | "token" // LLM 流式 token
    | "tool_call" // 工具调用（含 id/name/args）
    | "tool_result" // 工具执行结果（含 id/name/result/error）
    | "status" // 状态通知（如记忆召回）
    | "agent_done" // Agent 完成，附带完整 content + title
    | "agent_error" // Agent 错误
    | "pong";
  requestId: string;
  payload: unknown;
}

// Token 流式传输载体
interface TokenPayload {
  token: string;
}

// 工具调用载体
interface ToolCallPayload {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

// 工具结果载体
interface ToolResultPayload {
  id: string;
  name: string;
  result: string;
  error: boolean;
}

// 状态通知载体（如记忆召回）
interface StatusPayload {
  status: "recalled";
  count: number;
}

// Agent 完成载体
interface AgentDonePayload {
  content: string;
  title: string;
}
```

#### 前端流式 Hook

```typescript
// hooks/useStream.ts

function useAgentStream() {
  const ws = useWebSocket();

  const invoke = useCallback(
    async (
      appId: string,
      message: string,
      onToken: (token: string) => void,
      onToolCall?: (tool: ToolCallEvent) => void,
    ) => {
      const requestId = crypto.randomUUID();

      return new Promise<string>((resolve, reject) => {
        let fullText = "";

        const handler = (msg: WSServerMessage) => {
          if (msg.requestId !== requestId) return;

          switch (msg.type) {
            case "token":
              fullText += msg.payload.token;
              onToken(msg.payload.token);
              break;
            case "tool_call":
              onToolCall?.({ type: "call", ...msg.payload });
              break;
            case "tool_result":
              onToolCall?.({ type: "result", ...msg.payload });
              break;
            case "agent_done":
              ws.off("message", handler);
              resolve(fullText);
              break;
            case "agent_error":
              ws.off("message", handler);
              reject(new Error(msg.payload.error));
              break;
          }
        };

        ws.on("message", handler);
        ws.send({
          type: "agent_invoke",
          requestId,
          payload: { appId, message, sessionId: currentSessionId },
        });
      });
    },
    [ws],
  );

  return { invoke };
}
```

---

## 5. 数据库结构

```sql
-- 用户表
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255),
    settings JSONB DEFAULT '{}',           -- 主题、壁纸等偏好
    api_keys JSONB DEFAULT '{}',           -- 加密存储的 API Keys
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Skill 注册表
CREATE TABLE skills (
    id VARCHAR(128) PRIMARY KEY,           -- e.g., "web-search"
    name VARCHAR(255) NOT NULL,
    version VARCHAR(32) NOT NULL,
    manifest JSONB NOT NULL,               -- 完整 Skill Manifest
    status VARCHAR(32) DEFAULT 'installed', -- installed | active | disabled
    category VARCHAR(64),
    is_builtin BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 用户已安装的 Skills
CREATE TABLE user_skills (
    user_id UUID REFERENCES users(id),
    skill_id VARCHAR(128) REFERENCES skills(id),
    settings JSONB DEFAULT '{}',           -- 用户对该 Skill 的配置
    is_pinned BOOLEAN DEFAULT FALSE,       -- 是否固定到桌面/任务栏
    installed_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, skill_id)
);

-- 对话 / 会话
CREATE TABLE conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    skill_id VARCHAR(128) REFERENCES skills(id),
    title VARCHAR(255),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 消息
CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID REFERENCES conversations(id),
    role VARCHAR(32) NOT NULL,             -- user | assistant | tool | system
    content TEXT,
    tool_calls JSONB,                      -- 工具调用信息
    tool_call_id VARCHAR(128),             -- 对应的 tool_call ID
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 文件系统（虚拟文件）
CREATE TABLE files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    name VARCHAR(255) NOT NULL,
    path VARCHAR(1024) NOT NULL,           -- 虚拟路径 e.g., "/Desktop/report.md"
    mime_type VARCHAR(128),
    size BIGINT DEFAULT 0,
    storage_key VARCHAR(512),              -- 可选对象存储 key（知识文档/二进制对象）
    parent_id UUID REFERENCES files(id),   -- 目录结构
    is_directory BOOLEAN DEFAULT FALSE,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, path)
);

-- 文档向量存储（RAG）
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE document_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    file_id UUID REFERENCES files(id),
    content TEXT NOT NULL,
    embedding vector(1536),                -- OpenAI text-embedding-3-small
    chunk_index INT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 向量索引
CREATE INDEX ON document_chunks
    USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);

-- 长期记忆（Mem0 自带存储，此表用于管理/审计）
CREATE TABLE memory_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    memory_type VARCHAR(32),               -- user | agent | fact
    content TEXT,
    source_skill VARCHAR(128),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 桌面布局
CREATE TABLE desktop_layouts (
    user_id UUID PRIMARY KEY REFERENCES users(id),
    icons JSONB DEFAULT '[]',              -- [{appId, x, y}]
    taskbar_pins JSONB DEFAULT '[]',       -- [appId, ...]
    wallpaper VARCHAR(512),
    theme VARCHAR(32) DEFAULT 'dark',
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 6. API 端点

```yaml
# === WebSocket ===
WS     /ws                                 # 主 WebSocket 连接，Agent 流式输出
                                           # 客户端发 agent_invoke，服务端推 token/tool_call/tool_result/agent_done

# === 对话管理 ===
GET    /api/v1/conversations               # 会话列表
POST   /api/v1/conversations               # 新建会话
DELETE /api/v1/conversations/{id}          # 删除会话
PATCH  /api/v1/conversations/{id}          # 更新会话标题
GET    /api/v1/conversations/{id}/messages # 获取消息历史
POST   /api/v1/conversations/{id}/chat     # SSE 流式对话（备用，主流程走 WS）

# === 模型代理 ===
POST   /api/v1/models/fetch                # 代理获取 Provider 模型列表（绕过 CORS）

# === 记忆 ===
POST   /api/v1/memory/init                 # 初始化 MemoryManager（配置 LLM + Embedder）
GET    /api/v1/memory                      # 列出所有记忆
GET    /api/v1/memory/search               # 语义搜索记忆
DELETE /api/v1/memory/{id}                 # 删除单条记忆
DELETE /api/v1/memory                      # 清空所有记忆

# === 知识库（RAG）===
POST   /api/v1/knowledge/init              # 初始化 KnowledgeManager（配置 Embedder + Qdrant）
GET    /api/v1/knowledge/status            # 初始化状态
GET    /api/v1/knowledge/documents         # 文档列表（含处理状态 pending/processing/done/error）
POST   /api/v1/knowledge/documents         # 粘贴文本添加文档
POST   /api/v1/knowledge/documents/upload  # 上传文件（TXT/MD/PDF），异步向量化
DELETE /api/v1/knowledge/documents/{id}    # 删除文档（同时清除 Qdrant points）
GET    /api/v1/knowledge/search            # 测试检索（返回相关片段 + 相关度分数）

# === Apps ===
GET    /api/v1/apps                        # 已安装 App 列表
GET    /api/v1/apps/marketplace            # App 市场
POST   /api/v1/apps/install                # 安装 App
DELETE /api/v1/apps/{id}                   # 卸载 App
PUT    /api/v1/apps/{id}/settings          # 更新 App 设置
GET    /api/v1/apps/{id}/tools             # 查看 App 暴露的 agent tools

# === Files ===
GET    /api/v1/files                       # 文件列表（支持路径参数）
POST   /api/v1/files/upload                # 上传文件
GET    /api/v1/files/{id}/download         # 下载文件
PUT    /api/v1/files/{id}                  # 更新文件元数据
DELETE /api/v1/files/{id}                  # 删除文件
POST   /api/v1/files/mkdir                 # 创建目录
POST   /api/v1/files/move                  # 移动/重命名
POST   /api/v1/files/copy                  # 复制

# === Settings ===
GET    /api/v1/settings                    # 获取用户设置
PUT    /api/v1/settings                    # 更新设置
PUT    /api/v1/settings/api-keys           # 更新 API Keys（加密存储）
GET    /api/v1/settings/desktop            # 桌面布局
PUT    /api/v1/settings/desktop            # 更新桌面布局

# === Soul ===
GET    /api/v1/soul                        # 读取 soul.md 内容
PUT    /api/v1/soul                        # 写入 soul.md 内容
GET    /api/v1/soul/exists                 # 检查 soul.md 是否存在且非空
```

---

## 7. 实施阶段

### 阶段一：OS 核心外壳（第 1-2 周）

> 目标：能看到桌面、能打开/关闭/拖动窗口

**前端：**

- [x] Turborepo + pnpm 项目初始化
- [x] Next.js app 搭建（Tailwind + shadcn/ui）
- [x] Desktop 组件（壁纸、图标网格）
- [x] WindowManager + Window 组件（react-rnd）
- [x] TitleBar（最小化/最大化/关闭按钮）
- [x] Taskbar（Start 按钮、窗口 tabs、系统托盘时钟）
- [x] StartMenu（App 列表、搜索）
- [x] ContextMenu（右键菜单）
- [ ] 窗口 snap（拖到屏幕边缘吸附）
- [x] Zustand stores（windowStore, settingsStore）
- [x] 第一个 App UI：Settings（API Key 配置、壁纸、主题）

**后端：**

- [x] FastAPI 项目初始化
- [x] Docker Compose（PostgreSQL + Redis + MinIO + Qdrant）
- [x] SQLAlchemy models（Conversation, Message, KnowledgeDocument, KnowledgeChunk）
- [x] 基础 API（对话 CRUD、模型代理）

**交付物：** 一个可交互的桌面环境，可以开关窗口，改壁纸。

---

### 阶段二：AI 核心（第 3-4 周）

> 目标：能和 AI 对话，流式输出，看到工具调用过程

**后端：**

- [x] LiteLLM 集成（多模型统一接口，支持 Anthropic/OpenAI/Google/DeepSeek/Qwen 等）
- [x] 用户 API Key 管理（前端 settingsStore 存储，请求时通过 Header 传递）
- [x] WebSocket 端点（`/ws`，持久连接，按 requestId 路由）
- [x] Agent loop（`agent_loop`，语义化事件 token/tool_call/tool_result，支持工具调用循环）
- [x] Conversation & Message CRUD（含对话标题自动生成）
- [ ] MCP Skill server（web_search）
- [x] 内置工具（web_search via Tavily、execute_code、read_file、write_file、retrieve_knowledge）

**前端：**

- [x] AI Chat App UI
  - [x] 消息列表（user/assistant/tool 三种气泡）
  - [x] 输入框（Shift+Enter 换行）
  - [x] 流式输出渲染（逐 token 显示）
  - [x] 工具调用可视化（ToolCallDisplay，展开/折叠）
  - [x] 模型选择器（ModelPicker，支持动态获取模型列表）
  - [x] 会话管理（新建、切换、删除）
- [x] useStream hook（WebSocket 流式消息处理，WsManager 单例）
- [ ] useAgent hook

**交付物：** 能用自己的 API Key 和 AI 对话，流式输出，能看到搜索工具调用的过程。

---

### 阶段三：记忆与知识系统（第 5-6 周）

> 目标：AI 能记住你，有自己的人格，能检索你的文档
>
> **Harness 原则**：实现"告知（Inform）"支柱——按需动态注入记忆上下文，而非全量塞入

**后端：**

- [x] Mem0 集成（MemoryManager）
  - [x] 自动记忆提取（对话后自动存储关键信息）
  - [x] 记忆搜索（Agent 调用前自动检索相关记忆，score ≥ 0.3 过滤）
  - [x] 记忆管理 API（查看、删除、清空）
  - [x] 异步写入（`add_async`，不阻塞 WS 流）
- [ ] SOUL.md 人格系统（参考 openclaw/soul.md 设计）
- [x] RAG Pipeline（Qdrant）
  - [x] 文档摄入（TXT、MD、PDF → 固定大小分块，500 字符 / 100 重叠）
  - [x] 嵌入生成（litellm.aembedding，支持用户配置任意 Embedder）
  - [x] Qdrant 存储与检索（独立 collection `ai_os_kb_default`，分批 upsert 100/批）
  - [x] 异步向量化（上传立即返回，后台 `asyncio.create_task` 处理）
  - [x] 处理状态轮询（pending → processing → done/error）
  - [x] `retrieve_knowledge` 工具（知识库初始化后动态加入 Agent 工具集）
- [x] Agent 增强
  - [x] 调用前自动检索相关记忆并注入 system prompt
  - [x] 知识库初始化后自动启用 `retrieve_knowledge` 工具

**前端：**

- [x] Settings → Memory 管理页
  - [x] 查看所有记忆条目
  - [x] 搜索记忆
  - [x] 删除记忆
  - [x] 清空全部记忆
- [ ] Settings → Memory 管理页增强（编辑单条记忆）
- [x] Settings → Knowledge Base 管理页
  - [x] 上传文档（TXT/MD/PDF，文件选择）
  - [x] 粘贴文本添加文档
  - [x] 查看已索引文档列表（含处理状态进度）
  - [x] 删除文档（两步确认，无 confirm() 对话框）
  - [x] 测试检索（带 loading 状态，显示相关度分数）
- [x] AI Chat 增强
  - [x] 显示记忆召回状态（recalled N 条）
  - [x] 记忆上下文自动注入 system prompt
- [ ] AI Chat 增强（SOUL.md）
- [ ] AI Chat 增强（RAG 引用来源标注）

**交付物：** AI 能跨会话记住用户偏好，有独立人格，能搜索用户上传的文档并引用。

---

### 阶段四：文件系统与 App 框架（第 7-8 周）

> 目标：完整的文件管理 + 可扩展的 App 系统
>
> **Harness 原则**：实现"约束（Constrain）"支柱——每个 App 暴露的运行时能力边界在 manifest 中显式声明

**后端：**

- [x] 宿主文件映射文件管理（FileManager）
  - 上传/下载/删除/移动/复制
  - 虚拟目录结构（路径映射 + 元数据抽象）
- [x] App Registry 完善
  - **Manifest + SKILL.md 双文件结构**（对齐标准化 Agent Skills 生态）
  - Manifest 解析与验证（含权限声明校验）
  - App 安装/卸载/更新生命周期
  - MCP server 进程管理（启动/停止/健康检查）
  - 动态 tool 注册与发现
  - **SKILL.md 按需加载**：Lead Agent 根据任务语义动态 pick 相关 Agent Skills，不全量注入
- [x] MCP Manager
  - MCP client 池管理
  - Tool 调用路由（根据 tool name → 对应 MCP session）
- [x] 代码执行沙箱升级
  - 本地开发：subprocess + 临时目录隔离（已实现）
  - 生产：Docker 容器隔离（AIO Sandbox 模式，借鉴 DeerFlow）
  - 支持 Local / Docker 两种模式，通过配置切换

**前端：**

- [x] File Manager App
  - 双面板布局（树 + 内容区）
  - 图标视图 / 列表视图 切换
  - 文件操作（新建、删除、重命名、移动、复制）
  - 拖拽上传
  - 文件预览（图片、文本、PDF）
  - 右键上下文菜单
  - 路径导航栏
- [x] Terminal App
  - [x] 当前实现：纯 AI 命令模式（用户输入自然语言 → Agent 执行）
  - [ ] 可选增强：xterm.js 集成
  - [ ] 可选增强：连接后端 shell（安全考量后再决定是否实现）
- [x] Notes App
  - Markdown 编辑器
  - AI 辅助写作（选中文本 → AI 改写/扩展/翻译）
  - 文件保存到虚拟文件系统
- [x] Settings → App 管理页
  - 外部 / 用户安装 App 列表（隐藏系统内置项）
  - 启用/禁用/配置
  - App 详情（tools, permissions）

**交付物：** 能管理文件，安装/配置 Apps，用终端和笔记应用。

---

### 阶段五：办公套件（第 9-12 周）

> 目标：完整的办公套件，每个都是 AI 增强的

**文档编辑器：**

- [ ] Tiptap (ProseMirror) 富文本编辑器
- [ ] AI 辅助面板
  - 选中文本 → 改写/翻译/扩展/总结
  - AI 自动补全（Tab 键触发）
  - 全文档 AI 操作（生成大纲、改变语调）
- [ ] 导出 PDF/DOCX/MD
- [ ] 自动保存到虚拟文件系统

**日历：**

- [ ] 月/周/日视图
- [ ] 事件 CRUD
- [ ] AI 日程助手（"帮我安排下周的会议"）
- [ ] Google Calendar 同步（可选）

**邮件客户端：**

- [ ] IMAP/SMTP 集成
- [ ] 邮件列表/详情/发送
- [ ] AI 辅助
  - 智能回复建议
  - 邮件摘要
  - 邮件分类/优先级

**白板/绘图：**

- [ ] tldraw 或 Excalidraw 集成
- [ ] AI 辅助（自然语言 → 图表）
- [ ] 导出为图片/SVG

**浏览器：**

- [ ] iframe 内嵌网页
- [ ] 地址栏
- [ ] AI 网页摘要（"总结这个页面"）
- [ ] 网页内容存入 Knowledge Base

**交付物：** 完整的 AI 增强办公套件。

---

### 阶段六：单 Agent 稳定化 + Manager Subagents + 可观测性（第 13-16 周）

> 目标：保留单 Agent 作为默认、可解释、低成本路径；在任务确实需要并行、隔离上下文或专业工具边界时，启用 Manager Subagents。Human-in-the-loop、持久化 checkpoint 和可观测性仍然是多 Agent 之前的硬前提。
>
> **Harness 原则**：工具选择权完全交给 LLM（通过 function calling + tool description），Harness 层只负责约束、校验与纠正，不做正则 scope 路由。

#### 已完成

- [x] **AI 助手统一入口增强**
  - 暂不保留独立系统级助手入口，避免多个对话入口造成心智负担
  - 已将跨 App 操作入口迁移到 AI 助手：浏览器 / 文件 / 文档 / 邮件 / 日历 / 白板统一从 AI 助手调起
  - 已支持系统 App 本地优先路由，避免邮件、日历等内置能力被误路由到浏览器或第三方网页

- [x] **Skills 两阶段加载（对齐主流 function calling 方案）**
  - 工具列表阶段：只向模型暴露 Skill 名称 + 一句话描述，保持 tool schema 轻量
  - 首次调用阶段：自动返回完整 使用说明作为 tool result，要求模型按说明改写 query 后再次调用
  - 二次调用阶段：按改写后的 query 真正执行脚本，完成实际数据获取
  - 知识型 Skill 通过 按需加载，由模型基于上下文直接回答
  - 已移除正则驱动的 路由：scope 正则无法理解跨轮语义，容易因表达方式不同误分类；工具选择权完全交给 LLM，与 OpenAI function calling / LangGraph / smolagents 风格一致

- [x] **Agent Harness 1.0（轻量安全策略层）**
  - 所有工具默认进入 function calling 候选集；浏览器工具等高风险工具按入口上下文硬限制
  - ：只拦截可证明错误或危险的调用——Skill 本地路径不可传文件工具、文件工具只能访问虚拟路径、calculator 只能处理纯数学表达式、重复相同查询会被阻止
  - ：工具执行后识别空结果、策略拦截、工具异常、缺少 Key、脚本失败、搜索空结果等不可信状态，校验提示回灌模型走 ReAct 修正路径
  - 时间类参数在 Harness 层按当前日期归一化，避免模型带入过期年份
  - 工具调用前只允许短前置说明（≤80字），禁止先输出数据结论再补工具调用
  - 策略拦截与结果校验以状态事件形式进入前端，形成可审计的执行链路

- [x] **单 Agent ReAct 执行链路（轻量 Orchestrator）**
  - 已形成 完整循环
  - 基于 LangGraph + checkpoint facade，每步状态可感知
  - 已预留 接口，用于后续接入人工确认节点
  - 实现为标准 ReAct 循环（Reasoning via function calling + Acting via tool execution），不是独立 scope 路由状态机

- [x] **Manager Subagents 1.0（多 Agent 初版）**
  - `delegate_task` 作为 agents-as-tools 风格委派入口，Lead Agent 始终保留最终回答所有权
  - `agent_types.py` 注册 `research` / `coder` / `system` / `writer` 四类 specialist
  - 子 Agent 按角色裁剪工具面，并禁止递归委派
  - 子 Agent 使用独立系统提示词、输出契约、`max_iterations` 与上下文
  - 并行执行最多 4 个子任务，结果以结构化 JSON 回传给 Lead Agent 综合
  - WebSocket 已流式转发 `subagent_token` / `subagent_result`，子 Agent 工具事件使用 `subagentId::toolCallId` 隔离并发 ID；当前轮长搜索结果在进入下一次 LLM 调用前压缩，原始结果仍保留给前端展示与持久化；前端以 Lead Agent 调度面板展示子任务、角色、工具调用、流式输出、失败原因与主 Agent 兜底工具

- [x] **Agent 状态可视化 1.0**
  - 复用 事件流
  - 前端可感知 Agent 当前所在节点、工具调用耗时、策略拦截原因、结果校验状态

- [x] **固定 Harness Eval**
  - 覆盖：工具始终可见、Skill 路径隔离、calculator 非数学拦截、空结果校验、重复调用去重、时间归一化、前置数据臆测抑制、LangGraph checkpoint

#### 待完成（当前优先级排序）

- [x] **Human-in-the-loop 执行确认层**（优先级：高）✅ 已完成
  - 新增 `confirmation_store.py`（asyncio.Future 注册表）
  - `agent_harness.py`：`CONFIRM_REQUIRED_TOOLS` + `tool_requires_confirmation()` - 默认空集合，可通过 `Settings.confirm_required_tools` 配置
  - `llm_provider.py`：`confirm_callback` / `confirm_tools` 参数；在执行前 await callback，用户拒绝时注入 "用户已拒绝该操作" 作为工具结果
  - `websocket.py`：`_make_confirm_callback()` 发送 `agent_confirm_required` 事件并 await Future
  - 前端确认通过 `POST /api/v1/agents/confirm?request_id=...&approved=true` REST 接口解决 Future

- [x] **持久化 Checkpoint（PostgresSaver）**（优先级：高）✅ 已完成
  - `pyproject.toml` 新增 `langgraph-checkpoint-postgres>=2.0.0` + `psycopg[binary,pool]>=3.1.0`
  - `agent_graph.py`：`init_checkpointer()` 异步初始化，自动尝试 `AsyncPostgresSaver`，失败则回落到 `InMemorySaver`；`shutdown_checkpointer()` 优雅关闭连接池
  - `main.py`：在 lifespan 启动时调用 `await init_checkpointer()`，关闭时调用 `await shutdown_checkpointer()`

- [x] **可观测性：Trace 集成**（优先级：中）✅ 已完成
  - `main.py`：`_setup_trace_instrumentation()`，按环境变量激活，无配置则零开销
  - Arize Phoenix：设置 `TRACE_PHOENIX_ENDPOINT=http://localhost:6006/v1/traces` 即激活（需安装 `openinference-instrumentation-litellm`）
  - LangSmith：设置 `TRACE_LANGSMITH_API_KEY=lsv2_...` 即激活
  - `config.py` 新增 `trace_phoenix_endpoint`、`trace_langsmith_api_key`、`trace_langsmith_project`

- [x] **Eval Pipeline（持续维护）**（优先级：中）✅ 已完成
  - `eval_agent_harness.py` 扩展至 12 个测试用例（原 9 个）
  - 新增 Case 10：`tool_requires_confirmation` 默认/extra_tools 行为验证
  - 新增 Case 11：skill 工具描述不超过 300 字符（防止 SKILL.md 嵌入 schema）
  - 新增 Case 12：confirmation_store create/resolve/discard 完整流程 + 幂等性验证

- [ ] **扩展中心 2.0**（优先级：低，产品层）
  - 在现有 MCP / Skill / App 管理能力上演进，不另起独立 Marketplace
  - 统一管理：MCP 配置（）、Skills 目录、App manifest 与启用状态
  - 支持本地安装、来源展示、版本信息、权限说明

#### 暂缓（多 Agent 1.0 稳定后再进入）

- [ ] **Conversation Handoff**
  - 适合 App 专属助手或客服式多阶段流程，不适合当前单 AI 助手主流式体验
  - 需要明确 active_agent 状态、跨轮记忆归属、ToolMessage 配对和上下文过滤策略

- [ ] **消息总线（Message Bus）**
  - 仅在真正需要多 Agent 并发、后台长任务、跨窗口共享状态时引入
  - 当前 Manager Subagents 仍在单请求内并发，暂不需要 Redis Pub/Sub 式 Agent 总线

- [ ] **完整 LangGraph StateGraph 编排**
  - 当前 LangGraph 是 checkpoint facade；后续再把 route / delegate / synthesize / evaluate 节点显式迁移到图中
  - 迁移前提：已有 eval 能稳定覆盖委派准确率、工具成功率、端到端任务完成率

- [x] **本地优先配置与数据归属统一化**
  - 敏感配置（API Keys、Embedding Key、MCP 配置）全部本地持久化，从不上传服务器
  - Settings → 关于：数据归属说明表格（5 类数据的存储位置与安全性）
  - Settings → 关于：配置导出/导入（完整 JSON 备份，跨设备迁移）

- [x] **性能与产品收尾**
  - [x] WebSocket 重连与心跳（指数退避重试 + 30s ping heartbeat）
  - [x] 主题系统：Light / Dark（`[data-theme]` CSS 变量集、ThemeProvider、desktopStore persist）
  - [x] 窗口虚拟化 1.0：窗口层计算可见性，被完全遮挡或屏幕外的可安全重建 App 只保留窗口壳与占位内容；编辑器、浏览器、AI Chat 等状态敏感 App 暂时 keep-alive，待 snapshot/resume 完善后扩大范围
  - [x] 前端代码分割：`AppRenderer.tsx` 改用 `next/dynamic`，12 个 App 独立 chunk 按需加载
  - [x] 自定义主题色：用户可自定义强调色，实时写入 CSS 变量
  - [x] 窗口动画收尾：open / close / minimize / restore 四套 keyframe 动画、snap 过渡、maximize 过渡均已实现

---

## 8. 核心设计原则

1. **App-First**: 所有桌面功能都是 App，包括"设置"和"文件管理器"。Agent Skills 是 App 内部能力，不与产品层命名混用。
2. **MCP-Native**: 工具调用统一走 MCP 协议，保证 Agent Skills 可发现、可组合、可替换。
3. **Memory as Infrastructure**: 长期记忆是系统级基础设施，所有 Agent 共享，不是某个应用的功能。
4. **Stream Everything**: 所有 AI 交互都流式输出，包括工具调用过程可视化。
5. **User Owns Keys**: 用户自带 API Key，系统不代持，数据完全归用户所有。
6. **Progressive Enhancement**: 每个 App 即使没有 AI 也能独立工作（如 File Manager 就是文件管理器），AI 是增强层。

### 8.1 Harness Engineering 四原则（新增）

> 参考：Mitchell Hashimoto (2026)、DeerFlow 2.0 架构、Anthropic《Effective Harnesses for Long-Running Agents》

7. **Constrain（约束）**: Agent 的能力边界在 manifest.json 中显式声明。沙箱隔离是默认行为，而非可选项。没有声明的权限，Agent 不能使用。
8. **Inform（告知）**: 不把所有上下文一次性塞给 Agent。记忆、RAG、Agent Skill workflow 都按需动态加载，保持 context 窗口聚焦。模型不变，改变信息输入质量，性能即可大幅提升。
9. **Verify（验证）**: 工具调用结果必须可视化、可审计。复杂任务引入 Human-in-the-loop 节点，让用户在关键步骤确认后再继续。LangGraph 检查点保证每步可回放。
10. **Correct（纠正）**: 对话反馈自动写回记忆系统（用户纠正 → 记忆更新 → 下次不再犯）。Agent 执行失败时走重试 + 降级路径，而非直接报错。

### 8.2 分层架构原则（新增，借鉴 DeerFlow）

```
┌─────────────────────────────────────┐
│  App Layer（api/）                  │  ← FastAPI、WebSocket、路由
│  依赖 Harness，不被 Harness 依赖     │
├─────────────────────────────────────┤
│  Harness Layer（core/）             │  ← Agent 编排、Tools、Memory、RAG
│  纯 Python，不依赖 Web 框架          │
├─────────────────────────────────────┤
│  Agent Skills Layer（skills/）      │  ← MCP Servers，各自独立进程
│  通过 MCP 协议与 Harness 通信        │
└─────────────────────────────────────┘
```

**规则**：上层依赖下层，下层不引用上层。`core/` 中的任何文件不得 `import` `api/` 中的任何内容。

---

## 9. 安全考量

- **API Keys**: 使用 AES-256 加密存储，仅后端解密，前端永不明文显示
- **Agent Skill Sandboxing**: MCP server 运行在独立进程，限制文件系统和网络访问
- **Code Execution Sandbox（三层隔离，借鉴 DeerFlow AIO Sandbox）**:
  - 第一层：进程隔离（cgroup 限制 CPU/内存）
  - 第二层：文件系统隔离（每个任务独立工作目录，不可访问宿主机）
  - 第三层：网络隔离（代码执行容器默认无外网，需显式声明）
  - 本地开发：subprocess 隔离；生产：Docker 容器
- **File Upload**: 文件大小限制、类型白名单、病毒扫描（可选）
- **WebSocket Auth**: JWT token 验证、连接限速
- **CORS**: 严格的源限制
- **Rate Limiting**: 每用户 API 调用限速
- **Tool Permission Declaration**: 每个 Agent Skill 在 manifest.json 中显式声明所需权限（`network`、`filesystem`、`subprocess`），未声明的权限 Harness 层拒绝执行

---

## 10. 测试策略

```
tests/
├── frontend/
│   ├── unit/                    # React Testing Library
│   │   ├── Window.test.tsx      # 窗口组件测试
│   │   ├── windowStore.test.ts  # Store 测试
│   │   └── useStream.test.ts    # Hook 测试
│   ├── integration/             # Playwright
│   │   ├── desktop.spec.ts      # 桌面交互
│   │   ├── window-manager.spec.ts
│   │   └── ai-chat.spec.ts
│   └── e2e/                     # Playwright E2E
│       └── full-workflow.spec.ts
│
├── backend/
│   ├── unit/
│   │   ├── test_skill_registry.py
│   │   ├── test_memory_manager.py
│   │   └── test_rag_engine.py
│   ├── integration/
│   │   ├── test_agent_loop.py
│   │   ├── test_mcp_manager.py
│   │   └── test_websocket.py
│   └── fixtures/
│       ├── mock_llm.py          # LLM 模拟（确定性响应）
│       └── mock_mcp.py          # MCP server 模拟
```

---

## 附录：快速开始命令

```bash
# 1. 克隆并安装
git init ai-native-os && cd ai-native-os
pnpm init && pnpm add -D turbo

# 2. 前端
pnpm create next-app apps/web --typescript --tailwind --app --src-dir
cd apps/web && pnpm add react-rnd zustand lucide-react
pnpm dlx shadcn@latest init

# 3. 后端
cd apps/api
uv init && uv add fastapi uvicorn sqlalchemy asyncpg alembic redis mem0ai litellm langchain langgraph mcp

# 4. 基础设施
docker compose up -d  # PostgreSQL + Redis + MinIO

# 5. 启动
turbo dev  # 并行启动前端 + 后端
```
