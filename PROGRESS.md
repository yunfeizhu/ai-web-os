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

状态：未开始

- [ ] Meta-Agent：LangGraph 意图路由与工作流编排
- [ ] Agent 状态可视化
- [ ] App Marketplace
- [ ] 系统级 AI 助手
- [ ] 性能优化：窗口虚拟化 / WebSocket 重连 / 代码分割
