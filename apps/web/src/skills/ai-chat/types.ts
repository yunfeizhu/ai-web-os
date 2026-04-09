export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  result?: string;
  error?: boolean;
  status: "running" | "done" | "error";
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "error";
  content: string;
  streaming?: boolean;
  toolCalls?: ToolCall[];
}

export interface Conversation {
  id: string;
  title: string;
  model: string;
  updatedAt: string;
}
