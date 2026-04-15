"use client";

const WS_URL = "ws://localhost:8000/ws";

export interface ToolCallEvent {
  id: string;
  name: string;
  displayName?: string | null;
  args: Record<string, unknown>;
}

export interface ToolResultEvent {
  id: string;
  name: string;
  displayName?: string | null;
  result: string;
  error: boolean;
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
  history: { role: string; content: string }[];
  systemPrompt?: string;
  apiKey: string;
  apiBase?: string;
  enableMemory?: boolean;
  compatType?: string;
  embeddingConfig?: EmbeddingParams;
  llmApiKey?: string;
  llmApiBase?: string;
  onToken: (token: string) => void;
  onToolCall?: (event: ToolCallEvent) => void;
  onToolResult?: (event: ToolResultEvent) => void;
  onStatus?: (status: string, event?: Record<string, unknown>) => void;
}

// ── 单例 WebSocket 管理器 ─────────────────────────────────────────────────────

type PendingHandler = {
  onToken: (token: string) => void;
  onToolCall?: (event: ToolCallEvent) => void;
  onToolResult?: (event: ToolResultEvent) => void;
  onStatus?: (status: string, event?: Record<string, unknown>) => void;
  resolve: (result: { title: string }) => void;
  reject: (err: Error) => void;
  aborted: () => boolean;
};

class WsManager {
  private ws: WebSocket | null = null;
  private pending = new Map<string, PendingHandler>();
  private connectPromise: Promise<WebSocket> | null = null;

  private connect(): Promise<WebSocket> {
    if (this.ws?.readyState === WebSocket.OPEN) {
      return Promise.resolve(this.ws);
    }
    if (this.connectPromise) return this.connectPromise;

    this.connectPromise = new Promise((resolve, reject) => {
      const ws = new WebSocket(WS_URL);
      ws.onopen = () => {
        this.ws = ws;
        this.connectPromise = null;
        resolve(ws);
      };
      ws.onerror = () => {
        this.connectPromise = null;
        reject(new Error("WebSocket 连接失败，请检查后端是否启动"));
      };
      ws.onclose = () => {
        this.ws = null;
        this.connectPromise = null;
        // 拒绝所有等待中的请求
        for (const [, h] of this.pending) {
          h.reject(new Error("WebSocket 连接断开"));
        }
        this.pending.clear();
      };
      ws.onmessage = (event) => {
        let msg: Record<string, unknown>;
        try { msg = JSON.parse(event.data); } catch { return; }

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
            handler.onStatus?.(payload.status as string, payload);
            break;
          case "token":
            handler.onToken(payload.token as string);
            break;
          case "tool_call":
            handler.onToolCall?.(payload as unknown as ToolCallEvent);
            break;
          case "tool_result":
            handler.onToolResult?.(payload as unknown as ToolResultEvent);
            break;
          case "agent_done":
            this.pending.delete(requestId);
            handler.resolve({ title: (payload.title as string) ?? "" });
            break;
          case "agent_error":
            this.pending.delete(requestId);
            handler.reject(new Error((payload.error as string) ?? "未知错误"));
            break;
        }
      };
    });

    return this.connectPromise;
  }

  async send(requestId: string, payload: Record<string, unknown>, handler: PendingHandler) {
    const ws = await this.connect();
    this.pending.set(requestId, handler);
    ws.send(JSON.stringify({ type: "agent_invoke", requestId, payload }));
  }

  abort(requestId: string) {
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

    signal?.addEventListener("abort", () => {
      aborted = true;
      wsManager.abort(requestId);
      reject(new DOMException("Aborted", "AbortError"));
    });

    wsManager.send(
      requestId,
      {
        conversationId: params.conversationId,
        appId: params.appId ?? null,
        message: params.message,
        model: params.model,
        providerId: params.providerId,
        history: params.history,
        systemPrompt: params.systemPrompt ?? "你是 AI-Native OS 的智能助手，简洁友好地回答用户问题。",
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
        onToolCall: params.onToolCall,
        onToolResult: params.onToolResult,
        onStatus: params.onStatus,
        resolve,
        reject,
        aborted: () => aborted,
      },
    );
  });
}
