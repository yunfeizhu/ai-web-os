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
- [ ] MCP Agent Skill 标准协议 ← 推迟到阶段四

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

## 阶段四：文件系统与 App 框架

### 后端

- [x] MinIO 文件管理（FileManager）：上传 / 下载 / 删除 / 移动 / 复制 / 复制对象
- [x] 虚拟目录结构（PostgreSQL `FileEntry` model，path + parent_path 索引，自动初始化默认目录）
- [x] App Registry 完善
  - [x] apps_registry 目录结构（8 个内置 App：ai-chat / file-manager / terminal / notes / browser / calendar / settings / text-editor）
  - [x] 每个 App 含 manifest.json + SKILL.md 双文件
  - [x] Manifest 解析与同步（`sync_builtin_apps`）
  - [x] App Skill 标准化元数据（`skill.entrypoint` / `skill.format`）
  - [x] App 生命周期管理（activate / deactivate / enable / disable）
  - [x] 内置工具注册（list_files / read_file / write_file / list_notes / save_note）
  - [x] 当前入口 App 的 `SKILL.md` 自动注入到 Agent 上下文
  - [x] 第一版多 Skill 规则匹配与组合加载（最多 3 个 Skills）
  - [x] 规则增强版语义路由（primary / secondary / conflict resolution）
  - [ ] 更强语义理解的多 Skill 路由器与阶段式规划
- [x] MCP Manager
  - [x] builtin transport tool 路由（`call_tool` → handler 函数）
  - [x] stdio 进程管理框架（启动/终止/健康检查，协议层 NotImplemented 预留）
- [x] Files API（`/api/v1/files`）：列表 / 上传 / 下载 / 文本读写 / 新建目录 / 重命名 / 移动 / 复制 / 删除 / 目录树
- [x] Apps API（`/api/v1/apps`）：列表 / 激活 / 停用 / 启用禁用 / 工具列表
- [ ] stdio MCP tool routing 协议实现（当前 `NotImplementedError`，等待 MCP Python SDK 接入）

### 前端

- [x] File Manager App
  - [x] 双面板布局（左侧目录树 + 右侧内容区）
  - [x] 图标视图 / 列表视图切换
  - [x] 文件操作：新建目录、重命名、移动、复制、删除（带二次确认）
  - [x] 拖拽上传（dragover / drop 事件）
  - [x] 文本文件预览（.txt / .md / .json）
  - [x] 右键上下文菜单
  - [x] 路径导航面包屑
  - [x] 图片 / PDF 预览
  - [x] 音频 / 视频 / 表格预览
  - [x] 文本编辑器与表格编辑器打开链路
- [x] Terminal App
  - [x] AI 命令模式（自然语言 → Agent 执行工具）
  - [x] macOS Terminal Pro 主题（黑底、彩色 zsh 提示符、Cascadia Code 字体）
  - [x] 工具调用日志展示（▶ 折叠/展开，旋转动画）
  - [x] 去除 Markdown 代码块（系统提示 + stripCodeFences 双重保障）
  - [x] Tavily Key 正确透传（修复了漏传 bug）
- [x] Notes App
  - [x] Markdown 编辑器（raw 编辑 + 预览双模式）
  - [x] AI 辅助写作（续写 / 改写 / 润色，流式输出建议）
  - [x] 笔记列表与切换
  - [x] 保存到虚拟文件系统（`/Notes/*.md`）
- [x] Settings → App 管理页
  - [x] 已安装 App 列表（builtin 标识）
  - [x] 启用 / 禁用切换
  - [x] 激活 / 停用（MCP 进程控制）
  - [x] App 工具列表展示（permissions + tools）

---

## 阶段五：办公套件

- [ ] 文档编辑器（Tiptap + AI 辅助 + 导出 PDF/DOCX）
- [ ] 日历（月/周/日视图 + AI 日程助手）
- [ ] 邮件客户端（IMAP/SMTP + AI 智能回复）
- [ ] 白板（tldraw/Excalidraw + AI 生成图表）
- [ ] 浏览器（iframe + AI 网页摘要）

---

## 阶段六：多 Agent 协作与完善

- [ ] Meta-Agent（LangGraph 意图路由 + 多 Agent Skill 工作流编排）
- [ ] Agent 状态可视化（执行流程图、token 用量）
- [ ] App Marketplace
- [ ] 系统级 AI 助手（Cmd+Space 全局搜索）
- [ ] 性能优化（窗口虚拟化、WebSocket 重连、代码分割）
