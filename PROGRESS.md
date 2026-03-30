# AI-Native OS 开发进度

## 阶段一：OS 核心外壳 ✅ 已完成

### 前端
- [x] Turborepo + pnpm 项目初始化
- [x] Next.js 15 + Tailwind CSS v4 + Plus Jakarta Sans / JetBrains Mono 字体
- [x] Desktop 组件（Unsplash 壁纸、右侧竖向图标网格）
- [x] DesktopIcon（macOS 渐变图标、hover 上浮动画）
- [x] WindowManager + Window（react-rnd 拖拽/缩放）
- [x] TitleBar（红黄绿交通灯、双击最大化）
- [x] Window Snap（左/右半屏、顶部最大化、预览动画、松手过渡动画、还原快照）
- [x] Dock（macOS 浮动任务栏、运行指示点、hover 放大）
- [x] StartMenu（全屏 Launchpad、实时搜索）
- [x] ContextMenu（右键菜单）
- [x] SystemTray（时钟）
- [x] Zustand stores：windowStore / desktopStore / settingsStore（localStorage 持久化）
- [x] Settings Skill：API Key 配置 / 壁纸选择 / 关于

### 后端
- [x] FastAPI 初始化（CORS、lifespan、健康检查 /health）
- [x] Docker Compose（PostgreSQL 16 + pgvector、Redis 7、MinIO）
- [x] SQLAlchemy async models：UserSettings、DesktopLayout
- [x] Alembic 迁移配置 + 初始迁移 0001_initial_schema
- [x] Settings API：GET/PUT /api/v1/settings
- [x] Desktop Layout API：GET/PUT /api/v1/settings/desktop
- [x] API Key 删除：DELETE /api/v1/settings/api-keys/{provider}

---

## 阶段二：AI 核心

> 目标：能和 AI 对话，流式输出，看到工具调用过程

### 后端
- [ ] LiteLLM 集成（多模型统一接口）
- [ ] 用户 API Key 管理（从 DB 读取解密后注入 LiteLLM）
- [ ] WebSocket 端点 /ws（agent_stream）
- [ ] 基础 Agent loop（system prompt → LLM → tool call → result → LLM）
- [ ] Conversation & Message CRUD（PostgreSQL）
- [ ] 第一个 MCP Skill server（web_search）

### 前端
- [ ] AI Chat Skill UI
  - [ ] 消息列表（user / assistant / tool 三种气泡）
  - [ ] 输入框（Shift+Enter 换行、文件拖拽附件）
  - [ ] 流式输出渲染（逐 token 显示）
  - [ ] 工具调用可视化（展开/折叠）
  - [ ] 模型选择器
  - [ ] 会话管理（新建、切换、删除）
- [ ] useStream hook（WebSocket 流式消息处理）
- [ ] useAgent hook（Agent 交互封装）

---

## 阶段三：记忆与知识系统

### 后端
- [ ] Mem0 集成（MemoryManager）
- [ ] RAG Pipeline（文档摄入 → 分块 → 嵌入 → pgvector 检索）
- [ ] Agent 增强（调用前自动检索 memory + RAG 上下文）

### 前端
- [ ] Settings → Memory 管理页
- [ ] Settings → Knowledge Base 管理页
- [ ] AI Chat 增强（"正在回忆…" / "正在检索文档…" 状态、引用来源）

---

## 阶段四：文件系统与 Skill 框架

### 后端
- [ ] MinIO 文件管理（上传/下载/删除/移动/复制）
- [ ] 虚拟目录结构（PostgreSQL files 表）
- [ ] Skill Registry 完善（Manifest 解析、MCP server 进程管理）
- [ ] MCP Manager（tool 调用路由）

### 前端
- [ ] File Manager Skill（双面板、图标/列表视图、右键菜单、拖拽上传、文件预览）
- [ ] Terminal Skill（AI 命令模式）
- [ ] Notes Skill（Markdown 编辑器 + AI 辅助写作）
- [ ] Settings → Skill 管理页

---

## 阶段五：办公套件

- [ ] 文档编辑器（Tiptap + AI 辅助 + 导出 PDF/DOCX）
- [ ] 日历（月/周/日视图 + AI 日程助手）
- [ ] 邮件客户端（IMAP/SMTP + AI 智能回复）
- [ ] 白板（tldraw/Excalidraw + AI 生成图表）
- [ ] 浏览器（iframe + AI 网页摘要）

---

## 阶段六：多 Agent 协作与完善

- [ ] Meta-Agent（LangGraph 意图路由 + 多 Skill 工作流编排）
- [ ] Agent 状态可视化（执行流程图、token 用量）
- [ ] Skill Marketplace
- [ ] 系统级 AI 助手（Cmd+Space 全局搜索）
- [ ] 性能优化（窗口虚拟化、WebSocket 重连、代码分割）
