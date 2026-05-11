export interface ToolCall {
  id: string;
  name: string;
  displayName?: string | null;
  args: Record<string, unknown>;
  result?: string;
  error?: boolean;
  status: "running" | "done" | "error";
  internal?: boolean;
  skipped?: boolean;
  skipReason?: string;
  displayResult?: string;
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

export interface AgentUsageEstimate {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
}

export interface AppWorkflowApp {
  appId: string;
  appName: string;
}

export interface AppWorkflowStep {
  id: string;
  appId: string;
  appName: string;
  title: string;
  status: "pending" | "completed" | "failed";
}

export interface AppWorkflowResult {
  id?: string;
  appId: string;
  appName: string;
  tool?: string;
  status: "completed" | "failed";
  preview?: string;
}

export interface AppWorkflowSummary {
  status: "workflow_plan" | "workflow_summary";
  workflowId: string;
  appCount: number;
  completedSteps: number;
  failedSteps: number;
  pendingSteps: number;
  hasFailures: boolean;
  apps: AppWorkflowApp[];
  steps: AppWorkflowStep[];
  results: AppWorkflowResult[];
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
  usageEstimate?: AgentUsageEstimate;
  workflowSummary?: AppWorkflowSummary;
}

export interface Conversation {
  id: string;
  title: string;
  model: string;
  updatedAt: string;
}
