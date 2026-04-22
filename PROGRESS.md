# AI-Native OS 开发进度

## 阶段一：OS 核心外壳

状态：已完成

### 前端

- [x] Turborepo + pnpm 项目初始化
- [x] Next.js 15 + Tailwind CSS v4
- [x] Desktop 桌面组件
- [x] DesktopIcon 图标系统与 hover 动效
- [x] WindowManager + Window 拖拽 / 缩放
- [x] TitleBar 交通灯与双击最大化
- [x] Window Snap 左右半屏 / 最大化 / 预览动画
- [x] Dock 任务栏
- [x] StartMenu 启动器与搜索
- [x] ContextMenu 右键菜单
- [x] SystemTray 时钟
- [x] Zustand stores 与 localStorage 持久化
- [x] Settings App 基础页

### 后端

- [x] FastAPI 初始化与健康检查
- [x] Docker Compose 基础依赖
- [x] SQLAlchemy async models：UserSettings、DesktopLayout
- [x] Alembic 初始化迁移
- [x] Settings API：`GET/PUT /api/v1/settings`
- [x] Desktop Layout API：`GET/PUT /api/v1/settings/desktop`

---

## 阶段二：AI 核心

状态：已完成

### 后端

- [x] LiteLLM 集成，多模型统一接口
- [x] 用户 API Key 管理，支持自定义 `base_url`
- [x] Agent 流式对话接口
- [x] 完整 Agent loop，支持 tool use 循环
- [x] 内置工具：`calculator` / `fetch_url` / `python_exec`
- [x] Conversation & Message CRUD
- [x] 模型列表代理：`/api/v1/agents/models/fetch`

### 前端

- [x] AI Chat App UI
- [x] 模型选择器
- [x] 会话管理
- [x] 工具调用可视化
- [x] 历史消息与工具调用还原
- [x] `useStream` 流式处理

---

## 阶段三：记忆与知识系统

状态：已完成

### 后端

- [x] Mem0 集成
- [x] 记忆管理 API：init / list / search / delete / clear
- [x] 连接测试 API：LLM / Embedding / Tool
- [x] Agent 对话前自动检索 memory
- [x] Embedding 多 Provider 支持
- [x] Qdrant 按 Embedding 模型隔离 collection
- [x] RAG Pipeline：文档摄入 / 分块 / embedding / Qdrant 检索

### 前端

- [x] Settings → Memory 管理页
- [x] Settings → Embedding 配置页
- [x] AI Chat 记忆召回状态提示
- [x] 应用启动自动恢复记忆管理器
- [x] Settings → Knowledge Base 管理页
- [x] AI Chat 来源展示

---

## 阶段四：文件系统与 App 框架

状态：已完成

### 后端

- [x] 文件系统能力：上传 / 下载 / 删除 / 移动 / 复制 / 文本读写
- [x] 宿主文件映射与虚拟目录路径映射
- [x] App Registry
  - [x] `apps_registry` 目录结构
  - [x] 每个内置 App 的 `manifest.json` + `SKILL.md`
  - [x] Manifest 解析与同步
  - [x] App Skill 元数据标准化
  - [x] App 生命周期管理：activate / deactivate / enable / disable
  - [x] 内置工具注册
  - [x] 当前入口 App 的 `SKILL.md` 自动注入 Agent 上下文
  - [x] 多 Skill 规则匹配与组合加载
  - [x] 语义路由增强：primary / secondary / conflict resolution
- [x] MCP Manager
  - [x] builtin transport tool 路由
  - [x] stdio MCP 进程管理
  - [x] stdio MCP initialize / tools/list / tools/call
  - [x] HTTP MCP initialize / tools/list / tools/call
  - [x] 外部 MCP 配置切换到 `~/.ai-native-os/mcp.json`
  - [x] 固定内置运行时方案：Node.js / Python / uv
- [x] Files API：列表 / 上传 / 下载 / 文本内容 / 新建文件夹 / 新建文本文件 / 重命名 / 移动 / 复制 / 删除 / 目录树
- [x] Apps API：列表 / 安装 / 编辑 / 删除 / 激活 / 停用 / 启用 / 禁用 / 工具列表

### 前端

- [x] File Manager App
  - [x] 左侧目录树 + 右侧内容区
  - [x] 图标视图 / 列表视图切换
  - [x] 新建文件夹 / 新建文本文件
  - [x] 重命名 / 移动 / 复制 / 删除
  - [x] 拖拽上传
  - [x] 路径面包屑
  - [x] 右键上下文菜单
  - [x] 不同文件类型图标
  - [x] 文本文件编辑链路
  - [x] 图片 / PDF / 音频 / 视频 / 表格预览与打开链路
  - [x] Excel 编辑器切换到 Univer Sheets
- [x] Terminal App
  - [x] AI 命令模式
  - [x] 工具调用日志展示
  - [x] 去除 Markdown 代码块污染
  - [x] 常见内建命令：`ll` / `ls` / `cd` / `pwd`
  - [x] 上下方向键命令历史
  - [x] 工具调用显示 MCP 配置名称
  - [x] Windows 风格终端配色
  - [ ] 可选增强：xterm.js 渲染层升级
- [x] Notes App
  - [x] Markdown 编辑与预览
  - [x] AI 辅助写作
  - [x] 笔记列表与切换
  - [x] 保存到虚拟文件系统 `/Notes/*.md`
- [x] Settings → 扩展能力页
  - [x] 外部 MCP 服务接入
  - [x] 编辑 / 删除 / 启用 / 禁用 / 连接 / 断开 / 刷新工具
  - [x] 支持 stdio MCP 与远程 HTTP MCP
  - [x] 隐藏系统内置项

### 备注

- [x] LLM / Embedding 配置改为浏览器 `localStorage` 持久化，不再入库
- [x] 外部 MCP 配置改为本地 `mcp.json` 持久化，不再入库
- [x] “文件预览服务”不再作为阶段四阻塞项

---

## 阶段五：办公套件

状态：已完成（首个完整可用版）

- [x] 文档与笔记
  - [x] Markdown Notes：本地笔记列表、打开、自动保存
  - [x] Notes：macOS 风格三栏界面、稳定切换、列表搜索
  - [x] Notes：AI 写作辅助（润色 / 扩写 / 总结）直接写回正文
  - [x] Text Editor：文本文件打开、编辑、保存
  - [x] Document Editor：基于 TipTap 的富文本编辑
  - [x] Document Editor：局部 AI 改写 / 翻译 / 扩写、全文大纲整理 / 调整语气 / 续写
  - [x] Document Editor：文档列表内联重命名 / 删除、未保存状态提示、关闭前确认
  - [x] 导出 MD / PDF / DOCX
- [x] 表格
  - [x] 文件管理器表格预览
  - [x] Spreadsheet Editor：基于 Univer Sheets 的表格打开、编辑、保存
  - [x] 支持 xlsx / xls / xlsm / ods / csv
- [x] 日历
  - [x] 月 / 周 / 日视图
  - [x] 事件 CRUD
  - [x] AI 日程助手：自然语言生成事件并写入日历
  - [x] macOS 风格当前日期高亮、焦点日期联动与年月快速切换
  - [x] 自定义日期时间选择器与年份 / 月份面板切换
- [x] 邮件客户端
  - [x] IMAP / SMTP 账户配置
  - [x] 收件箱 / 已发送 / 草稿箱切换
  - [x] 收件箱同步与邮件详情
  - [x] 撰写并发送邮件
  - [x] 本地草稿保存、继续编辑与已发送记录
  - [x] 附件元数据展示与下载
  - [x] AI 邮件摘要
  - [x] AI 回复草稿
- [x] 白板
  - [x] 本地白板文件
  - [x] 可拖拽节点画布
  - [x] 节点文本编辑、删除与关系连线展示
  - [x] AI 自然语言生成结构图
  - [x] 画布缩放 / 适配视图 / Ctrl + 滚轮缩放
  - [x] 白板列表内联重命名 / 删除
- [x] 浏览器
  - [x] Browser App：地址栏 / 前进后退 / 刷新 / 真实浏览器实时视图
  - [x] 真实浏览器 session / tab 管理与切换
  - [x] AI 助手可直接拉起浏览器并打开目标网站
  - [x] 浏览器窗口与真实 session 聚焦联动、切换不闪烁
  - [x] 网页正文抓取 + AI 摘要
  - [x] 当前网页加入知识库
  - [x] browser-runtime 独立容器化方案

---

## 阶段六：多 Agent 协作与完善

状态：进行中

- [x] AI 助手统一入口增强
  - [x] 跨 App 操作入口统一迁移到 AI 助手
  - [x] 系统 App 本地优先路由：邮件 / 日历 / 文件 / 文档 / 笔记 / 白板
  - [x] 输入区系统 App 候选入口
  - [ ] 独立系统级助手入口（可选，暂缓）
- [x] Skills 渐进加载 / 工具描述路由
  - [x] 首轮只注入 Skill 名称 / 描述 / 路径等发现元信息
  - [x] 脚本型 Skill 作为 `skill_*` function calling 工具直接暴露，靠工具描述与模型语义选择调用
  - [x] 脚本型 Skill 首次调用返回精简 `SKILL.md` 使用说明，模型按说明重写 query 后再次调用
  - [x] 知识型 Skill 通过 `load_skill_context` 按需加载完整 `SKILL.md`
  - [x] 移除正则 `ToolScope` 路由，避免关键词误分类和跨轮语义断裂
- [x] Agent Harness 1.0
  - [x] 采用 OpenAI function calling / LangGraph / smolagents 风格的工具描述引导，不再用正则 scope 接管工具路由
  - [x] 引入 `ToolPolicyGuard`，拦截 Skill 本地路径被误传给文件工具、非虚拟文件路径访问、calculator 非数学表达式、重复工具调用等问题
  - [x] 引入 `ToolResultValidation`，校验空结果、策略拦截、工具异常、缺少 Key、Skill 脚本失败等结果状态
  - [x] 引入时间参数归一化，按当前日期修正实时查询里模型生成的过期年份
  - [x] 工具执行前增加策略审计事件，前端可展示“已拦截不合规工具调用，正在修正”
  - [x] 工具执行后增加 validation 状态事件，模型可基于校验提示继续 ReAct 修正
  - [x] 抑制工具调用前的表格 / 数据类臆测输出，只允许短前置说明，避免先编造再调用工具
  - [x] Skill 路径改为展示信息，禁止作为文件管理器虚拟路径读取
  - [ ] 确定性 `FallbackPolicy` 状态机（如 Skill 失败后强制切换实时研究工具）
- [x] Human-in-the-loop 与执行确认
  - [ ] 复杂任务先展示计划
  - [x] 危险操作二次确认（`CONFIRM_REQUIRED_TOOLS` 配置，`confirmation_store` asyncio.Future 暂停 Agent 循环）
  - [x] 前端 `agent_confirm_required` WebSocket 事件 + `POST /api/v1/agents/confirm` REST 解决 Future
  - [x] 执行中断 / 取消（用户拒绝 → 注入 "用户已拒绝该操作"，Agent 可继续）
- [x] Agent 状态可视化 1.0
  - [x] 基于现有 token / tool_call / tool_result 的执行时间线
  - [x] 步骤状态、耗时、失败点展示
  - [ ] Token / 成本展示
- [x] 轻量 Orchestrator / Graph Checkpoint Runtime
  - [x] 基于现有 App / Skill 路由的串行工作流编排
  - [x] ReAct 链路状态：LLM 决策 / 策略守卫 / 执行工具 / 校验结果
  - [x] 引入真实 LangGraph `StateGraph` 作为 checkpoint facade
  - [x] `InMemorySaver` → `AsyncPostgresSaver` 自动升级（`langgraph-checkpoint-postgres`），fallback 到 InMemorySaver
  - [x] interrupt / resume 运行时接口落地（Human-in-the-loop 实际使用）
  - [ ] 多 App 任务计划与结果汇总
- [x] Manager Subagents 1.0（多 Agent 初版）
  - [x] 参考 OpenAI agents-as-tools / Anthropic orchestrator-workers / LangChain subagents，确定“Lead Agent 保留对话所有权，specialist 作为工具执行”的主模式
  - [x] `agent_types.py` 注册 `research` / `coder` / `system` / `writer` 四类角色与独立系统提示词
  - [x] `delegate_task` 升级为角色化委派工具，要求 `role`、`task`、`agent_name`，支持 `output_format` / `success_criteria`
  - [x] 子 Agent 独立上下文、独立 `max_iterations`、禁止递归委派
  - [x] `get_tools_for_model()` 按角色裁剪工具面，并支持额外 `allowed_tools` 收窄
  - [x] 并行执行上限 4 个子任务，结构化汇总结果返回 Lead Agent
  - [x] WebSocket 已转发 `subagent_token` / `subagent_result`，前端已重写为 Lead Agent 调度面板 + 子 Agent 运行线 + 兜底工具区
  - [x] Harness eval 增至 17 个用例，覆盖子 Agent 工具面隔离、委派 spec 归一化、子 Agent 启动回归、并发工具事件 ID 隔离与当前轮工具结果压缩
- [x] 可观测性与评测
  - [x] 基础 Trace / 调用链状态事件
  - [x] Harness eval 扩展至 17 个用例（新增：`tool_requires_confirmation`、skill 描述长度校验、confirmation_store 完整流程、子 Agent 工具面隔离、委派 spec 归一化、子 Agent 启动回归、并发工具事件 ID 隔离、当前轮工具结果压缩）
  - [x] Trace 后端集成：Arize Phoenix（`TRACE_PHOENIX_ENDPOINT`）+ LangSmith（`TRACE_LANGSMITH_API_KEY`），零配置零开销
  - [ ] 工具调用成功率 / 路由准确率 / 端到端任务完成率（需真实流量积累）
  - [ ] Token / 成本统计
- [ ] 扩展中心 2.0
  - [ ] 基于现有 MCP / Skill / App 管理页演进
  - [ ] 本地安装、来源、版本、更新与权限说明
- [ ] 多 Agent 2.0（评估中）
  - [x] Lead Agent + Sub-Agent 初版：角色化任务拆解、并行执行、结果汇总
  - [x] 基础检查点：Harness 节点状态已进入 LangGraph checkpoint
  - [x] PostgresSaver 持久化检查点（`langgraph-checkpoint-postgres` + `psycopg[binary,pool]`）
  - [ ] Conversation Handoff：active_agent、上下文过滤、ToolMessage 配对、跨轮记忆归属
  - [ ] 完整 LangGraph StateGraph：route / delegate / synthesize / evaluate 节点显式化
  - [ ] 委派准确率、工具成功率、端到端任务完成率 eval
- [x] 性能与产品打磨
  - [x] WebSocket 重连：指数退避重试（1s→2s→4s→8s→16s）+ 30 秒心跳 ping
  - [x] Light / Dark 主题系统：`[data-theme]` CSS 变量集、`ThemeProvider` 同步到 `<html>`、desktopStore 持久化、Settings 外观页可视化切换
  - [x] 窗口虚拟化 1.0：窗口层计算可见性，被完全遮挡或屏幕外的可安全重建 App 只保留窗口壳与占位内容
  - [x] 代码分割：`AppRenderer.tsx` 改用 `next/dynamic` 懒加载，12 个 App 各自独立 chunk，首次打开时按需加载
  - [x] 本地优先配置与数据归属统一化：Settings → 关于页新增数据归属说明表格 + 配置导出/导入功能（含 API Keys 的完整 JSON 备份）
  - [x] 自定义主题色：用户可在 Settings 外观页自定义强调色，实时写入 CSS 变量
  - [x] 窗口动画收尾：open / close / minimize / restore keyframe 动画、snap 拖拽过渡、maximize/restore 位置过渡
