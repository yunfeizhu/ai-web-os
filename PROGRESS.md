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
- [x] Settings App：API Key 配置 / 壁纸选择 / 关于

### 后端

- [x] FastAPI 初始化（CORS、lifespan、健康检查 /health）
- [x] Docker Compose（PostgreSQL 16 + pgvector、Redis 7、MinIO）
- [x] SQLAlchemy async models：UserSettings、DesktopLayout
- [x] Alembic 迁移配置 + 初始迁移 0001_initial_schema
- [x] Settings API：GET/PUT /api/v1/settings
- [x] Desktop Layout API：GET/PUT /api/v1/settings/desktop
- [x] API Key 删除：DELETE /api/v1/settings/api-keys/{provider}

---

## 阶段二：AI 核心 ✅ 已完成

> 目标：能和 AI 对话，流式输出，看到工具调用过程

### 后端

- [x] LiteLLM 集成（多模型统一接口，支持 Anthropic/OpenAI/Google/DeepSeek/Qwen/Moonshot/Doubao 等）
- [x] 用户 API Key 管理（前端传入，支持自定义 base_url）
- [x] SSE 流式端点 /api/v1/agents/conversations/{id}/chat（OpenAI 标准格式透传，raw_chunk.model_dump() 直通）
- [x] 完整 Agent loop（tool use 循环，最多 8 轮迭代）
- [x] 内置工具：calculator / fetch_url / web_search（Tavily）/ python_exec（subprocess）
- [x] Conversation & Message CRUD（PostgreSQL，含 tool_calls / tool_call_id 字段）
- [x] 模型列表代理 /api/v1/agents/models/fetch（绕过浏览器 CORS）
- [ ] MCP Skill server 标准协议 ← 推迟到阶段四

### 前端

- [x] AI Chat App UI
  - [x] 消息列表（user / assistant / error 三种气泡）
  - [x] 输入框（Enter 发送，Shift+Enter 换行）
  - [x] 流式输出渲染（逐 token + StreamingDots 动画）
  - [x] 模型选择器（按 provider 分组，只显示 model ID）
  - [x] 会话管理（新建、切换、删除、自动命名）
  - [x] 侧边栏折叠
  - [x] 工具调用可视化（ToolCallDisplay，running/done/error 状态，可折叠展开结果）
  - [x] 历史消息工具调用还原（刷新后正确显示工具调用和结果）
- [x] useStream hook（SSE 流式处理，OpenAI 标准 chat.completion.chunk 格式，delta.tool_calls 聚合，finish_reason 驱动工具调用触发）
- [x] Settings → 工具 API Keys（Tavily Key 配置入口）

---

## 阶段三：记忆与知识系统

### 后端

- [x] Mem0 集成（MemoryManager，异步写入队列 + debounce + 相似度去重）
- [x] 记忆管理 API（init / list / search / delete / clear）
- [x] 连接测试 API（LLM / Embedding / Tool 三类）
- [x] Agent 增强（对话前自动检索 memory，注入 system prompt）
- [x] Embedding 多 Provider 支持（OpenAI / 兼容接口 / Qwen / 硅基流动）
- [x] Qdrant 按 Embedding 模型隔离 collection（避免向量维度冲突）
- [x] RAG Pipeline（文档摄入 → 固定大小分块 → LiteLLM embedding → Qdrant 独立 collection 存储 → retrieve_knowledge 工具检索）

### 前端

- [x] Settings → Memory 管理页（记忆列表 / 搜索 / 删除 / 清空 / 当前模型信息）
- [x] Settings → Embedding 模型配置（多 Provider，设为当前，连接测试）
- [x] AI Chat 增强（"正在回忆…" recalling 状态）
- [x] 应用启动自动恢复记忆管理器（后端重启后无需手动重新初始化）
- [x] Settings → Knowledge Base 管理页（文件上传 .txt/.md/.pdf、粘贴文本、文档列表、检索测试、删除）
- [x] AI Chat 引用来源展示（retrieve_knowledge 工具调用卡片，显示查询词 + 检索片段）

---

## 阶段四：文件系统与 Skill 框架

### 后端

- [ ] MinIO 文件管理（上传/下载/删除/移动/复制）
- [ ] 虚拟目录结构（PostgreSQL files 表）
- [ ] Skill Registry 完善（Manifest 解析、MCP server 进程管理）
- [ ] MCP Manager（tool 调用路由）

### 前端

- [ ] File Manager App（双面板、图标/列表视图、右键菜单、拖拽上传、文件预览）
- [ ] Terminal App（AI 命令模式）
- [ ] Notes App（Markdown 编辑器 + AI 辅助写作）
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
