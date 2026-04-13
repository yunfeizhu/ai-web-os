# AI-Native OS — 架构与实施方案

## 1. 愿景

AI-Native OS is a web 端完全体 AI 操作系统。它不是一个"套了 Windows 皮肤的网页"，而是一个以 **AI Agent 为核心运行时**的新计算范式。

- 传统 OS 的核心是 **进程调度 + 文件系统**
- AI OS 的核心是 **Agent 调度 + 知识系统**

每一个"应用"都是一个 AI Agent（Skill），具备独立的能力边界、工具集和权限范围。操作系统本身是一个 Meta-Agent，负责理解用户意图、路由到对应 Skill、协调多 Agent 协作。

### 1.1 核心范式对比

| 传统操作系统        | AI 操作系统                                            |
| ------------------- | ------------------------------------------------------ |
| 应用程序（.exe）    | Skill / Agent（MCP Server + UI Component）             |
| 文件系统            | 知识库（PostgreSQL + Qdrant + MinIO）                  |
| 进程间通信（IPC）   | Agent 消息总线（WebSocket + Redis Pub/Sub）            |
| 系统 API            | 工具调用（MCP Protocol）                               |
| 内存管理            | 上下文管理 + 长期记忆（Mem0）                          |
| 应用商店            | Skill 市场                                             |
| 用户偏好设置        | Agent 人格 / 行为配置                                  |
| 任务管理器          | Agent 状态仪表盘                                       |
| 内核                | Meta-Agent（LangGraph 编排器）                         |

### 1.2 设计哲学：Harness Engineering

> "与其追逐更强的模型，不如构建更好的驾驭系统。"

本项目的核心设计思想源自 **Harness Engineering** 范式（2026年业界共识）：AI Agent 就像一匹动力强劲但难以预测的马，Harness（马具）是那套让它既能跑得快、又不会跑偏的缰绳与马鞍。

AI OS 本质上就是一套 **Super Agent Harness**——不优化模型本身，而是构建运行模型的完整环境：

```
┌─────────────────────────────────────────────────────────────┐
│                    AI OS = Agent Harness                    │
│                                                             │
│  约束（Constrain）   ── 沙箱隔离、权限边界、MCP 协议        │
│  告知（Inform）      ── 记忆系统、RAG、Skills 上下文注入    │
│  验证（Verify）      ── 工具调用结果校验、Human-in-the-loop  │
│  纠正（Correct）     ── 反馈循环、Agent 自我修复机制         │
└─────────────────────────────────────────────────────────────┘
```

四个支柱在本系统中的体现：

| Harness 支柱 | 在本系统的实现                                              |
| ------------ | ----------------------------------------------------------- |
| 约束         | MCP 进程隔离、Docker 沙箱、工具权限声明（manifest.json）    |
| 告知         | Mem0 长期记忆、Qdrant RAG、Skill 按需动态加载上下文         |
| 验证         | 工具调用结果可视化、Human-in-the-loop 确认节点              |
| 纠正         | Agent 循环中的错误重试、用户反馈写回记忆、LangGraph 检查点  |

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

| 层级        | 选型           | 理由                                         |
| ----------- | -------------- | -------------------------------------------- |
| API 服务    | Python FastAPI | 异步、高性能、AI/ML 生态兼容                 |
| Agent 编排  | LangGraph      | 图状态机、检查点、人工干预节点               |
| 工具协议    | MCP            | 标准化工具发现与调用、Anthropic 官方标准     |
| LLM 集成    | LiteLLM        | 统一接口，支持 100+ 模型提供商，用户自带 Key |
| 代码沙箱    | Docker（AIO Sandbox 模式）| 每个任务独立容器，完整文件系统 + Bash，隔离安全 |

#### 后端分层原则（借鉴 DeerFlow）

严格单向依赖：**App 层 → Harness 层**，Harness 层不引用 App 层。

```
apps/api/app/
  core/        ← Harness 层：Agent 编排、Tools、Memory、RAG（不依赖 FastAPI）
  api/         ← App 层：FastAPI 路由、WebSocket（依赖 core）
```

这样 `core/` 可以独立测试，未来替换 Web 框架也不影响 Agent 逻辑。

### 2.3 数据层

| 层级     | 选型           | 理由                                |
| -------- | -------------- | ----------------------------------- |
| 主数据库 | PostgreSQL 16  | 关系数据 + pgvector 向量扩展一体化  |
| 向量检索 | Qdrant         | 高性能向量数据库，支持 score_threshold、分批 upsert |
| 缓存/消息 | Redis 7       | Session 状态、Agent 消息总线、缓存  |
| 对象存储 | MinIO          | S3 兼容、自托管、用户文件与文档存储 |
| 长期记忆 | Mem0           | 跨会话用户记忆、Agent 记忆          |
| ORM      | SQLAlchemy 2.0 | 异步支持、成熟稳定                  |

### 2.4 基础设施

| 层级       | 选型           | 理由                     |
| ---------- | -------------- | ------------------------ |
| Monorepo   | Turborepo      | 快速构建、缓存、依赖管理 |
| 包管理器   | pnpm           | 高效磁盘使用、严格依赖   |
| 容器化     | Docker Compose | 本地开发一键启动         |
| Python 环境 | uv            | 极速 Python 包管理       |

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
│   │   │   │   │   └── Terminal.tsx           # 终端（xterm.js）
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
│   │   │   │   │   └── SkillConfig.tsx       # Skill 管理
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
│       │   │   │   ├── skills.py             # Skill 管理端点
│       │   │   │   ├── memory.py             # Memory 端点
│       │   │   │   ├── files.py              # 文件管理端点
│       │   │   │   ├── rag.py                # RAG 检索端点
│       │   │   │   └── settings.py           # 设置端点
│       │   │   └── websocket.py              # WebSocket 端点
│       │   │
│       │   ├── core/                         # 核心服务
│       │   │   ├── orchestrator.py           # LangGraph Meta-Agent
│       │   │   ├── skill_registry.py         # Skill 注册与生命周期管理
│       │   │   ├── memory_manager.py         # 记忆管理（Mem0 + Redis）
│       │   │   ├── rag_engine.py             # RAG 引擎（pgvector）
│       │   │   ├── mcp_manager.py            # MCP Server 管理
│       │   │   ├── llm_provider.py           # LiteLLM 多模型统一接口
│       │   │   └── file_manager.py           # MinIO 文件管理
│       │   │
│       │   ├── models/                       # SQLAlchemy Models
│       │   │   ├── user.py
│       │   │   ├── skill.py
│       │   │   ├── memory.py
│       │   │   ├── document.py
│       │   │   └── conversation.py
│       │   │
│       │   ├── schemas/                      # Pydantic Schemas
│       │   │   ├── agent.py
│       │   │   ├── skill.py
│       │   │   ├── memory.py
│       │   │   └── file.py
│       │   │
│       │   └── websocket/
│       │       ├── agent_stream.py           # LLM 流式响应
│       │       └── agent_bus.py              # Agent 间通信总线
│       │
│       ├── skills/                           # 内置 MCP Skill Servers
│       │   ├── web_search/
│       │   │   ├── server.py                 # MCP server
│       │   │   └── manifest.json             # Skill 清单
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

### 4.2 Skill 系统架构

#### Skill 即 Markdown（借鉴 DeerFlow Skills 系统）

Skill 的工作流定义采用 **Markdown 文件**，而非硬编码逻辑。这解决了两个问题：
1. **上下文控制**：不全量注入所有 Skill 描述，Lead Agent 按任务动态加载相关 Skill，节省 token
2. **可扩展性**：任何人都可以用写文档的方式创建新 Skill，无需修改代码

```
skills/
  web-search/
    manifest.json       ← Skill 元数据（ID、权限、工具声明）
    workflow.md         ← 工作流指令（Lead Agent 按需加载）
    server.py           ← MCP server 实现
  code-executor/
    manifest.json
    workflow.md         ← "如何执行代码、处理错误、返回结果"
    server.py
  deep-research/
    manifest.json
    workflow.md         ← "搜索→抓取→分析→报告 完整步骤"
    server.py
```

`workflow.md` 示例：
```markdown
# Deep Research Workflow

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

#### Skill 清单格式

```jsonc
// skills/web_search/manifest.json
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

### 4.3 Agent 编排（LangGraph）

系统核心是一个 LangGraph 构建的 **Lead Agent + Sub-Agent** 架构（借鉴 DeerFlow 2.0），负责理解用户意图、拆解任务、并行调度多个 Sub-Agent：

#### Lead Agent + Sub-Agent 并行架构

```
用户请求
  │
  ▼
Lead Agent（意图理解 + 任务拆解）
  │
  ├─── 简单任务 ──────────────────────────────► 直接回答
  │
  └─── 复杂任务（并行孵化 Sub-Agents）
         │
         ├── Sub-Agent A: web-search  ──► 独立上下文 + 独立工具集
         ├── Sub-Agent B: code-executor ► 独立上下文 + 独立工具集
         └── Sub-Agent C: file-manager ─► 独立上下文 + 独立工具集
                │
                ▼
         Lead Agent 汇总结果 → 流式返回用户
```

每个 Sub-Agent 拥有：
- 独立的上下文（不污染其他 Agent）
- 独立的工具集（只能访问其 Skill 声明的工具）
- 独立的终止条件
- 并行执行（IO 密集型任务效率提升 3-5x）

#### ThreadState：带 Reducer 的显式状态管理（借鉴 DeerFlow ThreadState）

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

#### 系统核心是一个 LangGraph 构建的 Meta-Agent，负责理解用户意图并协调 Skills：

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

#### 多 Skill 工作流示例

```
用户: "帮我搜索最新的 AI Agent 框架对比，整理成一份文档保存到桌面"

Meta-Agent 解析:
  intent: "research + document creation"
  skills_needed: ["web-search", "document-editor", "file-manager"]
  is_multi_step: true
  plan:
    1. web-search: 搜索 "AI Agent framework comparison 2026"
    2. web-search: 获取搜索结果页面内容
    3. document-editor: 将信息整理成结构化文档
    4. file-manager: 保存到用户桌面目录

执行流:
  web-search Agent → [search_tool, fetch_tool] → 搜索结果
       ↓
  document-editor Agent → [create_doc, format_doc] → 文档内容
       ↓
  file-manager Agent → [save_file] → 保存完成
       ↓
  Meta-Agent → 综合结果 → 返回用户
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
│  │  - 用户文档和文件（MinIO 存储原文件）             │   │
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
    | "token"               // LLM 流式 token
    | "tool_call"           // 工具调用（含 id/name/args）
    | "tool_result"         // 工具执行结果（含 id/name/result/error）
    | "status"              // 状态通知（如记忆召回）
    | "agent_done"          // Agent 完成，附带完整 content + title
    | "agent_error"         // Agent 错误
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
    storage_key VARCHAR(512),              -- MinIO object key
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

# === Skills ===
GET    /api/v1/skills                      # 已安装 Skill 列表
GET    /api/v1/skills/marketplace          # Skill 市场
POST   /api/v1/skills/install              # 安装 Skill
DELETE /api/v1/skills/{id}                 # 卸载 Skill
PUT    /api/v1/skills/{id}/settings        # 更新 Skill 设置
GET    /api/v1/skills/{id}/tools           # 查看 Skill tools

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

### 阶段四：文件系统与 Skill 框架（第 7-8 周）

> 目标：完整的文件管理 + 可扩展的 Skill 系统
>
> **Harness 原则**：实现"约束（Constrain）"支柱——每个 Skill 的能力边界在 manifest 中显式声明

**后端：**

- [ ] MinIO 文件管理（FileManager）
  - 上传/下载/删除/移动/复制
  - 虚拟目录结构（PostgreSQL files 表）
  - 文件预览（图片缩略图、文档预览）
- [ ] Skill Registry 完善
  - **Manifest + workflow.md 双文件结构**（借鉴 DeerFlow Skills 系统）
  - Manifest 解析与验证（含权限声明校验）
  - Skill 安装/卸载/更新生命周期
  - MCP server 进程管理（启动/停止/健康检查）
  - 动态 tool 注册与发现
  - **workflow.md 按需加载**：Lead Agent 根据任务语义动态 pick 相关 Skill workflow，不全量注入
- [ ] MCP Manager
  - MCP client 池管理
  - Tool 调用路由（根据 tool name → 对应 MCP session）
- [ ] 代码执行沙箱升级
  - 本地开发：subprocess + 临时目录隔离（已实现）
  - 生产：Docker 容器隔离（AIO Sandbox 模式，借鉴 DeerFlow）
  - 支持 Local / Docker 两种模式，通过配置切换

**前端：**

- [ ] File Manager App
  - 双面板布局（树 + 内容区）
  - 图标视图 / 列表视图 切换
  - 文件操作（新建、删除、重命名、移动、复制）
  - 拖拽上传
  - 文件预览（图片、文本、PDF）
  - 右键上下文菜单
  - 路径导航栏
- [ ] Terminal App
  - xterm.js 集成
  - 连接后端 shell（可选，安全考量）
  - 或纯 AI 命令模式（用户输入自然语言 → Agent 执行）
- [ ] Notes App
  - Markdown 编辑器
  - AI 辅助写作（选中文本 → AI 改写/扩展/翻译）
  - 文件保存到虚拟文件系统
- [ ] Settings → Skill 管理页
  - 已安装 Skill 列表
  - 启用/禁用/配置
  - Skill 详情（tools, permissions）

**交付物：** 能管理文件，安装/配置 Skills，用终端和笔记应用。

---

### 阶段五：办公套件（第 9-12 周）

> 目标：完整的办公套件，每个都是 AI 增强的

**文档编辑器 Skill：**

- [ ] Tiptap (ProseMirror) 富文本编辑器
- [ ] AI 辅助面板
  - 选中文本 → 改写/翻译/扩展/总结
  - AI 自动补全（Tab 键触发）
  - 全文档 AI 操作（生成大纲、改变语调）
- [ ] 导出 PDF/DOCX/MD
- [ ] 自动保存到虚拟文件系统

**日历 Skill：**

- [ ] 月/周/日视图
- [ ] 事件 CRUD
- [ ] AI 日程助手（"帮我安排下周的会议"）
- [ ] Google Calendar 同步（可选）

**邮件客户端 Skill：**

- [ ] IMAP/SMTP 集成
- [ ] 邮件列表/详情/发送
- [ ] AI 辅助
  - 智能回复建议
  - 邮件摘要
  - 邮件分类/优先级

**白板/绘图 Skill：**

- [ ] tldraw 或 Excalidraw 集成
- [ ] AI 辅助（自然语言 → 图表）
- [ ] 导出为图片/SVG

**浏览器 Skill：**

- [ ] iframe 内嵌网页
- [ ] 地址栏
- [ ] AI 网页摘要（"总结这个页面"）
- [ ] 网页内容存入 Knowledge Base

**交付物：** 完整的 AI 增强办公套件。

---

### 阶段六：多 Agent 协作与完善（第 13-16 周）

> 目标：多 Agent 协作 + 系统级 AI 助手 + 产品打磨
>
> **Harness 原则**：实现完整四支柱——Lead Agent 调度、Sub-Agent 并行、Human-in-the-loop 验证、反馈纠正闭环

- [ ] **Lead Agent + Sub-Agent 并行架构**（借鉴 DeerFlow 2.0 核心架构）
  - Lead Agent：意图理解 + 任务拆解 + Sub-Agent 孵化
  - Sub-Agent：独立上下文、独立工具集、并行执行
  - AgentRegistry：Sub-Agent 定义注册与动态加载
  - 结果汇总：Lead Agent 合成多个 Sub-Agent 输出
- [ ] **ThreadState Reducer 模式**（借鉴 DeerFlow ThreadState）
  - `artifacts`：自动去重 Reducer
  - `viewed_images`：空字典清空 Reducer
  - `todos`：任务列表状态追踪
  - LangGraph PostgresSaver 检查点（每步可回放）
- [ ] Meta-Agent 完善
  - 意图路由优化
  - 多 Skill 工作流编排（workflow.md 动态加载）
  - **Human-in-the-loop 确认节点**（Harness: 验证支柱）
    - 复杂任务执行前展示计划，用户确认后继续
    - 危险操作（删除文件、发送邮件）强制二次确认
- [ ] Agent 状态可视化（Harness: 验证支柱）
  - Agent 执行流程图（实时展示 Lead → Sub-Agent 调度树）
  - 实时状态监控
  - Token 用量统计
- [ ] **消息总线（Message Bus）**（借鉴 DeerFlow message_bus.py）
  - 异步 pub/sub：`InboundMessage → queue → dispatcher`
  - `OutboundMessage → callbacks → channels`
  - 支持 Feishu/Slack/Telegram 等 IM 渠道接入（可选）
- [ ] Skill Marketplace
  - 社区 Skill 发布/安装
  - Skill 评分/评论
- [ ] 系统级 AI 助手（快捷键呼出，类 Spotlight/Copilot）
  - Cmd+Space 全局搜索 + AI 问答
  - 任意位置 AI 辅助
- [ ] 性能优化
  - 窗口虚拟化（只渲染可见窗口内容）
  - WebSocket 重连与心跳
  - 前端代码分割（每个 Skill 独立 chunk）
- [ ] 主题系统
  - Light/Dark 主题
  - 自定义主题色
  - 窗口动画（打开/关闭/最小化）

---

## 8. 核心设计原则

1. **Skill-First**: 所有功能都是 Skill，包括"设置"和"文件管理器"。没有硬编码的应用。
2. **MCP-Native**: 工具调用统一走 MCP 协议，保证 Skill 可发现、可组合、可替换。
3. **Memory as Infrastructure**: 长期记忆是系统级基础设施，所有 Agent 共享，不是某个应用的功能。
4. **Stream Everything**: 所有 AI 交互都流式输出，包括工具调用过程可视化。
5. **User Owns Keys**: 用户自带 API Key，系统不代持，数据完全归用户所有。
6. **Progressive Enhancement**: 每个 Skill 即使没有 AI 也能独立工作（如 File Manager 就是文件管理器），AI 是增强层。

### 8.1 Harness Engineering 四原则（新增）

> 参考：Mitchell Hashimoto (2026)、DeerFlow 2.0 架构、Anthropic《Effective Harnesses for Long-Running Agents》

7. **Constrain（约束）**: Agent 的能力边界在 manifest.json 中显式声明。沙箱隔离是默认行为，而非可选项。没有声明的权限，Agent 不能使用。
8. **Inform（告知）**: 不把所有上下文一次性塞给 Agent。记忆、RAG、Skill workflow 都按需动态加载，保持 context 窗口聚焦。模型不变，改变信息输入质量，性能即可大幅提升。
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
│  Skills Layer（skills/）            │  ← MCP Servers，各自独立进程
│  通过 MCP 协议与 Harness 通信        │
└─────────────────────────────────────┘
```

**规则**：上层依赖下层，下层不引用上层。`core/` 中的任何文件不得 `import` `api/` 中的任何内容。

---

## 9. 安全考量

- **API Keys**: 使用 AES-256 加密存储，仅后端解密，前端永不明文显示
- **Skill Sandboxing**: MCP server 运行在独立进程，限制文件系统和网络访问
- **Code Execution Sandbox（三层隔离，借鉴 DeerFlow AIO Sandbox）**:
  - 第一层：进程隔离（cgroup 限制 CPU/内存）
  - 第二层：文件系统隔离（每个任务独立工作目录，不可访问宿主机）
  - 第三层：网络隔离（代码执行容器默认无外网，需显式声明）
  - 本地开发：subprocess 隔离；生产：Docker 容器
- **File Upload**: 文件大小限制、类型白名单、病毒扫描（可选）
- **WebSocket Auth**: JWT token 验证、连接限速
- **CORS**: 严格的源限制
- **Rate Limiting**: 每用户 API 调用限速
- **Tool Permission Declaration**: 每个 Skill 在 manifest.json 中显式声明所需权限（`network`、`filesystem`、`subprocess`），未声明的权限 Harness 层拒绝执行

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
