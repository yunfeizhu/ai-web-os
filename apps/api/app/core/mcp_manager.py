from __future__ import annotations

import asyncio
import json
import shutil
import subprocess
import threading
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Awaitable, Callable

import httpx

BuiltinToolHandler = Callable[[dict], Awaitable[dict | str]]

MCP_PROTOCOL_VERSION = "2025-11-25"
MCP_REQUEST_TIMEOUT_SECONDS = 20


class MCPProtocolError(RuntimeError):
    pass


@dataclass(slots=True)
class ActiveMCPServer:
    app_id: str
    transport: str
    status: str
    started_at: datetime
    pid: int | None = None
    initialized: bool = False
    protocol_version: str | None = None
    server_info: dict | None = None
    capabilities: dict = field(default_factory=dict)
    tool_count: int = 0
    health_status: str = "unknown"
    last_health_check_at: datetime | None = None
    last_health_error: str | None = None


class _StdioMCPClientSession:
    def __init__(self, app_id: str, process: subprocess.Popen[str]) -> None:
        self.app_id = app_id
        self.process = process
        self.protocol_version: str | None = None
        self.server_info: dict | None = None
        self.capabilities: dict = {}
        self.initialized = False
        self.tools_cache: list[dict] | None = None
        self._request_id = 0
        self._pending: dict[int, asyncio.Future] = {}
        self._write_lock = asyncio.Lock()
        self._loop = asyncio.get_running_loop()
        self._stdout_thread = threading.Thread(target=self._read_stdout_sync, daemon=True)
        self._stderr_thread = threading.Thread(target=self._read_stderr_sync, daemon=True)
        self._stdout_thread.start()
        self._stderr_thread.start()

    async def initialize(self) -> None:
        result = await self.request(
            "initialize",
            {
                "protocolVersion": MCP_PROTOCOL_VERSION,
                "capabilities": {},
                "clientInfo": {
                    "name": "AI-Web-OS",
                    "version": "0.2.0",
                },
            },
        )
        self.protocol_version = result.get("protocolVersion") or MCP_PROTOCOL_VERSION
        self.server_info = result.get("serverInfo") or {}
        self.capabilities = result.get("capabilities") or {}
        self.initialized = True
        await self.notify("notifications/initialized")

    async def request(self, method: str, params: dict | None = None) -> Any:
        if self.process.poll() is not None:
            raise MCPProtocolError(f"MCP server 已退出，returncode={self.process.returncode}")

        self._request_id += 1
        request_id = self._request_id
        future = asyncio.get_running_loop().create_future()
        self._pending[request_id] = future

        await self._send_message(
            {
                "jsonrpc": "2.0",
                "id": request_id,
                "method": method,
                **({"params": params} if params is not None else {}),
            }
        )

        try:
            return await asyncio.wait_for(future, timeout=MCP_REQUEST_TIMEOUT_SECONDS)
        finally:
            self._pending.pop(request_id, None)

    async def notify(self, method: str, params: dict | None = None) -> None:
        await self._send_message(
            {
                "jsonrpc": "2.0",
                "method": method,
                **({"params": params} if params is not None else {}),
            }
        )

    async def list_tools(self, refresh: bool = False) -> list[dict]:
        if self.tools_cache is not None and not refresh:
            return self.tools_cache

        tools: list[dict] = []
        cursor: str | None = None
        while True:
            params = {"cursor": cursor} if cursor else {}
            result = await self.request("tools/list", params=params)
            tools.extend(result.get("tools", []))
            cursor = result.get("nextCursor")
            if not cursor:
                break

        self.tools_cache = tools
        return tools

    async def call_tool(self, tool_name: str, arguments: dict) -> dict:
        return await self.request(
            "tools/call",
            {
                "name": tool_name,
                "arguments": arguments,
            },
        )

    async def close(self) -> None:
        for future in self._pending.values():
            if not future.done():
                future.set_exception(MCPProtocolError("MCP session 已关闭"))
        self._pending.clear()

    async def _send_message(self, payload: dict) -> None:
        if self.process.stdin is None:
            raise MCPProtocolError("MCP server stdin 不可用")

        data = json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n"
        async with self._write_lock:
            await asyncio.to_thread(self._write_message_sync, data)

    def _write_message_sync(self, data: str) -> None:
        if self.process.stdin is None:
            raise MCPProtocolError("MCP server stdin 不可用")
        self.process.stdin.write(data)
        self.process.stdin.flush()

    def _read_stdout_sync(self) -> None:
        if self.process.stdout is None:
            return

        try:
            while True:
                line = self.process.stdout.readline()
                if not line:
                    break
                raw = line.strip()
                if not raw:
                    continue
                try:
                    message = json.loads(raw)
                except json.JSONDecodeError:
                    print(f"[MCP:{self.app_id}] 无法解析 stdout 消息: {raw}")
                    continue
                self._loop.call_soon_threadsafe(
                    asyncio.create_task,
                    self._handle_incoming_message(message),
                )
        finally:
            self._loop.call_soon_threadsafe(
                self._fail_pending,
                MCPProtocolError("MCP server stdout 已关闭"),
            )

    def _read_stderr_sync(self) -> None:
        if self.process.stderr is None:
            return

        while True:
            line = self.process.stderr.readline()
            if not line:
                break
            raw = line.rstrip()
            if raw:
                print(f"[MCP:{self.app_id}:stderr] {raw}")

    async def _handle_incoming_message(self, message: dict) -> None:
        if "id" in message and ("result" in message or "error" in message):
            response_id = message["id"]
            future = self._pending.get(response_id)
            if future is None or future.done():
                return
            if "error" in message:
                error = message.get("error") or {}
                future.set_exception(MCPProtocolError(error.get("message") or "MCP request failed"))
            else:
                future.set_result(message.get("result"))
            return

        if "id" in message and "method" in message:
            await self._handle_server_request(message)

    async def _handle_server_request(self, message: dict) -> None:
        request_id = message.get("id")
        method = message.get("method")

        if method == "ping":
            await self._send_message({"jsonrpc": "2.0", "id": request_id, "result": {}})
            return

        await self._send_message(
            {
                "jsonrpc": "2.0",
                "id": request_id,
                "error": {
                    "code": -32601,
                    "message": f"Client does not implement server request method: {method}",
                },
            }
        )

    def _fail_pending(self, error: Exception) -> None:
        for future in self._pending.values():
            if not future.done():
                future.set_exception(error)
        self._pending.clear()


class _StreamableHTTPMCPClientSession:
    def __init__(
        self,
        app_id: str,
        url: str,
        headers: dict[str, str] | None = None,
    ) -> None:
        self.app_id = app_id
        self.url = url
        self.protocol_version: str | None = None
        self.server_info: dict | None = None
        self.capabilities: dict = {}
        self.initialized = False
        self.session_id: str | None = None
        self.tools_cache: list[dict] | None = None
        self._request_id = 0
        self._default_headers = headers or {}
        self._client = httpx.AsyncClient(timeout=MCP_REQUEST_TIMEOUT_SECONDS, follow_redirects=True)

    async def initialize(self) -> None:
        result, response_headers = await self._send_request(
            {
                "jsonrpc": "2.0",
                "id": self._next_request_id(),
                "method": "initialize",
                "params": {
                    "protocolVersion": MCP_PROTOCOL_VERSION,
                    "capabilities": {},
                    "clientInfo": {
                        "name": "AI-Web-OS",
                        "version": "0.2.0",
                    },
                },
            }
        )
        self.session_id = response_headers.get("MCP-Session-Id") or self.session_id
        self.protocol_version = result.get("protocolVersion") or MCP_PROTOCOL_VERSION
        self.server_info = result.get("serverInfo") or {}
        self.capabilities = result.get("capabilities") or {}
        self.initialized = True
        await self.notify("notifications/initialized")

    async def request(self, method: str, params: dict | None = None) -> Any:
        result, _ = await self._send_request(
            {
                "jsonrpc": "2.0",
                "id": self._next_request_id(),
                "method": method,
                **({"params": params} if params is not None else {}),
            }
        )
        return result

    async def notify(self, method: str, params: dict | None = None) -> None:
        response = await self._client.post(
            self.url,
            json={
                "jsonrpc": "2.0",
                "method": method,
                **({"params": params} if params is not None else {}),
            },
            headers=self._build_headers(),
        )
        if response.status_code not in (200, 202, 204):
            raise MCPProtocolError(
                f"HTTP MCP notification 失败，status={response.status_code}, body={response.text}"
            )

    async def list_tools(self, refresh: bool = False) -> list[dict]:
        if self.tools_cache is not None and not refresh:
            return self.tools_cache

        tools: list[dict] = []
        cursor: str | None = None
        while True:
            params = {"cursor": cursor} if cursor else {}
            result = await self.request("tools/list", params=params)
            tools.extend(result.get("tools", []))
            cursor = result.get("nextCursor")
            if not cursor:
                break

        self.tools_cache = tools
        return tools

    async def call_tool(self, tool_name: str, arguments: dict) -> dict:
        return await self.request(
            "tools/call",
            {
                "name": tool_name,
                "arguments": arguments,
            },
        )

    async def close(self) -> None:
        if self.session_id:
            try:
                await self._client.request(
                    "DELETE",
                    self.url,
                    headers=self._build_headers(),
                )
            except httpx.HTTPError:
                pass
        await self._client.aclose()

    async def _send_request(self, payload: dict) -> tuple[Any, httpx.Headers]:
        async with self._client.stream(
            "POST",
            self.url,
            json=payload,
            headers=self._build_headers(),
        ) as response:
            response.raise_for_status()
            self.session_id = response.headers.get("MCP-Session-Id") or self.session_id
            content_type = response.headers.get("Content-Type", "")

            if "text/event-stream" in content_type:
                return await self._read_sse_response(response, payload["id"]), response.headers

            if "application/json" not in content_type:
                body = await response.aread()
                raise MCPProtocolError(
                    f"HTTP MCP 返回了不支持的 Content-Type: {content_type or 'unknown'}, body={body.decode('utf-8', errors='replace')}"
                )

            body = await response.aread()
            message = json.loads(body.decode("utf-8"))
            return self._extract_response(message, payload["id"]), response.headers

    async def _read_sse_response(self, response: httpx.Response, request_id: int) -> Any:
        data_lines: list[str] = []

        async for raw_line in response.aiter_lines():
            line = raw_line.rstrip("\r")
            if line == "":
                if not data_lines:
                    continue
                event_data = "\n".join(data_lines)
                data_lines.clear()
                message = self._parse_sse_payload(event_data)
                result = await self._handle_sse_message(message, request_id)
                if result is not None:
                    return result
                continue

            if line.startswith(":"):
                continue
            if line.startswith("data:"):
                data_lines.append(line[5:].lstrip())

        if data_lines:
            message = self._parse_sse_payload("\n".join(data_lines))
            result = await self._handle_sse_message(message, request_id)
            if result is not None:
                return result

        raise MCPProtocolError("HTTP MCP SSE 流结束，但没有收到对应的 JSON-RPC 响应")

    async def _handle_sse_message(self, message: dict, request_id: int) -> Any | None:
        if "id" in message and ("result" in message or "error" in message):
            if message.get("id") != request_id:
                return None
            return self._extract_response(message, request_id)

        if "id" in message and "method" in message:
            await self._respond_to_server_request(message)

        return None

    async def _respond_to_server_request(self, message: dict) -> None:
        request_id = message.get("id")
        method = message.get("method")

        if method == "ping":
            await self._post_json({"jsonrpc": "2.0", "id": request_id, "result": {}})
            return

        await self._post_json(
            {
                "jsonrpc": "2.0",
                "id": request_id,
                "error": {
                    "code": -32601,
                    "message": f"Client does not implement server request method: {method}",
                },
            }
        )

    async def _post_json(self, payload: dict) -> None:
        response = await self._client.post(
            self.url,
            json=payload,
            headers=self._build_headers(),
        )
        if response.status_code not in (200, 202, 204):
            raise MCPProtocolError(
                f"HTTP MCP 回传消息失败，status={response.status_code}, body={response.text}"
            )

    def _build_headers(self) -> dict[str, str]:
        headers = dict(self._default_headers)
        headers["Content-Type"] = "application/json"
        headers["Accept"] = "application/json, text/event-stream"
        headers["MCP-Protocol-Version"] = self.protocol_version or MCP_PROTOCOL_VERSION
        if self.session_id:
            headers["MCP-Session-Id"] = self.session_id
        return headers

    def _extract_response(self, message: dict, request_id: int) -> Any:
        if message.get("id") != request_id:
            raise MCPProtocolError(
                f"HTTP MCP 返回的响应 id 不匹配，expected={request_id}, actual={message.get('id')}"
            )
        if "error" in message:
            error = message.get("error") or {}
            raise MCPProtocolError(error.get("message") or "HTTP MCP request failed")
        return message.get("result")

    def _parse_sse_payload(self, payload: str) -> dict:
        try:
            return json.loads(payload)
        except json.JSONDecodeError as exc:
            raise MCPProtocolError(f"HTTP MCP SSE 数据无法解析为 JSON: {payload}") from exc

    def _next_request_id(self) -> int:
        self._request_id += 1
        return self._request_id


class MCPManager:
    """Lightweight MCP lifecycle manager.

    当前支持 builtin、stdio 和 streamable HTTP 三种 transport。
    """

    def __init__(self) -> None:
        self._servers: dict[str, ActiveMCPServer] = {}
        self._processes: dict[str, subprocess.Popen[str]] = {}
        self._builtin_handlers: dict[tuple[str, str], BuiltinToolHandler] = {}
        self._stdio_sessions: dict[str, _StdioMCPClientSession] = {}
        self._http_sessions: dict[str, _StreamableHTTPMCPClientSession] = {}

    def register_builtin_tool(
        self,
        app_id: str,
        tool_name: str,
        handler: BuiltinToolHandler,
    ) -> None:
        self._builtin_handlers[(app_id, tool_name)] = handler

    async def start_server(self, app_id: str, manifest: dict) -> ActiveMCPServer:
        existing = self._servers.get(app_id)
        if existing and existing.status == "active":
            process = self._processes.get(app_id)
            if process is None or process.poll() is None:
                return existing

        mcp = manifest.get("mcp", {}) or {}
        transport = mcp.get("transport", "builtin")

        if transport == "builtin":
            active = ActiveMCPServer(
                app_id=app_id,
                transport=transport,
                status="active",
                started_at=datetime.now(timezone.utc),
                initialized=True,
                health_status="healthy",
                last_health_check_at=datetime.now(timezone.utc),
            )
            self._servers[app_id] = active
            return active

        if transport == "stdio":
            return await self._start_stdio_server(app_id, manifest, mcp)

        if transport in ("streamable-http", "http", "remote-http"):
            return await self._start_http_server(app_id, mcp, transport)

        raise ValueError(f"不支持的 MCP transport: {transport}")

    async def stop_server(self, app_id: str) -> None:
        stdio_session = self._stdio_sessions.pop(app_id, None)
        if stdio_session is not None:
            await stdio_session.close()

        http_session = self._http_sessions.pop(app_id, None)
        if http_session is not None:
            await http_session.close()

        process = self._processes.pop(app_id, None)
        if process is not None:
            if process.stdin is not None:
                process.stdin.close()
            if process.poll() is None:
                process.terminate()
                try:
                    await asyncio.wait_for(asyncio.to_thread(process.wait), timeout=5)
                except asyncio.TimeoutError:
                    process.kill()
                    await asyncio.to_thread(process.wait)

        active = self._servers.get(app_id)
        if active:
            active.status = "inactive"
            active.initialized = False
            active.health_status = "unknown"
            active.last_health_error = None

    async def stop_all(self) -> None:
        for app_id in list(self._servers.keys()):
            await self.stop_server(app_id)

    def get_status(self, app_id: str) -> dict:
        active = self._servers.get(app_id)
        if not active:
            return {"status": "inactive", "transport": None, "pid": None}

        process = self._processes.get(app_id)
        status = active.status
        if process is not None and process.poll() is not None:
            status = "error" if process.returncode else "inactive"

        return {
            "status": status,
            "transport": active.transport,
            "pid": active.pid,
            "started_at": active.started_at.isoformat(),
            "initialized": active.initialized,
            "protocol_version": active.protocol_version,
            "server_info": active.server_info,
            "tool_count": active.tool_count,
            "health_status": active.health_status,
            "last_health_check_at": (
                active.last_health_check_at.isoformat() if active.last_health_check_at else None
            ),
            "last_health_error": active.last_health_error,
        }

    async def check_server_health(self, app_id: str) -> dict:
        active = self._servers.get(app_id)
        if active is None:
            return {"status": "inactive", "transport": None, "pid": None, "health_status": "inactive"}

        checked_at = datetime.now(timezone.utc)

        if active.transport == "builtin":
            active.health_status = "healthy"
            active.last_health_check_at = checked_at
            active.last_health_error = None
            return self.get_status(app_id)

        process = self._processes.get(app_id)
        if process is not None and process.poll() is not None:
            active.status = "error"
            active.initialized = False
            active.health_status = "unhealthy"
            active.last_health_check_at = checked_at
            active.last_health_error = f"process exited with code {process.returncode}"
            return self.get_status(app_id)

        try:
            tools = await self.list_tools(app_id, refresh=True)
            active.status = "active"
            active.initialized = True
            active.tool_count = len(tools)
            active.health_status = "healthy"
            active.last_health_check_at = checked_at
            active.last_health_error = None
        except Exception as exc:
            active.status = "error"
            active.initialized = False
            active.health_status = "unhealthy"
            active.last_health_check_at = checked_at
            active.last_health_error = str(exc)

        return self.get_status(app_id)

    async def list_tools(self, app_id: str, refresh: bool = False) -> list[dict]:
        stdio_session = self._stdio_sessions.get(app_id)
        if stdio_session is not None:
            tools = await stdio_session.list_tools(refresh=refresh)
            active = self._servers.get(app_id)
            if active:
                active.tool_count = len(tools)
            return tools

        http_session = self._http_sessions.get(app_id)
        if http_session is not None:
            tools = await http_session.list_tools(refresh=refresh)
            active = self._servers.get(app_id)
            if active:
                active.tool_count = len(tools)
            return tools

        raise ValueError(f"App {app_id} 未建立 MCP 会话")

    async def call_tool(self, app_id: str, tool_name: str, arguments: dict) -> dict | str:
        handler = self._builtin_handlers.get((app_id, tool_name))
        if handler is not None:
            return await handler(arguments)

        stdio_session = self._stdio_sessions.get(app_id)
        if stdio_session is not None:
            return await stdio_session.call_tool(tool_name, arguments)

        http_session = self._http_sessions.get(app_id)
        if http_session is not None:
            return await http_session.call_tool(tool_name, arguments)

        active = self._servers.get(app_id)
        if active and active.transport == "stdio":
            raise ValueError(f"App {app_id} 的 stdio MCP 会话尚未初始化")
        if active and active.transport in ("streamable-http", "http", "remote-http"):
            raise ValueError(f"App {app_id} 的远程 HTTP MCP 会话尚未初始化")
        raise ValueError(f"App {app_id} 未注册工具 {tool_name}")

    async def _start_stdio_server(self, app_id: str, manifest: dict, mcp: dict) -> ActiveMCPServer:
        command = mcp.get("command")
        args = list(mcp.get("args", []))
        if not command:
            raise ValueError("stdio app 缺少 command 配置。")

        resolved_command = shutil.which(str(command)) if command else None
        if resolved_command is None:
            raise ValueError(
                f"当前部署节点未安装命令 `{command}`。"
                "stdio MCP 目前仅支持 Node.js / Python / uv 类运行时，请确认服务端镜像已内置对应环境。"
            )

        cwd = None
        source_path = manifest.get("source_path")
        if source_path and not str(source_path).startswith("inline://"):
            cwd = str(Path(source_path).parent)

        process = subprocess.Popen(
            [resolved_command, *args],
            cwd=cwd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            bufsize=1,
        )
        self._processes[app_id] = process

        session = _StdioMCPClientSession(app_id, process)
        self._stdio_sessions[app_id] = session

        active = ActiveMCPServer(
            app_id=app_id,
            transport="stdio",
            status="initializing",
            started_at=datetime.now(timezone.utc),
            pid=process.pid,
        )
        self._servers[app_id] = active

        try:
            await session.initialize()
            tools = await session.list_tools()
            active.status = "active"
            active.initialized = True
            active.protocol_version = session.protocol_version
            active.server_info = session.server_info
            active.capabilities = session.capabilities
            active.tool_count = len(tools)
            active.health_status = "healthy"
            active.last_health_check_at = datetime.now(timezone.utc)
            active.last_health_error = None
            return active
        except Exception:
            active.status = "error"
            active.health_status = "unhealthy"
            active.last_health_check_at = datetime.now(timezone.utc)
            self._stdio_sessions.pop(app_id, None)
            self._processes.pop(app_id, None)
            await session.close()
            if process.poll() is None:
                process.terminate()
                await asyncio.to_thread(process.wait)
            raise

    async def _start_http_server(self, app_id: str, mcp: dict, transport: str) -> ActiveMCPServer:
        url = mcp.get("url")
        headers = mcp.get("headers") or {}
        if not url:
            raise ValueError("远程 HTTP MCP 缺少 url 配置。")

        session = _StreamableHTTPMCPClientSession(app_id, str(url), dict(headers))
        self._http_sessions[app_id] = session

        active = ActiveMCPServer(
            app_id=app_id,
            transport=transport,
            status="initializing",
            started_at=datetime.now(timezone.utc),
        )
        self._servers[app_id] = active

        try:
            await session.initialize()
            tools = await session.list_tools()
            active.status = "active"
            active.initialized = True
            active.protocol_version = session.protocol_version
            active.server_info = session.server_info
            active.capabilities = session.capabilities
            active.tool_count = len(tools)
            active.health_status = "healthy"
            active.last_health_check_at = datetime.now(timezone.utc)
            active.last_health_error = None
            return active
        except Exception:
            active.status = "error"
            active.health_status = "unhealthy"
            active.last_health_check_at = datetime.now(timezone.utc)
            self._http_sessions.pop(app_id, None)
            await session.close()
            raise
