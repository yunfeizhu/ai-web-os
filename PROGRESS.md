# AI-Native OS 开发进度

## 阶段一：OS 核心外壳

状态：已完成

### 前端

- [x] Turborepo + pnpm 项目初始化
- [x] Next.js 15 + Tailwind CSS v4 + 字体方案
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
- [x] SQLAlchemy async models：`UserSettings`、`DesktopLayout`
- [x] Alembic 初始化迁移
- [x] Settings API：`GET/PUT /api/v1/settings`
- [x] Desktop Layout API：`GET/PUT /api/v1/settings/desktop`

---

## 阶段二：AI 核心

状态：已完成

目标：能够与 AI 对话、流式输出，并看到工具调用过程。

### 后端

- [x] LiteLLM 集成，多模型统一接口
- [x] 用户 API Key 管理，支持自定义 `base_url`
- [x] Agent 流式对话接口
- [x] 完整 Agent loop，支持 tool use 循环
- [x] 内置工具：`calculator` / `fetch_url` / `python_exec` 等
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
- [x] 虚拟目录结构与路径映射
- [x] App Registry
  - [x] `apps_registry` 目录结构
  - [x] 每个内置 App 含 `manifest.json` + `SKILL.md`
  - [x] Manifest 解析与同步
  - [x] App Skill 元数据标准化
  - [x] App 生命周期管理：activate / deactivate / enable / disable
  - [x] 内置工具注册
  - [x] 当前入口 App 的 `SKILL.md` 自动注入 Agent 上下文
  - [x] 多 Skill 规则匹配与组合加载
  - [x] 规则增强版语义路由：primary / secondary / conflict resolution
  - [x] 更强语义理解的多 Skill 路由器
- [x] MCP Manager
  - [x] builtin transport tool 路由
  - [x] stdio MCP 进程管理
  - [x] stdio MCP initialize / tools/list / tools/call
  - [x] HTTP MCP initialize / tools/list / tools/call
  - [x] 外部 MCP 配置切换为 `~/.ai-native-os/mcp.json`
  - [x] 外部 MCP 不再持久化到数据库
  - [x] 固定内置运行时方案：Node.js / Python / uv
- [x] Files API：列表 / 上传 / 下载 / 文本内容 / 新建文件夹 / 新建文本文件 / 重命名 / 移动 / 复制 / 删除 / 目录树
- [x] Apps API：列表 / 安装 / 编辑 / 删除 / 激活 / 停用 / 启用 / 禁用 / 工具列表
- [x] stdio MCP tool routing 协议实现

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
  - [x] 图片 / PDF / 音频 / 视频 / 表格预览与打开链路补全
  - [x] Excel 编辑器切换到 Univer Sheets
- [x] Terminal App
  - [x] AI 命令模式
  - [x] 工具调用日志展示
  - [x] 去除 Markdown 代码块污染
  - [x] 常见内建命令：`ll` / `ls` / `cd` / `pwd`
  - [x] 上下方向键命令历史
  - [x] 工具调用显示 MCP 配置名称
  - [x] Windows 风格终端配色
  - [ ] 可选增强：xterm.js 渲染层升级（当前为自定义 AI 终端实现，后续按需评估）
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
- [x] 后端启动期历史敏感配置清理逻辑已移除
- [x] “文件预览服务”不再作为阶段四阻塞项

---

## 阶段五：办公套件

状态：进行中（浏览器子项已基本完成，文档/表格已有基础能力，日历/邮件/白板未开始）

- [~] 文档与笔记
  - [x] Markdown Notes：本地笔记列表、打开、保存
  - [x] AI 写作辅助：润色 / 扩写 / 总结
  - [x] Text Editor：文本文件打开、编辑、保存
  - [ ] Tiptap / ProseMirror 富文本编辑器
  - [ ] 选中文本级 AI 操作与自动补全
  - [ ] 导出 PDF / DOCX / MD
- [~] 表格
  - [x] 文件管理器表格预览
  - [x] Spreadsheet Editor：基于 Univer Sheets 的表格打开、编辑、保存
  - [x] 支持 xlsx / xls / xlsm / ods / csv
  - [ ] AI 表格助手
- [ ] 日历：月 / 周 / 日视图 + AI 日程助手
- [ ] 邮件客户端：IMAP / SMTP + AI 智能回复
- [ ] 白板：tldraw / Excalidraw + AI 生成图表
- [x] 浏览器：页面容器 + AI 网页摘要
  - [x] Browser App：地址栏 / 前进后退 / 刷新 / 真实浏览器实时视图
  - [x] 真实浏览器 session / tab 管理与切换
  - [x] AI 助手可直接拉起浏览器并打开目标网站
  - [x] 网页正文抓取 + AI 摘要
  - [x] 当前网页加入知识库
  - [x] browser-runtime 独立容器化方案

---

## 阶段六：多 Agent 协作与完善

状态：未开始

- [ ] Meta-Agent：LangGraph 意图路由与工作流编排
- [ ] Agent 状态可视化
- [ ] App Marketplace
- [ ] 系统级 AI 助手
- [ ] 性能优化：窗口虚拟化 / WebSocket 重连 / 代码分割
