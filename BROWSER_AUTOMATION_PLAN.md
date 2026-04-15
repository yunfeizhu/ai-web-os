# AI 浏览器（Browser App）— 完整实现方案

## 分阶段规划概览

### 一阶段 — 最小可用闭环（当前详细规划）

目标：让 AI 能操作浏览器，让用户能在 Browser App 里实时看到画面并人工接管。

- 会话创建与销毁（Docker 容器生命周期）
- URL 打开与跳转、点击、输入、按键
- 文本提取、页面状态查询
- noVNC 实时视口（AI 与人共享同一个 Chromium）
- 人工接管状态切换（验证码、登录确认等场景）
- 动作日志

**不包含**：多标签页 UI、文件上传/下载、登录态持久化、复杂拖拽、视觉定位、WS 代理认证、数据库持久化

---

### 二阶段 — 提升人机混合使用体验

目标：让人工接管更顺滑，让 AI 对页面的感知更丰富。

- **`browser_screenshot` 工具**：AI 能主动截图并在 Chat 里展示（需要多模态模型支持），用于让 AI "看懂"复杂页面
- **用户主动接管按钮**：不等 AI 请求，用户随时点"接管"进入 human_control 状态
- **更丰富的 `browser_get_state`**：返回可交互元素的语义列表（按钮、链接、输入框），减少 AI 选择器幻觉
- **会话状态持久化（DB 表）**：后端重启后能看到历史会话记录（Page 需重建，但元数据保留）
- **noVNC 代理层**：把 VNC WS 地址从前端直连改为 FastAPI 代理，支持认证 token，为未来多用户/远程部署做准备
- **更好的错误提示**：selector 匹配失败时返回当前页面可用的候选元素，帮助 AI 自我修正
- **滚动支持**：`browser_scroll` 工具，AI 可以滚动到页面指定位置

---

### 三阶段 — 增强自动化能力与复杂任务稳定性

目标：覆盖更多真实自动化场景，支持任务录制与回放。

- **多标签页管理**：`browser_new_tab`、`browser_switch_tab`、`browser_list_tabs`，AI 可以跨多个标签页协同操作
- **文件上传/下载桥接**：`browser_upload_file`（从虚拟文件系统传给页面）、`browser_wait_for_download`（捕获下载到虚拟文件系统）
- **登录态存储策略**：允许会话保存 `user_data_dir` 到持久化存储，下次同域名任务复用 Cookie/localStorage
- **视觉定位**：`browser_click_at_image`，用截图 + 多模态模型定位无法用 selector 选中的元素（图形验证码分析辅助等）
- **任务录制与回放**：把 AI 执行的动作序列保存为可重放的脚本，用于定时任务或批量操作
- **容器预热池**：预启动 N 个空闲容器，消除首次创建会话的冷启动延迟
- **WebRTC live view**（可选）：用 selkies-gstreamer 替换 noVNC，帧率更高、延迟更低，更接近远程桌面体验

---

## Context

`browser` App 当前在 `apps/web/src/apps/AppRenderer.tsx:27-28` 是一个 PlaceholderApp。目标是把它做成"AI 与人共享一个真实浏览器会话"的窗口：

- AI 在 `terminal` 与 `ai-chat` 里通过工具调用驱动浏览器（导航、点击、输入、提取、等待）
- 用户在 Browser App 窗口里看到这个浏览器的实时画面，并可以随时人工接管处理验证码、登录、支付等场景
- 完成后用户点"继续 AI"，AI 从当前页面继续执行

技术路线已经在前置讨论里确定：**Docker 容器内跑 Xvfb + headed Chromium + x11vnc + websockify + noVNC，后端通过 Playwright `connect_over_cdp` 控制同一个 Chromium，前端 `@novnc/novnc` 直接连容器发布到主机的 VNC WebSocket 端口**。AI 与人操作的是同一个 Chromium 实例，状态天然一致。

为什么不用更简单的截图轮询：人工处理验证码、IME 输入、拖拽这类场景体验断崖式下降；二阶段再升级到 noVNC 时视口、事件转发、WS 通道几乎要重写，而第一阶段就把视口层做对，后续加 `browser_click` 之类的工具几乎是零额外成本。

为什么不用 iframe：跨域 `X-Frame-Options` / CSP 拦截大多数主流网站，且 iframe 的 DOM 不可被父窗口操作，会出现"前端 iframe 看到的页面"和"后端 Playwright 看到的页面"两套 state 不一致的根本问题。

---

## 架构总览

```
┌───────────────────────── Windows 11 Host ──────────────────────────┐
│                                                                    │
│  ┌─ apps/web (Next.js) ──────────────────────┐                     │
│  │  Browser App                              │                     │
│  │   ├── Toolbar (URL, status, Resume btn)   │  REST polling       │
│  │   ├── VncViewport (@novnc/novnc RFB) ─────┼─► ws://localhost:   │
│  │   ├── ActionLog                           │      <vnc_port>/    │
│  │   └── TakeoverBanner                      │      websockify     │
│  └─────────────┬─────────────────────────────┘                     │
│                │ apiFetch /api/v1/browser/...                      │
│  ┌─────────────▼─────────────────────────────┐                     │
│  │ apps/api (FastAPI)                        │                     │
│  │   ├── api/v1/browser.py  (REST router)    │                     │
│  │   ├── core/browser_session.py             │                     │
│  │   │     BrowserSessionManager (singleton) │                     │
│  │   │     - playwright (1 global instance)  │                     │
│  │   │     - sessions: dict[id, Session]     │                     │
│  │   │     - docker SDK orchestration        │                     │
│  │   └── core/browser_tools.py               │                     │
│  │         BROWSER_TOOL_SCHEMAS + handlers   │                     │
│  │         dispatch_browser_tool(name, args) │                     │
│  └─────────────┬─────────────────────────────┘                     │
│                │ Playwright connect_over_cdp                       │
│                │ http://localhost:<cdp_port>/json/version          │
│                ▼                                                   │
│  ┌─ Docker Desktop (1 container per session) ───────────────────┐  │
│  │  ai-native-os/browser-session:0.1                            │  │
│  │   ├── Xvfb :99 (1280x800)                                    │  │
│  │   ├── chromium --remote-debugging-port=9222 (CDP)            │  │
│  │   ├── x11vnc -display :99 -rfbport 5900                      │  │
│  │   └── websockify 6080 --web=/usr/share/novnc localhost:5900  │  │
│  │  Published: 9222→<cdp_port>, 6080→<vnc_port>  (ephemeral)    │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

**关键设计**：AI 用 Playwright 通过 CDP 操作 Chromium，人用 noVNC 通过 VNC 协议操作**同一块 Xvfb 显示器上的同一个 Chromium**。两边天然共享 state，无需任何同步逻辑。`browser_request_human` 只是工具内部 `await asyncio.Event.wait()`，前端按钮 `event.set()` 就能让 SSE 生成器自然恢复。

---

## 已确认的设计决策

| 项                                       | 决策                                                                                                                                                                                                                            | 理由                                                                                              |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 容器镜像                                 | 自建 slim Dockerfile（debian-bookworm + chromium + xvfb + x11vnc + websockify + novnc）                                                                                                                                         | `kasmweb/chromium`、`linuxserver/chromium` 不暴露 CDP 端口，再加工比自写 ~50 行 Dockerfile 还麻烦 |
| 容器编排                                 | `docker` Python SDK，`run_in_executor` 包同步调用                                                                                                                                                                               | 子进程调 `docker run` 在 Windows 上引号/退出码处理脆弱                                            |
| 端口分配                                 | `ports={"9222/tcp": None, "6080/tcp": None}` 让 Docker 选 ephemeral，`container.reload()` 后读出                                                                                                                                | 避免端口池冲突管理                                                                                |
| Playwright 实例                          | 全进程一个 `async_playwright().start()`，每个 session 一次 `chromium.connect_over_cdp()`                                                                                                                                        | Playwright 支持多 Browser per process                                                             |
| noVNC 连接                               | 前端**直连**主机已发布的 VNC 端口，不走 FastAPI 代理                                                                                                                                                                            | 本地开发场景无需代理；远程部署时再加，文档里要写明                                                |
| 会话生命周期                             | AI 显式 `browser_create_session`；纯内存；空闲 TTL 900s 后回收（`awaiting_human` 状态豁免回收）；FastAPI shutdown 全部清理；启动时按 label 清理上次崩溃残留容器                                                                 | 与 BROWSER_AUTOMATION_PLAN.md 一致；持久化等二阶段                                                |
| 多会话                                   | 每个 session 一个独立容器；`browser_max_sessions` 上限 4                                                                                                                                                                        | 容器是天然的隔离边界                                                                              |
| 多标签                                   | Chromium 开新 tab 时 `BrowserSession.page` 自动切到最新 page（监听 `context.on("page", ...)`）                                                                                                                                  | 一阶段最简策略                                                                                    |
| 会话与窗口的关系                         | 多对多。Browser App 窗口顶部一个 session 下拉框；`appState.activeSessionId` 持久化"这个窗口当前在看哪个 session"                                                                                                                | 灵活，且不强迫用户每次打开窗口都创建新 session                                                    |
| Browser App 启动行为                     | 不自动创建 session。无 session 时显示空状态 + "新建会话"按钮；首次创建走 REST `POST /sessions`                                                                                                                                  | 避免空跑容器浪费资源                                                                              |
| 选择器策略                               | `_browser_click` / `_browser_type` 接受 `selector` 参数，前缀约定：`text=...` → `page.get_by_text`；`role=button[name="..."]` → `page.get_by_role`；其它当 CSS。AI 选择器幻觉是最大的失败原因，semantic locator 显著更稳        | 多花 20 行代码，但收益巨大                                                                        |
| `browser_get_state` 返回                 | JSON 序列化字符串（包含 url、title、可见 headings、表单字段名清单）                                                                                                                                                             | 模型可解析                                                                                        |
| `browser_request_human` 在 Chat 里的渲染 | 复用现有 `ToolCallDisplay`：tool_call 事件先发出 → 卡片显示"运行中"spinner → asyncio.Event 一被 set，tool_result 才发出 → 卡片切到完成。**不需要改 agent_loop 或 SSE 协议**。只在 `ToolCallDisplay.tsx` 的 `TOOL_META` 加新条目 | 复用现有基础设施                                                                                  |

### 一阶段不做

- `browser_screenshot` 工具（Chat 里的多模态截图传递）
- 用户主动接管按钮（不等 AI 请求）
- 文件上传/下载桥接
- WS proxy，认证
- 多 Browser 窗口共享同一个 RFB 实例
- 容器预热池
- 数据库持久化

---

## 工具列表（一阶段）

每个 handler 在 `apps/api/app/core/browser_tools.py`，签名都是 `async def(...) -> str`，结果用人类可读字符串返回（异常作为字符串而非 raise，便于 AI 看到）。每次调用都 `_log_action(session, type, args, result, duration_ms)` 追加到 `session.action_log`（环形缓冲，保留最近 200 条）。

| 工具名                   | 主要参数                                     | 行为                                                                                           |
| ------------------------ | -------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `browser_create_session` | `owner_conversation_id?`                     | 启动容器、连 CDP、返回 `session_id` 与 `vnc_ws_url`                                            |
| `browser_open`           | `session_id, url`                            | `page.goto(url)`，等 `domcontentloaded`                                                        |
| `browser_click`          | `session_id, selector`                       | 解析前缀，调用合适的 locator，5s 超时                                                          |
| `browser_type`           | `session_id, selector, text, press_enter?`   | locator → `fill` → 可选 `Enter`                                                                |
| `browser_press`          | `session_id, key`                            | `page.keyboard.press(key)`                                                                     |
| `browser_wait_for`       | `session_id, selector?, state?, timeout_ms?` | 等待元素或 load state                                                                          |
| `browser_extract_text`   | `session_id, selector?, max_chars?`          | `inner_text` 截断；不传 selector 则提取 main content                                           |
| `browser_get_state`      | `session_id`                                 | 返回 JSON-string：url, title, headings[], inputs[]                                             |
| `browser_request_human`  | `session_id, reason`                         | 切 `awaiting_human`、`takeover_event.clear()`、`await wait_for(event, 600s)`、恢复后切 `ready` |
| `browser_close_session`  | `session_id`                                 | `browser.close()` → 容器 `stop+remove`                                                         |

`browser_resume_ai` 工具不做（一阶段只通过 REST 按钮恢复；这避免 AI 自己把自己 unblock 的怪异状态）。

---

## REST API（一阶段）

文件：`apps/api/app/api/v1/browser.py`，挂载到 `/api/v1/browser`。

| 方法     | 路径                    | 用途                                                                               |
| -------- | ----------------------- | ---------------------------------------------------------------------------------- |
| `GET`    | `/sessions`             | 列出活跃会话摘要：`id, status, current_url, current_title, vnc_ws_url, created_at` |
| `GET`    | `/sessions/{id}`        | 全量 state：包含 `action_log, takeover_reason, last_error`                         |
| `POST`   | `/sessions`             | 手动创建（Browser App "新建会话" 按钮用）                                          |
| `DELETE` | `/sessions/{id}`        | 关闭并销毁                                                                         |
| `POST`   | `/sessions/{id}/resume` | 用户点"继续 AI"按钮，内部 `manager.resume(id)` → `event.set()`，幂等               |

前端通过 REST 轮询：列表 1s 一次，活跃 session 详情 500ms 一次。**不**新增 WS 通道，避免改 `useStream.ts` 的单例 WsManager。

---

## 文件清单

### Backend — 新建

- `infra/browser-container/Dockerfile` — slim debian + chromium + xvfb + x11vnc + websockify + novnc
- `infra/browser-container/entrypoint.sh` — 顺序启动 Xvfb、x11vnc、websockify、chromium，`wait -n` 让任一子进程死亡时整个容器退出
- `infra/browser-container/README.md` — 构建/运行命令与排错
- `apps/api/app/core/browser_session.py` — `BrowserSession` dataclass、`ActionLogEntry`、`BrowserSessionManager` 单例
- `apps/api/app/core/browser_tools.py` — `BROWSER_TOOL_SCHEMAS` 列表、`dispatch_browser_tool(name, args)`、所有 `_browser_*` handler
- `apps/api/app/api/v1/browser.py` — FastAPI router

### Backend — 修改

- `apps/api/pyproject.toml` — 新增 `playwright>=1.47,<1.50`、`docker>=7.1`
- `apps/api/app/main.py` — import 并 `include_router(browser_router.router, prefix="/api/v1/browser", tags=["browser"])`；`lifespan` 里 `await BrowserSessionManager.instance().startup()`，`finally` 里 `await BrowserSessionManager.instance().shutdown()`
- `apps/api/app/core/tools.py:16` — `from app.core.browser_tools import BROWSER_TOOL_SCHEMAS; TOOL_SCHEMAS += BROWSER_TOOL_SCHEMAS`
- `apps/api/app/core/tools.py:300` `execute_tool` — 加一个分支 `if name.startswith("browser_"): return await dispatch_browser_tool(name, args)`
- `apps/api/app/config.py` — 新增 `browser_image: str = "ai-native-os/browser-session:0.1"`、`browser_idle_ttl_sec: int = 900`、`browser_max_sessions: int = 4`、`browser_takeover_timeout_sec: int = 600`

### Frontend — 新建

- `apps/web/src/apps/browser/Browser.tsx` — 主壳：Toolbar + VncViewport + ActionLog + TakeoverBanner
- `apps/web/src/apps/browser/Toolbar.tsx` — 状态徽标、URL、session 下拉、"新建会话"/"继续 AI"/"关闭会话"按钮
- `apps/web/src/apps/browser/VncViewport.tsx` — 持有 `RFB` ref，`useEffect` 中 `connect/disconnect`，根据 `status === "awaiting_human"` 切换 `viewOnly`
- `apps/web/src/apps/browser/ActionLog.tsx` — 滚动列表，复用 `ToolCallDisplay` 的视觉 token
- `apps/web/src/apps/browser/TakeoverBanner.tsx` — `awaiting_human` 时的覆盖横幅，显示 `takeover_reason`
- `apps/web/src/apps/browser/useBrowserSession.ts` — 包装 REST 调用 + 轮询 + `appState.activeSessionId` 同步
- `apps/web/src/apps/browser/types.ts` — 镜像后端模型
- `apps/web/src/types/novnc.d.ts`（按需）— 如果 `@novnc/novnc` 自带的类型不全就补声明

### Frontend — 修改

- `apps/web/package.json` — 新增 `"@novnc/novnc": "^1.5.0"`
- `apps/web/src/apps/AppRenderer.tsx:27-28` — 把 PlaceholderApp 那一支换成 `<Browser appState={appState} windowId={windowId} />`，import `Browser` from `@/apps/browser/Browser`
- `apps/web/src/apps/ai-chat/ToolCallDisplay.tsx:7` — `TOOL_META` 加新条目：`browser_create_session/open/click/type/press/wait_for/extract_text/get_state/request_human/close_session`，每个用 `Globe`/`MousePointer`/`Keyboard`/`Hourglass` 之类的 lucide icon。`getArgsSummary` 也加对应分支提取 `url` / `selector`

---

## 关键代码点 / 复用

- 工具注册沿用 `apps/api/app/core/tools.py:16` 的 `TOOL_SCHEMAS` + `apps/api/app/core/tools.py:300` `execute_tool` 模式
- `apps/api/app/core/llm_provider.py:185-218` `agent_loop` 已经正确做到"先 yield tool_call 再 await execute_tool 再 yield tool_result"，所以 `browser_request_human` 阻塞期间，`ToolCallDisplay` 卡片会自然停留在 spinner 状态，**无需任何 SSE 协议改动**
- `apps/web/src/apps/ai-chat/ToolCallDisplay.tsx:43-150` 的 `ToolCallItem` 组件直接接收 `status === "running"` 就显示 spinner，所以人工接管在 Chat 端的视觉表现已经免费
- 前端 REST 调用复用 `apps/web/src/lib/backend.ts` 的 `apiFetch<T>(path, init)`
- Window 状态持久化复用 `useWindowStore.updateAppState(windowId, { activeSessionId })`
- FastAPI lifespan 钩子位置：`apps/api/app/main.py:19-29`
- 沙箱根目录常量（如果未来需要存截图）：`apps/api/app/core/file_manager.py` 的 `FS_ROOT`

---

## Dockerfile 与 entrypoint 草案

`infra/browser-container/Dockerfile`：

```dockerfile
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium chromium-sandbox xvfb x11vnc websockify novnc \
    fonts-liberation fonts-noto-cjk ca-certificates dumb-init procps \
  && rm -rf /var/lib/apt/lists/*
ENV DISPLAY=:99 \
    SCREEN_GEOMETRY=1280x800x24
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh
EXPOSE 9222 6080
ENTRYPOINT ["/usr/bin/dumb-init","--","/usr/local/bin/entrypoint.sh"]
```

`infra/browser-container/entrypoint.sh`：

```bash
#!/bin/bash
set -e
Xvfb :99 -screen 0 ${SCREEN_GEOMETRY} -ac +extension RANDR &
sleep 0.3
x11vnc -display :99 -forever -shared -rfbport 5900 -nopw -quiet &
websockify --web=/usr/share/novnc 6080 localhost:5900 &
chromium \
  --no-sandbox \
  --disable-dev-shm-usage \
  --disable-gpu \
  --remote-debugging-port=9222 \
  --remote-debugging-address=0.0.0.0 \
  --user-data-dir=/tmp/cdata \
  --window-size=1280,800 \
  --start-maximized \
  --disable-features=TranslateUI \
  about:blank &
wait -n
```

容器启动参数（Python 侧）：

```python
client.containers.run(
    settings.browser_image,
    detach=True,
    auto_remove=False,
    shm_size="1g",          # 关键：默认 64MB 会让 Chromium 崩
    mem_limit="1g",
    ports={"9222/tcp": None, "6080/tcp": None},
    labels={"ai-native-os": "browser-session", "session_id": sid},
    name=f"ains-browser-{sid[:8]}",
)
```

---

## 已知风险 / 注意事项

1. **Chromium `--no-sandbox` 在容器里是必需的**，因为容器没有 user namespace。这意味着页面 JS 少了一层隔离，工具描述里要建议 AI 不要打开未知不可信链接。
2. **`shm_size="1g"` 必须设**，否则 Chromium 在中等复杂页面会崩。
3. **僵尸容器**：靠 startup-reconcile（按 label 列出并清理）+ FastAPI shutdown 主动清理两层兜底。
4. **Windows Docker Desktop 端口释放延迟**：偶发 `bind: An attempt was made to access a socket in a way forbidden`，重试一次即可；用 ephemeral port 不复用号能进一步降低概率。
5. **冷启动 ~3-5s**：一阶段不预热，在 Browser App 显示 "正在创建浏览器会话..." 即可。
6. **CDP 必须 bind `0.0.0.0`**（容器内），但主机端口要 publish 到 `127.0.0.1:<ephemeral>`，**不能** bind `0.0.0.0`，避免外网暴露。
7. **CancelledError 处理**：`browser_request_human` 在 SSE 客户端断开时会被 cancel，要在 `finally` 里**不**重置状态（让用户仍能在 UI 上 resume/close），但 log 一条 "chat stream disconnected while awaiting human"。
8. **`@novnc/novnc` 的 `RFB` 在 DOM 元素 `display: none` 时会停止解码**。窗口管理器如果用 `display: none` 隐藏非活跃窗口，要么改用 `visibility: hidden` / `transform`，要么在 VncViewport 里监听可见性事件触发 `rfb.focus()` 或重连。**实施时要先验证现有 `WindowFrame` 用什么方式隐藏窗口。**
9. **selector 容错**：handler 内部 try/except，CSS 选择器解析失败时自动回退到 `get_by_text(selector)`；前缀显式声明的 `text=` / `role=` 优先。
10. **多 tab**：监听 `context.on("page", new_page)`，把 `session.page` 切到最新 page。
11. **超时与 SSE**：`browser_request_human` 默认 600s 超时，比常见的 corporate proxy 60s 大很多。一阶段只在本地 uvicorn 跑，没问题；如果未来上 nginx 反代，需要 `proxy_read_timeout 900s;`。
12. **Playwright + Debian Chromium 版本兼容**：Playwright 1.47.x 已验证可与 bookworm 的 Chromium 121+ 通过 CDP 通信；Dockerfile README 里写明测试过的 Chromium major 版本。

---

## 验证步骤

实施完成后按顺序跑：

### 1. 镜像构建

```
docker build -t ai-native-os/browser-session:0.1 infra/browser-container
```

### 2. 容器烟测（脱离后端独立验证）

```
docker run --rm -p 9222:9222 -p 6080:6080 --shm-size=1g ai-native-os/browser-session:0.1
```

- 浏览器打开 `http://localhost:9222/json/version` → 应返回包含 `webSocketDebuggerUrl` 的 JSON
- 浏览器打开 `http://localhost:6080/vnc.html?autoconnect=1&host=localhost&port=6080` → 应看到一个 about:blank 的 Chromium 桌面
- Ctrl+C 杀容器

### 3. 后端烟测

- 进 `apps/api`：`uv run uvicorn app.main:app --reload`
- `curl -X POST http://localhost:8000/api/v1/browser/sessions` → 5s 内返回 `{id, status: "ready", vnc_ws_url, ...}`
- `curl http://localhost:8000/api/v1/browser/sessions/<id>` → status ready, current_url about:blank
- `docker ps --filter label=ai-native-os=browser-session` → 一个容器在跑
- Ctrl+C uvicorn → 3s 内容器被自动 remove
- 手动 `docker run` 再启 uvicorn → 启动 log 应出现 "Reaped N stale browser containers"，`docker ps` 干净

### 4. 端到端 AI 流程（golden path）

- `apps/web` 跑 `npm run dev`
- 桌面打开 Browser App → 看到 "暂无活跃会话，新建会话" 空状态
- 打开 AI Chat App，输入：_"用浏览器工具打开 google.com，搜索 cats，告诉我第一条结果的标题"_
- 观察 Chat：依次出现 `browser_create_session` → `browser_open` → `browser_type` → `browser_press` → `browser_wait_for` → `browser_extract_text` 几张 ToolCallDisplay 卡片
- 切到 Browser App 窗口：可以看到刚创建的 session 出现在下拉，点选后 noVNC 视口实时显示页面跳转、输入、搜索结果出现的整个过程
- AI 最终消息里给出第一条结果的标题

### 5. 人工接管流程

- 在 Chat 里：_"打开 https://github.com/login，然后让我自己登录"_
- AI 调用 `browser_open` 之后调用 `browser_request_human(reason="请手动登录 GitHub")`
- Chat 流停在 `browser_request_human` 卡片，spinner 一直转
- Browser App 顶部出现红色 TakeoverBanner，VncViewport 的 `viewOnly` 切到 false
- 在 Browser App 的 noVNC 视口里直接点输入框、敲键盘
- 点工具栏的 "继续 AI" → REST 命中 `/sessions/{id}/resume` → asyncio.Event set → Chat 里 `browser_request_human` 卡片切到完成 → AI 继续后续动作

### 6. 资源清理验证

- 关闭 Browser App 窗口 → session 不应被销毁（仍在 `docker ps`）
- 等 15 分钟空闲 → idle reaper 自动清理（或 `BROWSER_IDLE_TTL_SEC=30` 临时调短验证）
- Ctrl+C uvicorn → 所有 session 容器 3s 内被 remove

### 7. 失败路径验证

- 无 selector 匹配的 `browser_click` → 返回 "未找到元素: ..." 字符串而非 raise
- 创建会话超过 `browser_max_sessions` (4) → 返回 "已达到最大并发会话数 4"
- Docker daemon 未跑 → `browser_create_session` 返回 "Docker 未运行..." 友好错误，后端不崩

---

## 实施推荐顺序

按这个顺序，每一步都是可独立验证的小切片：

1. Dockerfile + entrypoint，本地 build + 容器烟测（验证步骤 1-2）
2. `BrowserSessionManager` 骨架（不接 Playwright，先 create/list/close 容器）+ REST router 的 `POST/GET/DELETE /sessions`
3. 接入 Playwright `connect_over_cdp`，`browser_open` 一个工具走通端到端
4. 补全其余工具 + selector prefix 解析
5. 前端 `Browser.tsx` 骨架 + REST 轮询，先用 `<img>` 显示一张占位
6. 接入 `@novnc/novnc` 的 `VncViewport`，验证视口能看到 Chromium 画面
7. `browser_request_human` + `TakeoverBanner` + `/resume` 完整闭环
8. `ToolCallDisplay` 加 browser tool meta，让 Chat 端的渲染好看
9. Idle reaper、startup reconcile、CancelledError 处理这些边界情况补齐
10. 跑全套验证步骤
