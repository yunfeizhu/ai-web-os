export interface ToolCall {
  id: string;
  name: string;
  displayName?: string | null;
  args: Record<string, unknown>;
  result?: string;
  error?: boolean;
  status: "running" | "done" | "error";
}

export interface SkillActivity {
  app_id: string;
  name: string;
  description?: string;
  entrypoint?: string | null;
  source?: string;
  role?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "error";
  content: string;
  streaming?: boolean;
  toolCalls?: ToolCall[];
  cwdLabel?: string;
}

export interface Conversation {
  id: string;
  title: string;
  model: string;
  updatedAt: string;
}
