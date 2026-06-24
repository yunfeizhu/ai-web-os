# AI Native OS 技术分享 PPT 大纲

> 这份文档可以直接提供给 AI，用于生成 PPT。
>
> 目标：生成一份面向研发团队的技术分享 PPT，重点讲清 AI Native OS 的完整功能、系统架构和核心实现原理。
>
> 推荐页数：32 页。
>

---

## Slide 1. 封面：AI Native OS

### 页面标题

AI Native OS

### 页面副标题

把 Agent 从聊天框放回工作流

### 页面内容

- 团队技术分享
- 关键词：Web Desktop、Agent Harness、Markdown Memory、Knowledge Base、Browser Runtime、MCP、Multi-Agent
- 一句话：一个运行在浏览器里的 AI 原生操作系统，把桌面、应用、文件、浏览器、记忆、知识库和工具运行时组织到同一个可观测 Harness 中。

### 讲者提示

开场先说清楚：这不是一个聊天机器人，而是一个让 Agent 在系统里行动的工作台。

---

## Slide 2. 分享主线：从“会回答”到“能行动”

### 页面标题

为什么需要 AI Native OS

### 核心观点

LLM 本身会生成答案，但真实工作流需要上下文、工具、权限、确认、记忆、文件和浏览器状态。AI Native OS 的目标是把这些东西组织成一个可控系统。

### 页面内容

- 普通 Chatbot 的边界：
  - 主要依赖对话历史。
  - 工具少，工具状态不可见。
  - 复杂任务容易丢上下文。
  - 执行失败后缺少纠正路径。
- AI Native OS 的变化：
  - 用户在 Web Desktop 中工作。
  - Agent 知道当前 App、文件、浏览器页面、记忆和知识库。
  - 工具调用经过 Harness 约束、确认和校验。
  - 多 Agent 可并行处理复杂任务。
  - 过程可观察、可评估、可回放。

---

## Slide 3. 项目全景：一个浏览器里的 AI 原生工作台

### 页面标题

项目全景：AI Native OS 由哪些系统组成

### 核心观点

项目不是单个 Chat App，而是一个由前端桌面、应用套件、Agent Harness、上下文系统、工具扩展、浏览器运行时和数据基础设施共同组成的 AI OS。

### 页面内容

#### 1. 前端工作台

- `apps/web`
- Next.js + React + Zustand。
- 提供 Web Desktop、Dock、WindowManager、AppRenderer、主题系统、窗口虚拟化。
- 内置 App：
  - AI Chat
  - File Manager
  - Terminal
  - Browser
  - Notes
  - Text Editor
  - Document Editor
  - Spreadsheet Editor
  - Calendar
  - Mail
  - Whiteboard
  - Settings
  - Avatar Pet

#### 2. 后端 API

- `apps/api`
- FastAPI + SQLAlchemy。
- 提供 REST API 与 WebSocket。
- 路由覆盖：
  - agents
  - apps
  - files
  - memory
  - knowledge
  - browser
  - calendar
  - mail
  - office
  - skills
  - extensions
  - channels
  - avatar
  - settings

#### 3. Agent Harness

- `llm_provider.py`
- `agent_harness.py`
- `tools.py`
- `agent_graph.py`
- `agent_handoff.py`
- 职责：
  - 模型调用
  - 工具 schema 生成
  - 工具执行
  - 策略拦截
  - 结果校验
  - Human-in-the-loop
  - Checkpoint
  - 多 Agent 委派
  - 流式事件输出

#### 4. 上下文系统

- Skill Context：根据当前 App 注入行为边界。
- Markdown Memory：长期记忆、本地优先、跨会话召回。
- Knowledge Base：文档和网页内容 RAG。
- Handoff Context：清理多 Agent 历史消息，避免 tool message 污染。

#### 5. 工具与扩展

- 内置工具：calculator、fetch_url、python_exec。
- 文件工具：list/read/write/move/copy/delete。
- 知识库工具：retrieve_knowledge。
- 浏览器工具：open/click/type/wheel/screenshot/extract/request_human。
- User Skills：脚本型和知识型技能。
- MCP：stdio 和 streamable-http 外部工具服务。
- 多 Agent 工具：delegate_task。

#### 6. Runtime Services

- PostgreSQL：会话、消息、设置、知识库元数据、checkpoint。
- Redis：运行时辅助。
- Qdrant：向量检索。
- MinIO：知识库原始文件。
- Browser Runtime：Chromium + Xvfb + x11vnc + websockify + noVNC + Playwright。
- 本地目录：`AI_NATIVE_OS_HOME` 保存 Memory、Skills、MCP 配置。

#### 7. 外部入口

- Web Desktop 是主入口。
- QQ Bot / Channels 复用 AgentTurnRunner。
- Browser App 支持真实浏览器实时视图和人工接管。

### 讲者提示

这页要讲完整，不要匆匆带过。它是听众理解后面所有模块的地图。

---

## Slide 4. 顶层架构分层：从工作台到运行时

### 页面标题

顶层架构：七层协同

### 核心观点

AI Native OS 的架构不是前后端两层，而是从交互、应用、状态、API、Harness、工具扩展到数据运行时的多层系统。

### 页面内容

| 层级 | 职责 | 代表模块 |
| --- | --- | --- |
| 交互层 | 用户在浏览器里操作桌面、窗口、应用 | Desktop、WindowManager、Dock |
| 应用层 | 具体工作流入口 | Chat、Browser、Files、Office、Settings |
| 状态层 | 本地状态和用户偏好 | Zustand、localStorage、ThemeProvider |
| API 层 | REST/WebSocket 编排入口 | FastAPI routers、`/ws` |
| Harness 层 | 模型执行管控 | llm_provider、agent_harness、agent_graph |
| 工具扩展层 | 内置工具、MCP、Skills、Browser | tools、mcp_manager、browser_tools |
| 数据运行时层 | 持久化、检索、对象存储、浏览器 | PostgreSQL、Qdrant、MinIO、browser-runtime |

### 讲者提示

强调 Harness 层不应依赖 App 层，核心逻辑放在 `core/`，API 只是入口。

---

## Slide 5. 一次 AI 请求的完整链路

### 页面标题

从用户输入到工具执行：一次请求穿过哪些系统

### 核心观点

用户发一条消息，不是直接请求模型。系统会先整理历史、注入 Skill、召回 Memory、构造工具面，然后进入 Harness Loop。

### 页面内容

1. 用户在 AI Chat 输入任务。
2. 前端恢复历史消息中的 tool calls 和 tool result。
3. `useStream` 发送 `agent_invoke` WebSocket 消息。
4. 后端解析 appId、conversationId、model、provider、history、settings。
5. Skill Context 根据当前 App 注入行为规则。
6. Memory Manager 召回长期记忆和 recent daily。
7. Handoff Context 清理历史 tool message。
8. Agent Harness 构造工具列表和系统提示。
9. LLM 产生 token 或 tool call。
10. Tool Runtime 执行文件、浏览器、知识库、MCP、Skill 等工具。
11. ToolPolicyGuard 和 ToolResultValidation 约束和校验。
12. 前端持续收到 token、tool_call、tool_result、status、subagent event。
13. 回合结束后保存消息、记录指标、写入候选记忆。

### 讲者提示

这页是后续所有技术细节的“请求主干”。后面每个模块都可以挂回这条链路。

---

## Slide 6. Web Desktop Shell：为什么先做桌面

### 页面标题

桌面不是视觉包装，而是 Agent 的工作上下文容器

### 核心观点

Web Desktop 让用户的工作不是发生在一个聊天框里，而是发生在文件、浏览器、文档、邮件、日历、白板等 App 组成的上下文中。

### 页面内容

- 多 App 并存：
  - 用户可以同时打开 Browser、Notes、File Manager、AI Chat。
  - Agent 可以知道当前入口 App。
- App-first 架构：
  - 每个 App 都可以有自己的 `SKILL.md`。
  - Skill Context 根据 appId 改变 Agent 行为边界。
- 窗口模型：
  - open、focus、resize、minimize、maximize、snap。
  - 每个窗口有 appState。
- 状态分层：
  - `windowStore` 管窗口。
  - `desktopStore` 管桌面偏好和主题。
  - `settingsStore` 管 provider/key/model。
  - `avatarStore` 管 Avatar。

### 讲者提示

说清楚“桌面”不是模仿操作系统外观，而是为了让 Agent 理解用户正在做什么。

---

## Slide 7. 前端应用加载与性能收尾

### 页面标题

让 Web OS 能长期运行：懒加载、主题、窗口虚拟化

### 核心观点

桌面里有很多重量级 App，不能首屏一次性加载，也不能让所有窗口持续消耗渲染资源。

### 页面内容

- `AppRenderer.tsx`
  - 使用 `next/dynamic`。
  - AI Chat、Browser、Mail、Document Editor、Spreadsheet 等独立 chunk。
  - 首屏只加载桌面 Shell。
- 主题系统：
  - `ThemeProvider.tsx` 从 `desktopStore` 读取主题。
  - 写入 `<html data-theme="light|dark">`。
  - CSS variables 控制全局颜色。
- 自定义强调色：
  - Settings 外观页写入 store。
  - 实时写 CSS 变量。
- 窗口虚拟化：
  - 屏幕外或完全遮挡窗口可降载。
  - 状态敏感 App 保守 keep-alive。
  - Browser、AI Chat、编辑器不轻易卸载。
- WebSocket 稳定性：
  - `useStream.ts` 支持指数退避重连。
  - 30 秒 heartbeat。
  - requestId 绑定回调。

---

## Slide 8. AI Chat 前端：发送前做了什么

### 页面标题

AI Chat 不是直接把输入丢给后端

### 核心观点

前端需要把历史消息整理成模型可理解的 tool calling 上下文，否则下一轮模型会丢失工具调用因果关系。

### 页面内容

- 用户输入变成 `user` message。
- UI 插入 streaming assistant message。
- 遍历历史消息：
  - 普通 assistant content 直接追加。
  - 已完成 tool call 恢复为 assistant `tool_calls`。
  - 追加对应 `tool` result。
  - 跳过正在 streaming 的 assistant。
  - 跳过子 Agent 内部 tool calls。
- 发送 payload：
  - conversationId
  - appId
  - model/provider
  - history
  - settings
  - enableMemory
  - activeAgent

---

## Slide 9. WebSocket 流式事件协议

### 页面标题

把 Agent 执行过程拆成可观察事件

### 核心观点

前端不是等一个最终答案，而是持续接收模型、工具、策略、子 Agent、确认和完成事件。

### 页面内容

| 事件 | 前端表现 | 技术意义 |
| --- | --- | --- |
| `status` | 状态行/执行阶段 | 暴露记忆召回、压缩、策略、校验 |
| `token` | 回答文本流 | 实时显示模型输出 |
| `reasoning_token` | 推理内容 | 展示 reasoning |
| `tool_call` | 工具卡片开始 | 告诉用户 Agent 要做什么 |
| `tool_result` | 工具卡片完成/失败 | 告诉用户工具结果 |
| `agent_confirm_required` | 确认弹窗 | Human-in-the-loop |
| `subagent_token` | 子 Agent 输出 | 展示并行子任务 |
| `subagent_result` | 子 Agent 结果 | 展示 EvidenceBundle/失败状态 |
| `agent_done` | 收尾 | 保存状态、完成 promise |

### 讲者提示

这里要强调“可观测性是产品能力，也是调试能力”。

---

## Slide 10. Skill Context：让 Agent 知道自己在哪个 App

### 页面标题

App-first 的关键：Skill Context

### 核心观点

同一个 Agent 在不同 App 中应该有不同的行为边界。Browser 里更关注网页操作，File Manager 里更关注文件，Notes 里更关注 Markdown 写作。

### 页面内容

- 关键代码：`apps/api/app/core/skill_context.py`。
- appId 来源：
  - 前端 payload 直接传入。
  - 或从 conversation 绑定的 app_id 读取。
- 注入内容：
  - 当前 App manifest。
  - 当前 App 的 `SKILL.md`。
  - 相关 Skills 摘要。
  - 用户自定义 Skills 摘要。
- 为什么不全量注入所有 Skill：
  - 上下文窗口有限。
  - 大多数 Skill 只需要发现信息。
  - 脚本型 Skill 首次调用再返回使用说明。
  - 知识型 Skill 通过 `load_skill_context` 按需加载。

---

## Slide 11. Agent Harness：核心执行循环

### 页面标题

Harness：让模型在边界内行动

### 核心观点

Harness 的作用不是让模型更聪明，而是让模型的行动更可控、更可观察、更可纠正。

### 页面内容

- 构建上下文：
  - system prompt
  - App Skill
  - Memory Recall
  - Handoff Context
  - 历史消息
- 构建工具列表：
  - 内置工具
  - 文件工具
  - Browser 工具
  - Knowledge 工具
  - MCP 工具
  - User Skill 工具
  - delegate_task
- LLM 决策：
  - 输出 token。
  - 或请求 tool call。
- 执行前：
  - ToolPolicyGuard。
  - Human-in-the-loop。
- 执行后：
  - ToolResultValidation。
  - FallbackPolicy。
  - 回灌模型继续 ReAct。
- 收尾：
  - 保存消息。
  - 记录指标。
  - 写候选记忆。

---

## Slide 12. ToolPolicyGuard 与结果校验

### 页面标题

工具调用前后各有一道闸

### 核心观点

模型可以选择工具，但 Harness 必须负责判断工具调用是否合规、结果是否可信。

### 页面内容

#### 调用前策略

- Skill 本地路径不能传给文件工具。
- 文件工具只能访问虚拟路径。
- calculator 只能处理纯数学表达式。
- Browser 等高风险工具按入口上下文限制。
- 重复同类查询会被阻止或跳过。
- 时间类参数按当前日期归一化。
- 工具调用前禁止先输出伪造结论。

#### 调用后校验

- 空结果。
- 工具异常。
- 缺少 API Key。
- Skill 脚本失败。
- 搜索无结果。
- Extract 部分失败。
- 策略拦截结果。

#### 校验失败后

- 不是直接报错结束。
- 而是把失败原因作为工具结果回灌模型。
- 模型继续走 ReAct 修正路径。

---

## Slide 13. Human-in-the-loop：关键操作让用户确认

### 页面标题

Human-in-the-loop：把风险操作交还给用户

### 核心观点

Agent 不是自动执行一切。遇到危险操作、写操作或需要人工判断的操作时，Harness 可以暂停并等待用户确认。

### 页面内容

- 后端确认机制：
  - `confirmation_store.py`
  - `CONFIRM_REQUIRED_TOOLS`
  - `tool_requires_confirmation()`
- WebSocket 事件：
  - 后端发送 `agent_confirm_required`。
  - 前端弹出确认对话框。
- REST 确认：
  - `POST /api/v1/agents/confirm?request_id=...&approved=true|false`
- 用户批准：
  - Future resolve。
  - 工具继续执行。
- 用户拒绝：
  - 工具不执行。
  - 模型收到“用户已拒绝该操作”。
  - Agent 可解释、降级或停止。

---

## Slide 14. Handoff Context、StateGraph 与 Checkpoint

### 页面标题

多 Agent 时代的上下文清理与状态记录

### 核心观点

多 Agent 并发会产生大量工具消息。如果不清理历史，Lead Agent 会误读子 Agent 的 tool calls。Handoff 和 Checkpoint 让上下文干净、状态可追踪。

### 页面内容

#### Handoff Context

- `agent_handoff.py`
- `normalize_active_agent()`
- `memory_user_id_for_agent()`
- `build_handoff_context()`
- 过滤内容：
  - 过期 tool calls。
  - 缺少 result 的 tool calls。
  - 子 Agent 内部 tool calls。
  - 孤立 tool messages。
- 保证：
  - assistant `tool_calls` 和 `tool` result 成对出现。
  - Lead Agent 只看到自己应该看到的上下文。

#### StateGraph / Checkpoint

- `agent_graph.py`
- 节点：
  - build_context
  - route
  - llm_decide
  - policy_guard
  - execute_tool
  - delegate
  - validate_result
  - evaluate
  - synthesize
  - respond
- `AsyncPostgresSaver` 可用则落 PostgreSQL。
- 初始化失败则回退 `InMemorySaver`。
- checkpoint 失败不能中断聊天主链路。

---

## Slide 15. 工具系统：从 function schema 到真实副作用

### 页面标题

模型看到 schema，系统负责副作用

### 核心观点

工具系统把不同来源的能力统一成 function calling schema，但真实执行仍由后端 Tool Runtime 管控。

### 页面内容

| 工具来源 | 代表能力 | 执行位置 |
| --- | --- | --- |
| 内置工具 | calculator、fetch_url、python_exec | API core/tools |
| 文件工具 | list/read/write/move/copy/delete | FileManager |
| Knowledge | retrieve_knowledge | KnowledgeManager |
| Browser | open/click/type/wheel/screenshot/extract | Browser Runtime |
| MCP | 外部 stdio / HTTP 工具 | MCPManager |
| User Skill | skill_{id} / load_skill_context | Skill runtime |
| Multi-Agent | delegate_task | Subagent runtime |

### 页面补充

- 工具返回统一成字符串，方便模型继续推理，也方便前端展示。
- User Skill 分两阶段：
  - 首次调用返回简化使用说明。
  - 模型按说明改写 query 后再次调用。
- MCP 工具需要别名和缓存，避免工具名冲突。

---

## Slide 16. 多 Agent：Lead Agent 如何并行委派

### 页面标题

多 Agent 不是多个聊天窗口

### 核心观点

当前多 Agent 是 manager pattern：Lead Agent 保留用户对话和最终回答权，Specialist Agent 作为工具处理边界清晰的子任务。

### 页面内容

- 工具入口：`delegate_task`。
- 角色：
  - `research`：搜索、资料收集、知识库查询。
  - `coder`：代码分析、实现方案、文件阅读。
  - `system`：环境、配置、文件系统、运行时排查。
  - `writer`：文档、总结、表达优化。
- 并发模型：
  - `asyncio.create_task`
  - `asyncio.Queue` 合并事件流
  - 最大并发 4 个
- 安全边界：
  - 子 Agent 独立上下文。
  - 子 Agent 独立 max_iterations。
  - 禁止递归委派。
  - 按角色裁剪工具面。

---

## Slide 17. EvidenceBundle 与多 Agent 2.0 指标

### 页面标题

子 Agent 的结果必须可验证

### 核心观点

Lead Agent 不能只相信子 Agent 的自然语言总结，必须优先消费结构化证据和预算状态。

### 页面内容

#### EvidenceBundle 包含

- `facts`
- `sources`
- `missingFields`
- `capabilitiesUsed`
- `toolEvidence`
- `mergedToolResults`
- `evidence_sufficient`
- `needs_more_tools`

#### 关键实现

- 搜索标题、摘要、链接、时间会被确定性提升为事实。
- 子 Agent 的自然语言 answer 只作为调试补充。
- Lead Agent 优先读 facts/sources。
- 工具预算耗尽时写成：
  - `maxToolCallsReached`
  - `stopReason`
- 不把“达到最大工具次数”混入 answer。

#### 指标

- delegationAccuracy
- subagentToolSuccessRate
- taskCompletionRate
- routeAccuracy
- delegatedRequests

---

## Slide 18. Memory：Markdown-first 长期记忆

### 页面标题

Memory 是用户长期上下文，不是知识库

### 核心观点

项目选择 Markdown-first 记忆体系，让长期记忆有可读源文件，而不是只存在向量库里。

### 页面内容

- 根目录：`AI_NATIVE_OS_HOME/memory`
- 主要文件：
  - `MEMORY.md`：长期记忆源文件。
  - `daily/YYYY-MM-DD.md`：每日候选和短期记录。
  - `DREAMS.md`：整理报告。
  - `.dreams/*`：整理状态、短期缓存、信号、备份、迁移、锁。
- 召回流程：
  - 对话前 `recall_context`。
  - 检索长期记忆和 recent daily。
  - 注入 Agent Prompt。
- 写入流程：
  - 回合结束后生成候选记忆。
  - 先写 daily。
  - 后续整理晋升到 MEMORY.md。

---

## Slide 19. Memory 整理：Light / REM / Deep

### 页面标题

记忆不是只追加，还需要整理和晋升

### 核心观点

Memory 系统模拟短期到长期的整理过程，避免 MEMORY.md 变成无序日志。

### 页面内容

- Light 整理：
  - 快速清理候选。
  - 去重。
  - 合并明显重复偏好。
- REM 整理：
  - 分析模式。
  - 提取稳定偏好、长期目标、工作习惯。
- Deep 整理：
  - 晋升长期记忆。
  - 写入 `MEMORY.md`。
  - 生成 `DREAMS.md` 报告。
- Backfill / Reindex：
  - 支持从历史对话回填。
  - 支持重新建立索引。
- Redaction：
  - 敏感信息处理。

---

## Slide 20. Knowledge Base：混合检索 RAG

### 页面标题

Knowledge Base 是文档和网页内容的 RAG

### 核心观点

Knowledge 负责用户上传/保存的资料，不负责用户偏好。它通过 chunk、embedding、向量检索和元数据管理服务 Agent。

### 页面内容

- 输入来源：
  - 上传 TXT / MD / PDF。
  - 粘贴文本。
  - Browser 当前网页保存。
- 入库流程：
  - 文本抽取。
  - Chunking。
  - Embedding。
  - Qdrant upsert。
  - PostgreSQL 保存文档和 chunk metadata。
  - MinIO 保存原始文件。
- 检索：
  - `retrieve_knowledge`。
  - Agent 可按问题检索相关 chunk。
  - 前端可展示来源和分数。
- 与 Memory 的区别：
  - Memory 是“用户是谁、偏好什么”。
  - Knowledge 是“用户提供的资料里有什么”。

---

## Slide 21. Browser Runtime：真实浏览器控制架构

### 页面标题

Browser 不是 iframe，而是真实 Chromium

### 核心观点

AI 和用户看到/操作的是同一个 headed Chromium。Playwright 控制、noVNC 画面、人工接管共享同一页面状态。

### 页面内容

- Runtime 目录：`infra/browser-runtime`
- 关键文件：
  - `Dockerfile`
  - `entrypoint.sh`
  - `server.py`
  - `embedded_vnc.html`
- 启动链：
  1. 清理旧 Xvfb lock/socket。
  2. 启动 Xvfb `:99`。
  3. 启动 x11vnc。
  4. 启动 websockify/noVNC。
  5. 启动 FastAPI runtime。
  6. runtime 启动 `async_playwright`。
  7. 创建 headed Chromium。
- 后端 API：
  - `BrowserSessionManager` 通过 HTTP 调 runtime。
  - 当前 API 后端不直接持有浏览器进程。

### 讲者提示

强调和旧计划区别：不是 API 后端 `connect_over_cdp`，而是 runtime 内部持有 Playwright。

---

## Slide 22. Browser 操作链路：AI 与用户共享页面状态

### 页面标题

AI 操作和人工接管为什么能无缝衔接

### 核心观点

AI、前端按钮和用户 noVNC 操作最终都落到同一个 Browser Session 和同一个 Chromium 页面。

### 页面内容

- Browser App 控制：
  - 地址栏导航。
  - 前进/后退/刷新。
  - 标签页切换。
  - Cookie/Profile/历史会话。
  - 保存页面到知识库。
- AI 工具控制：
  - browser_open。
  - browser_click。
  - browser_type。
  - browser_press。
  - browser_wait_for。
  - browser_extract_text。
  - browser_screenshot。
  - browser_request_human。
- 精细操作：
  - click-at。
  - mouse-down/move/up。
  - drag。
  - wheel。
  - type-text。
- 人工接管：
  - runtime status 切到 `awaiting_human`。
  - 前端 noVNC 从 viewOnly 切换为可操作。
  - 用户完成登录/验证码。
  - 点击继续 AI。
  - `resume_event.set()`，Agent 继续。

---

## Slide 23. Browser Persistence 与网页入库

### 页面标题

浏览器不仅能操作，还能保存状态和沉淀知识

### 核心观点

Browser 模块已经包含登录态、历史会话、Cookie 导入、storage state 和网页入库能力。

### 页面内容

#### Session History

- `BrowserSessionRecord`
- 保存：
  - session id
  - status
  - current_url / current_title
  - tab_count
  - action_log
  - takeover_reason
  - last_error
  - created/updated/closed time

#### Login Profile

- `BrowserLoginProfile`
- 保存某站点过滤后的 storage state。
- `filter_storage_state_for_site()` 只保留匹配 host 的 cookies/origins。
- 可以保存、列表、删除、应用到当前 session。

#### Cookie / Storage State

- `/storage-state`
- `/cookies`
- 支持 Cookie header 和 Cookie JSON。

#### 保存网页到知识库

- Browser App 调 `/extract`。
- 确保 Knowledge 初始化。
- 调 `/save-page`。
- 页面标题、URL、正文进入 KnowledgeManager。
- 后续通过 `retrieve_knowledge` 检索。

---

## Slide 24. Terminal：终端风格控制台

### 页面标题

Terminal 是受控系统 App，不是真 shell

### 核心观点

Terminal 提供熟悉的命令行体验，但不会把用户输入直接传给后端系统 shell。

### 页面内容

- 前端状态：
  - history
  - cwd
  - output lines
  - command mode
  - tool logs
- 内置命令：
  - `pwd`
  - `ls`
  - `cd`
  - `cat`
  - `mkdir`
  - `touch`
  - `rm`
  - `cp`
  - `mv`
  - `write`
  - `clear`
- 文件命令执行：
  - 前端解析。
  - 虚拟路径转换。
  - 调 Files API。
- AI 命令模式：
  - `appId=terminal`
  - `conversationId` 为空，不走普通会话标题管理。
  - `enableMemory=false`
  - system prompt 要求终端风格、简洁、纯文本。
- 安全边界：
  - 不暴露真实 Bash/CMD。
  - 真实代码执行走受控 `python_exec`。
  - 工具仍受 Harness 约束。

---

## Slide 25. 文件系统与 Office Suite

### 页面标题

围绕本地文件构建的 AI 工作流

### 核心观点

文件系统和 Office Suite 让 AI 能进入真实办公流：读文件、写笔记、改文档、处理表格、邮件和日程。

### 页面内容

#### File Manager

- 双面板：目录树 + 内容区。
- 图标/列表视图。
- 上传/下载/删除/移动/复制。
- 文本读写。
- 图片/PDF/音频/视频/表格预览。
- 不同类型文件打开到对应 App。

#### Notes

- Markdown 编辑和预览。
- AI 辅助润色、扩写、总结。
- 保存到 `/Notes/*.md`。

#### Document Editor

- TipTap 富文本。
- AI 改写、翻译、扩写、调整语气、续写。
- 导出 Markdown、PDF、DOCX。

#### Spreadsheet Editor

- Univer Sheets。
- 支持 xlsx / xls / xlsm / ods / csv。

#### Calendar / Mail / Whiteboard

- Calendar：事件 CRUD、AI 日程生成。
- Mail：IMAP/SMTP、同步、草稿、附件、AI 摘要/回复。
- Whiteboard：节点、连线、本地白板文件、AI 生成结构图。

---

## Slide 26. MCP、Skill 与 Extension Center

### 页面标题

扩展系统：让工具能力可插拔

### 核心观点

项目用 App Manifest、SKILL.md、MCP Server 和 User Skills 共同构成扩展体系。

### 页面内容

| 概念 | 给谁用 | 存在哪里 | 职责 |
| --- | --- | --- | --- |
| App Manifest | 系统/前端 | apps_registry 或 mcp.json | 描述 App、权限、工具、MCP transport |
| SKILL.md | Agent | App 目录或用户 Skill 目录 | 描述何时使用、如何使用、行为边界 |
| MCP Server | Tool Runtime | 本地 stdio 或远程 HTTP | 暴露标准化工具 |
| User Skill | 用户扩展 | AI_NATIVE_OS_HOME | 脚本型或知识型技能 |

### 生命周期

- Settings 中添加/编辑/启停 MCP。
- AppRegistry 解析 manifest。
- MCPManager 启动 stdio 或 HTTP session。
- 工具 schema 注册到 Agent 工具候选集。
- Agent 根据 tool description 自主选择工具。
- ToolPolicyGuard 做边界约束。

---

## Slide 27. Settings、Avatar 与外部渠道

### 页面标题

控制面、陪伴层和外部入口

### 核心观点

Settings 管系统配置；Avatar 承载桌面陪伴体验；External Channels 让同一套 Agent 能力进入 QQ Bot 等外部入口。

### 页面内容

#### Settings

- API Keys。
- Provider / Base URL / 模型列表。
- Embedding 配置。
- Memory 管理。
- Knowledge Base 管理。
- Channels。
- Extensions。
- Skills。
- Theme。
- Avatar。
- About：数据归属说明、配置导入导出。

#### Avatar

- Live2D 模型。
- zip 上传和资源服务。
- 位置、大小、可见性。
- 情绪解析。
- 人格预设。

#### Channels

- QQ Bot 配置。
- 状态查询。
- 重启。
- 消息适配。
- 复用 `AgentTurnRunner`。

### 边界提醒

- SOUL.md 属于早期设计/未来方向。
- 当前落地的是 Settings/Avatar/persona 配置、system prompt、Skill Context、Memory Recall 的组合。

---

## Slide 28. 数据所有权与存储矩阵

### 页面标题

Local-first：用户拥有 Key 和数据

### 核心观点

项目的配置、记忆、技能、MCP 和文件尽量本地优先；后端服务负责组织和索引，而不是替用户代持一切。

### 页面内容

| 数据 | 存储位置 | 说明 |
| --- | --- | --- |
| API Key / Provider | 前端 localStorage / 配置导出 | 用户自带 Key |
| Desktop layout | PostgreSQL + frontend store | 桌面布局 |
| Conversations / Messages | PostgreSQL | 对话和工具消息 |
| Markdown Memory | `AI_NATIVE_OS_HOME/memory` | 源文件可读 |
| User Skills | `AI_NATIVE_OS_HOME` | 本地技能 |
| MCP config | `AI_NATIVE_OS_HOME/mcp.json` | 本地扩展配置 |
| Knowledge metadata | PostgreSQL | 文档和 chunk 元数据 |
| Knowledge vectors | Qdrant | 向量检索 |
| Raw documents | MinIO | 对象存储 |
| Browser sessions/profiles | PostgreSQL + runtime storage | 会话历史和登录态 |
| User files | Host file mapping | 本地文件系统 |

---

## Slide 29. 部署与运行时服务

### 页面标题

Docker Compose 下的服务协同

### 核心观点

项目虽然是 monorepo，但运行时由 Web、API、Browser Runtime、数据库、向量库和对象存储协同完成。

### 页面内容

| 服务 | 默认端口 | 职责 |
| --- | --- | --- |
| Web | 13000 | Next.js 前端 |
| API | 18000 | FastAPI REST/WebSocket |
| Browser Runtime API | 18100 | Browser Session runtime |
| Browser Runtime noVNC | 16080 | 实时浏览器画面 |
| PostgreSQL | 15432 | 业务数据、checkpoint |
| Redis | 16379 | 运行时辅助 |
| MinIO | 19000 / 19001 | 原始文档对象存储 |
| Qdrant | 16333 / 16334 | 向量检索 |

### 关键环境变量

- `DATABASE_URL`
- `REDIS_URL`
- `MINIO_ENDPOINT`
- `AI_NATIVE_OS_HOME`
- `NEXT_PUBLIC_API_BASE`
- `BROWSER_RUNTIME_URL`
- `BROWSER_SESSION_ENABLED`

---

## Slide 30. 可观测性、Trace 与 Eval

### 页面标题

Agent 过程既给用户看，也给研发分析

### 核心观点

系统不仅展示最终答案，还保留工具调用、策略、校验、checkpoint、traffic metrics 和 eval 数据。

### 页面内容

#### 前端可观察

- token。
- reasoning token。
- status。
- tool_call。
- tool_result。
- workflow_plan。
- workflow_summary。
- subagent_token。
- subagent_result。
- usage_estimate。
- confirmation dialog。

#### 后端可观察

- Agent traffic metrics。
- Tool policy events。
- Tool validation events。
- Browser action_log。
- MCP health。
- Knowledge job status。
- Memory dreaming status。
- Phoenix / LangSmith trace。

#### 指标闭环

- `AgentTrafficRecord`
- routeAccuracy。
- delegatedRequests。
- completion。
- delegationAccuracy。
- subagentToolSuccessRate。
- taskCompletionRate。

---

## Slide 31. 一条复杂任务如何跑完

### 页面标题

把 Browser、Knowledge、Memory、Files 和 Harness 串起来

### 示例任务

帮我打开浏览器搜索某个技术主题，把网页保存到知识库，再结合我的记忆总结成一份笔记。

### 实际链路

1. 用户从 AI Chat 发起任务。
2. WebSocket 构建上下文。
3. Skill Context 识别当前入口。
4. Memory Recall 召回用户偏好。
5. Agent Harness 规划执行。
6. 调 Browser 工具创建/打开 Session。
7. Browser Runtime 导航、搜索、抽取页面。
8. 保存网页到 Knowledge Base。
9. Knowledge 进行 chunk、embedding、upsert。
10. Agent 调 `retrieve_knowledge` 检索。
11. Agent 结合 Memory 和网页内容生成笔记。
12. File/Notes 工具保存到本地文件。
13. 前端展示 workflow_summary 和工具时间线。

---

## Slide 32. 总结：这套架构的核心取舍

### 页面标题

AI Native OS 的五个关键取舍

### 核心观点

项目的核心不是堆功能，而是把模型、上下文、工具和运行时组织成一个可控、可观察、可扩展的系统。

### 页面内容

1. App-first，而不是 Chat-first
   - 让 Agent 理解当前工作流，而不是只理解聊天历史。

2. Harness-first，而不是直接裸调模型
   - 工具策略、结果校验、HITL、fallback、checkpoint 缺一不可。

3. Markdown Memory，而不是纯向量库 Memory
   - 长期记忆需要可读、可迁移、可审计的源文件。

4. Browser Runtime 独立进程
   - 真实浏览器、实时视图、人工接管、登录态都需要独立运行时。

5. MCP/Skill 双扩展
   - 系统能力不写死，用户和外部工具可以持续接入。

### 结尾金句

AI Native OS 的价值不是让模型说得更多，而是让模型在系统里更可靠地行动。

---

## 附录 A. 这份大纲的使用方式

### 给 PPT 生成 AI 的直接提示词

```text
请根据本文生成一份中文技术分享 PPT。

要求：
1. 按 Slide 1 到 Slide 32 生成。
2. 每页保留本文给出的标题、核心观点和主要内容。
3. 每页不要塞满长段文字，要将要点提炼成适合 PPT 展示的短句。
4. 这是研发团队技术分享，不是产品营销材料。
5. 必须讲清实现原理：前端如何驱动 Agent、后端如何编排、Harness 如何管控、Browser 如何控制真实 Chromium、Memory/Knowledge/MCP/Terminal/多 Agent 如何落地。
6. 必须保留边界提醒：Browser 不是 iframe；Terminal 不是真 shell；SOUL.md 不是当前完整落地模块；Memory 不等于 Knowledge。
```

### 可压缩到 24 页的方式

- 合并 Slide 6 + 7：Web Desktop 与前端工程化。
- 合并 Slide 8 + 9：AI Chat 与 WebSocket。
- 合并 Slide 12 + 13：ToolPolicyGuard 与 HITL。
- 合并 Slide 16 + 17：多 Agent 与 EvidenceBundle。
- 合并 Slide 18 + 19：Memory 设计与整理。
- 合并 Slide 21 + 22 + 23：Browser Runtime、操作链路、Persistence。
- 合并 Slide 25 + 27：Office Suite、Settings、Avatar、Channels。
- 保留 Slide 3、5、11、14、20、26、30、31、32，不能删。


