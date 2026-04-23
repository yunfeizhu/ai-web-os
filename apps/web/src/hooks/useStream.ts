"use client";

import { API_BASE, DEFAULT_API_BASE } from "@/lib/backend";

const STREAM_IDLE_TIMEOUT_MS = 120_000;
const WS_RECONNECT_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000];
const WS_HEARTBEAT_INTERVAL_MS = 30_000;

function resolveWebSocketUrl() {
  const httpBase = API_BASE.replace(/\/api\/v1\/?$/, "");
  const fallbackWsBase = DEFAULT_API_BASE.replace(/\/api\/v1\/?$/, "").replace(
    /^http/i,
    "ws",
  );
  if (/^https?:\/\//i.test(httpBase)) {
    return `${httpBase.replace(/^http/i, "ws")}/ws`;
  }

  if (typeof window !== "undefined") {
    const url = new URL(httpBase || "/", window.location.origin);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = "/ws";
    url.search = "";
    return url.toString();
  }

  return `${fallbackWsBase}/ws`;
}

const WS_URL = resolveWebSocketUrl();

export interface ToolCallEvent {
  id: string;
  name: string;
  displayName?: string | null;
  args: Record<string, unknown>;
  subagentId?: string;
  subagentTask?: string;
  agentName?: string;
  role?: string;
}

export interface ToolResultEvent {
  id: string;
  name: string;
  displayName?: string | null;
  result: string;
  error: boolean;
  subagentId?: string;
  subagentTask?: string;
  agentName?: string;
  role?: string;
}

export interface SubagentTokenEvent {
  subagentId: string;
  agentName: string;
  role?: string;
  subagentTask?: string;
  token: string;
}

export interface SubagentResultEvent {
  subagentId: string;
  agentName: string;
  role?: string;
  task?: string;
  answer?: string;
  rawAnswer?: string | null;
  failed?: boolean;
  error?: string | null;
  maxToolCallsReached?: boolean;
  stopReason?: string | null;
  elapsedMs?: number;
  evidence?: Record<string, unknown>;
}

export interface EmbeddingParams {
  model: string;
  apiKey: string;
  baseUrl: string;
  dims: number;
}

export interface ChatParams {
  conversationId: string;
  appId?: string;
  message: string;
  model: string;
  providerId: string;
  history: Record<string, unknown>[];
  systemPrompt?: string;
  apiKey: string;
  apiBase?: string;
  enableMemory?: boolean;
  compatType?: string;
  embeddingConfig?: EmbeddingParams;
  llmApiKey?: string;
  llmApiBase?: string;
  onToken: (token: string) => void;
  onReasoningToken?: (token: string) => void;
  onToolCall?: (event: ToolCallEvent) => void;
  onToolResult?: (event: ToolResultEvent) => void;
  onStatus?: (status: string, event?: Record<string, unknown>) => void;
  onConfirmRequired?: (requestId: string, toolName: string, args: Record<string, unknown>) => void;
  onSubagentResult?: (event: SubagentResultEvent) => void;
  onSubagentToken?: (event: SubagentTokenEvent) => void;
}

// ── 单例 WebSocket 管理器 ─────────────────────────────────────────────────────

type PendingHandler = {
  onToken: (token: string) => void;
  onReasoningToken?: (token: string) => void;
  onToolCall?: (event: ToolCallEvent) => void;
  onToolResult?: (event: ToolResultEvent) => void;
  onStatus?: (status: string, event?: Record<string, unknown>) => void;
  onConfirmRequired?: (requestId: string, toolName: string, args: Record<string, unknown>) => void;
  onSubagentResult?: (event: SubagentResultEvent) => void;
  onSubagentToken?: (event: SubagentTokenEvent) => void;
  touch: () => void;
  resolve: (result: { title: string }) => void;
  reject: (err: Error) => void;
  aborted: () => boolean;
};

class WsManager {
  private ws: WebSocket | null = null;
  private pending = new Map<string, PendingHandler>();
  private connectPromise: Promise<WebSocket> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  private _startHeartbeat(ws: WebSocket): void {
    this._stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ type: "ping" }));
        } catch {
          /* ignore */
        }
      }
    }, WS_HEARTBEAT_INTERVAL_MS);
  }

  private _stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private _handleMessage(event: MessageEvent): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(event.data as string);
    } catch {
      return;
    }

    const type = msg.type as string;
    const requestId = msg.requestId as string;
    const payload = (msg.payload ?? {}) as Record<string, unknown>;

    if (type === "pong") return;

    const handler = this.pending.get(requestId);
    if (!handler) return;

    if (handler.aborted()) {
      this.pending.delete(requestId);
      return;
    }

    switch (type) {
      case "status":
        handler.touch();
        handler.onStatus?.(payload.status as string, payload);
        break;
      case "token":
        handler.touch();
        handler.onToken(payload.token as string);
        break;
      case "reasoning_token":
        handler.touch();
        handler.onReasoningToken?.(payload.token as string);
        break;
      case "tool_call":
        handler.touch();
        handler.onToolCall?.(payload as unknown as ToolCallEvent);
        break;
      case "tool_result":
        handler.touch();
        handler.onToolResult?.(payload as unknown as ToolResultEvent);
        break;
      case "agent_done":
        handler.touch();
        this.pending.delete(requestId);
        handler.resolve({ title: (payload.title as string) ?? "" });
        break;
      case "agent_error":
        handler.touch();
        this.pending.delete(requestId);
        handler.reject(new Error((payload.error as string) ?? "未知错误"));
        break;
      case "agent_confirm_required":
        handler.touch();
        handler.onConfirmRequired?.(
          requestId,
          payload.toolName as string,
          (payload.args ?? {}) as Record<string, unknown>,
        );
        break;
      case "subagent_result":
        handler.touch();
        handler.onSubagentResult?.(payload as unknown as SubagentResultEvent);
        break;
      case "subagent_token":
        handler.touch();
        handler.onSubagentToken?.(payload as unknown as SubagentTokenEvent);
        break;
    }
  }

  /** 递归尝试连接，初始连接失败时按指数退避重试。 */
  private _attemptConnect(
    retriesLeft: number,
    delayIdx: number,
    resolve: (ws: WebSocket) => void,
    reject: (err: Error) => void,
  ): void {
    const ws = new WebSocket(WS_URL);
    let opened = false;

    ws.onopen = () => {
      opened = true;
      this.ws = ws;
      this.connectPromise = null;
      this._startHeartbeat(ws);
      resolve(ws);
    };

    ws.onerror = () => {
      // onclose fires after onerror; handled there
    };

    ws.onclose = () => {
      if (!opened) {
        // 初始连接失败 — 指数退避重试
        if (retriesLeft > 0) {
          const delay = WS_RECONNECT_DELAYS_MS[delayIdx] ?? 16_000;
          setTimeout(
            () =>
              this._attemptConnect(
                retriesLeft - 1,
                delayIdx + 1,
                resolve,
                reject,
              ),
            delay,
          );
        } else {
          this.connectPromise = null;
          reject(
            new Error(
              "WebSocket 连接失败，已重试多次。请检查后端是否启动后刷新页面。",
            ),
          );
        }
      } else {
        // 会话中途断开 — 清空状态，等下次 send() 自动重连
        this._stopHeartbeat();
        this.ws = null;
        this.connectPromise = null;
        for (const [, h] of this.pending) {
          h.reject(new Error("WebSocket 连接已断开，请重新发送消息。"));
        }
        this.pending.clear();
      }
    };

    ws.onmessage = this._handleMessage.bind(this);
  }

  private connect(): Promise<WebSocket> {
    if (this.ws?.readyState === WebSocket.OPEN) return Promise.resolve(this.ws);
    if (this.connectPromise) return this.connectPromise;

    this.connectPromise = new Promise<WebSocket>((resolve, reject) => {
      this._attemptConnect(WS_RECONNECT_DELAYS_MS.length, 0, resolve, reject);
    });
    return this.connectPromise;
  }

  async send(
    requestId: string,
    payload: Record<string, unknown>,
    handler: PendingHandler,
  ): Promise<void> {
    const ws = await this.connect();
    this.pending.set(requestId, handler);
    ws.send(JSON.stringify({ type: "agent_invoke", requestId, payload }));
  }

  abort(requestId: string): void {
    this.pending.delete(requestId);
  }
}

const wsManager = new WsManager();

// ── streamChat（接口与之前 SSE 版本保持一致） ─────────────────────────────────

export async function streamChat(
  params: ChatParams,
  signal?: AbortSignal,
): Promise<{ title: string }> {
  const requestId = crypto.randomUUID();

  return new Promise((resolve, reject) => {
    let aborted = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

    const clearIdleTimer = () => {
      if (timeoutHandle !== null) {
        clearTimeout(timeoutHandle);
        timeoutHandle = null;
      }
    };

    const touch = () => {
      clearIdleTimer();
      timeoutHandle = setTimeout(() => {
        aborted = true;
        wsManager.abort(requestId);
        reject(
          new Error("聊天连接等待超时，模型或工具响应时间过长。请稍后重试。"),
        );
      }, STREAM_IDLE_TIMEOUT_MS);
    };

    signal?.addEventListener("abort", () => {
      aborted = true;
      clearIdleTimer();
      wsManager.abort(requestId);
      reject(new DOMException("Aborted", "AbortError"));
    });

    touch();

    wsManager.send(
      requestId,
      {
        conversationId: params.conversationId,
        appId: params.appId ?? null,
        message: params.message,
        model: params.model,
        providerId: params.providerId,
        history: params.history,
        systemPrompt:
          params.systemPrompt ??
          "你是 AI-Native OS 的智能助手，简洁友好地回答用户问题。",
        apiKey: params.apiKey,
        apiBase: params.apiBase ?? null,
        enableMemory: params.enableMemory ?? true,
        compatType: params.compatType ?? "openai",
        embeddingConfig: params.embeddingConfig ?? null,
        llmApiKey: params.llmApiKey ?? null,
        llmApiBase: params.llmApiBase ?? null,
      },
      {
        onToken: params.onToken,
        onReasoningToken: params.onReasoningToken,
        onToolCall: params.onToolCall,
        onToolResult: params.onToolResult,
        onStatus: params.onStatus,
        onConfirmRequired: params.onConfirmRequired,
        onSubagentResult: params.onSubagentResult,
        onSubagentToken: params.onSubagentToken,
        touch,
        resolve: (result) => {
          clearIdleTimer();
          resolve(result);
        },
        reject: (error) => {
          clearIdleTimer();
          reject(error);
        },
        aborted: () => aborted,
      },
    );
  });
}
