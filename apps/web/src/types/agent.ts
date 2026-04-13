// Agent / 消息类型定义

export interface Conversation {
  id: string;
  appId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  createdAt: string;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: unknown;
  duration?: number;
}

// WebSocket 消息类型
export interface WSClientMessage {
  type: "agent_invoke" | "agent_cancel" | "ping";
  requestId: string;
  payload: AgentInvokePayload | Record<string, never>;
}

export interface AgentInvokePayload {
  appId: string;
  sessionId: string;
  message: string;
  attachments?: Attachment[];
  model?: string;
}

export interface Attachment {
  type: "file" | "image";
  name: string;
  url: string;
  mimeType: string;
}

export type WSServerMessageType =
  | "token"
  | "tool_call_start"
  | "tool_call_result"
  | "agent_done"
  | "agent_error"
  | "memory_update"
  | "skill_event"
  | "system_notification"
  | "pong";

export interface WSServerMessage {
  type: WSServerMessageType;
  requestId: string;
  payload: unknown;
}

export interface TokenPayload {
  token: string;
  isComplete: boolean;
}

export interface ToolCallStartPayload {
  toolName: string;
  arguments: Record<string, unknown>;
  appId: string;
}

export interface ToolCallResultPayload {
  toolName: string;
  result: unknown;
  duration: number;
}
