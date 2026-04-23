export interface ToolCall {
  id: string;
  name: string;
  displayName?: string | null;
  args: Record<string, unknown>;
  result?: string;
  error?: boolean;
  status: "running" | "done" | "error";
  subagentId?: string;
  subagentTask?: string;
  agentName?: string;
  role?: string;
}

export type EvidenceBundle = Record<string, unknown>;

export interface SubagentRun {
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
  evidence?: EvidenceBundle;
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
  reasoningContent?: string;
  streaming?: boolean;
  toolCalls?: ToolCall[];
  cwdLabel?: string;
  subagentTokens?: Record<string, string>; // agentName → accumulated token text
  subagentDone?: Record<string, boolean>; // agentName → finished flag
  subagentResults?: Record<string, SubagentRun>;
}

export interface Conversation {
  id: string;
  title: string;
  model: string;
  updatedAt: string;
}
