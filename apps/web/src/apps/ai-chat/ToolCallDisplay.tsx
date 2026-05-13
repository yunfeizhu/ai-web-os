"use client";

import { useMemo, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  AlertCircle,
  BookOpen,
  Bot,
  BrainCircuit,
  Calculator,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Code2,
  FileText,
  Globe,
  Hourglass,
  Keyboard,
  Link,
  Loader2,
  MousePointerClick,
  Search,
  Settings2,
  XCircle,
} from "lucide-react";
import type { EvidenceBundle, SubagentRun, ToolCall } from "./types";
import { isVisibleToolCall } from "./toolCallVisibility";

type ToolMeta = {
  label: string;
  icon: ReactNode;
  color: string;
};

type AgentStatus = "pending" | "running" | "summarizing" | "done" | "error";

type AgentRunView = {
  key: string;
  subagentId: string;
  agentName: string;
  role?: string;
  task: string;
  calls: ToolCall[];
  tokenText: string;
  answer: string;
  rawAnswer?: string | null;
  failed: boolean;
  error?: string | null;
  maxToolCallsReached?: boolean;
  stopReason?: string | null;
  elapsedMs?: number;
  evidence?: EvidenceBundle;
  done: boolean;
  status: AgentStatus;
  order: number;
};

type MultiAgentView = {
  delegateCalls: ToolCall[];
  directCalls: ToolCall[];
  agents: AgentRunView[];
};

type DelegateAgentRecord = {
  agentName?: string;
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
};

type DelegatePayload = {
  mode?: string;
  results?: Record<string, string>;
  agents?: DelegateAgentRecord[];
  failed?: string[];
  errors?: Record<string, string>;
  evidence?: Record<string, EvidenceBundle>;
};

const TOOL_META: Record<string, ToolMeta> = {
  fetch_url: { label: "读取网页", icon: <Link size={13} />, color: "#5856D6" },
  calculator: {
    label: "计算器",
    icon: <Calculator size={13} />,
    color: "#34C759",
  },
  python_exec: {
    label: "执行代码",
    icon: <Code2 size={13} />,
    color: "#FF9F0A",
  },
  retrieve_knowledge: {
    label: "知识库检索",
    icon: <BookOpen size={13} />,
    color: "#0EA5E9",
  },
  load_skill_context: {
    label: "加载 Skill",
    icon: <BookOpen size={13} />,
    color: "#14B8A6",
  },
  delegate_task: {
    label: "委托子任务",
    icon: <BrainCircuit size={13} />,
    color: "#2563EB",
  },
  browser_create_session: {
    label: "创建浏览器会话",
    icon: <Globe size={13} />,
    color: "#0A84FF",
  },
  browser_open: {
    label: "打开网页",
    icon: <Globe size={13} />,
    color: "#0A84FF",
  },
  browser_reload: {
    label: "刷新网页",
    icon: <Globe size={13} />,
    color: "#0A84FF",
  },
  browser_back: { label: "后退", icon: <Globe size={13} />, color: "#0A84FF" },
  browser_forward: {
    label: "前进",
    icon: <Globe size={13} />,
    color: "#0A84FF",
  },
  browser_new_tab: {
    label: "新建标签页",
    icon: <Globe size={13} />,
    color: "#0A84FF",
  },
  browser_switch_tab: {
    label: "切换标签页",
    icon: <Globe size={13} />,
    color: "#0A84FF",
  },
  browser_close_tab: {
    label: "关闭标签页",
    icon: <XCircle size={13} />,
    color: "#EF4444",
  },
  browser_click: {
    label: "点击页面元素",
    icon: <MousePointerClick size={13} />,
    color: "#2563EB",
  },
  browser_click_at: {
    label: "点击坐标",
    icon: <MousePointerClick size={13} />,
    color: "#2563EB",
  },
  browser_type: {
    label: "输入文本",
    icon: <Keyboard size={13} />,
    color: "#2563EB",
  },
  browser_type_text: {
    label: "输入到焦点",
    icon: <Keyboard size={13} />,
    color: "#2563EB",
  },
  browser_press: {
    label: "按键",
    icon: <Keyboard size={13} />,
    color: "#2563EB",
  },
  browser_wheel: {
    label: "滚动页面",
    icon: <Hourglass size={13} />,
    color: "#F59E0B",
  },
  browser_wait_for: {
    label: "等待页面",
    icon: <Hourglass size={13} />,
    color: "#F59E0B",
  },
  browser_extract_text: {
    label: "提取页面正文",
    icon: <BookOpen size={13} />,
    color: "#14B8A6",
  },
  browser_get_state: {
    label: "读取页面状态",
    icon: <Globe size={13} />,
    color: "#6366F1",
  },
  browser_focus: {
    label: "聚焦浏览器",
    icon: <Globe size={13} />,
    color: "#6366F1",
  },
  browser_import_cookies: {
    label: "导入 Cookie",
    icon: <Globe size={13} />,
    color: "#14B8A6",
  },
  browser_import_storage_state: {
    label: "导入登录态",
    icon: <BookOpen size={13} />,
    color: "#14B8A6",
  },
  browser_request_human: {
    label: "请求人工接管",
    icon: <AlertCircle size={13} />,
    color: "#F97316",
  },
  browser_close_session: {
    label: "关闭浏览器会话",
    icon: <XCircle size={13} />,
    color: "#EF4444",
  },
};

const ROLE_META: Record<
  string,
  { label: string; icon: ReactNode; color: string; tint: string }
> = {
  research: {
    label: "Research",
    icon: <Search size={13} />,
    color: "#0EA5E9",
    tint: "rgba(14,165,233,0.12)",
  },
  coder: {
    label: "Code",
    icon: <Code2 size={13} />,
    color: "#F59E0B",
    tint: "rgba(245,158,11,0.14)",
  },
  system: {
    label: "System",
    icon: <Settings2 size={13} />,
    color: "#22C55E",
    tint: "rgba(34,197,94,0.12)",
  },
  writer: {
    label: "Writer",
    icon: <FileText size={13} />,
    color: "#EC4899",
    tint: "rgba(236,72,153,0.12)",
  },
};

const STATUS_COPY: Record<AgentStatus, string> = {
  pending: "等待",
  running: "执行中",
  summarizing: "整理结果",
  done: "完成",
  error: "失败",
};

function getRoleMeta(role?: string) {
  return ROLE_META[String(role ?? "").toLowerCase()] ?? {
    label: role || "Agent",
    icon: <Bot size={13} />,
    color: "#64748B",
    tint: "rgba(100,116,139,0.12)",
  };
}

function withCapabilitySuffix(label: string, suffix: "Search" | "Extract" | "Fetch") {
  const hasSuffix = /\b(Search|Extract|Fetch)\b|搜索|抓取|正文|读取/.test(label);
  return hasSuffix ? label : `${label} ${suffix}`;
}

function getMcpToolMeta(tc: ToolCall): ToolMeta {
  const name = tc.name.toLowerCase();
  const label = tc.displayName || "MCP";
  if (/(^|_)search(_|$)|searx|query|news/.test(name)) {
    return {
      label: withCapabilitySuffix(label, "Search"),
      icon: <Search size={13} />,
      color: "#0EA5E9",
    };
  }
  if (/(^|_)(extract|scrape|crawl|reader)(_|$)|page_content|url_content/.test(name)) {
    return {
      label: withCapabilitySuffix(label, "Extract"),
      icon: <FileText size={13} />,
      color: "#F59E0B",
    };
  }
  if (/(^|_)fetch(_|$)|download|open_url/.test(name)) {
    return {
      label: withCapabilitySuffix(label, "Fetch"),
      icon: <Link size={13} />,
      color: "#5856D6",
    };
  }
  return {
    label: tc.displayName || "MCP 工具",
    icon: <Globe size={13} />,
    color: "#0EA5E9",
  };
}

function getToolMeta(tc: ToolCall): ToolMeta {
  const builtin = TOOL_META[tc.name];
  if (builtin) return builtin;
  if (tc.name.startsWith("skill_")) {
    return {
      label: tc.displayName || "Skill 工具",
      icon: <BookOpen size={13} />,
      color: "#14B8A6",
    };
  }
  if (tc.name.startsWith("mcp_")) {
    return getMcpToolMeta(tc);
  }
  return {
    label: tc.displayName || tc.name,
    icon: <Code2 size={13} />,
    color: "#64748B",
  };
}

function safeStringify(value: unknown, maxLength = 80): string {
  try {
    const text =
      typeof value === "string" ? value : JSON.stringify(value ?? {}, null, 0);
    return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
  } catch {
    return "";
  }
}

function getArgsSummary(tc: ToolCall): string {
  const { name, args } = tc;
  if (name === "delegate_task") {
    const tasks = Array.isArray(args.tasks) ? args.tasks : [];
    return `${tasks.length} 个子任务`;
  }
  if (name === "fetch_url") return String(args.url ?? "");
  if (name === "calculator") return String(args.expression ?? "");
  if (name === "python_exec") {
    const code = String(args.code ?? "");
    const firstLine = code.split("\n")[0];
    return firstLine.length > 70 ? `${firstLine.slice(0, 70)}...` : firstLine;
  }
  if (name === "retrieve_knowledge") return String(args.query ?? "");
  if (name === "load_skill_context") return String(args.skill_id ?? "");
  if (name === "browser_open") return String(args.url ?? "");
  if (name === "browser_switch_tab" || name === "browser_close_tab") {
    return String(args.tab_id ?? "");
  }
  if (
    name === "browser_click" ||
    name === "browser_type" ||
    name === "browser_wait_for"
  ) {
    return String(args.selector ?? "");
  }
  if (name === "browser_click_at") {
    return `${String(args.x ?? "")}, ${String(args.y ?? "")}`;
  }
  if (name === "browser_type_text") return String(args.text ?? "");
  if (name === "browser_press") return String(args.key ?? "");
  if (name === "browser_request_human") return String(args.reason ?? "");
  if (name === "browser_import_cookies") return String(args.site_url ?? "");
  if (name.startsWith("skill_") || name.startsWith("mcp_")) {
    return (
      String(args.query ?? args.symbol ?? args.url ?? args.code ?? "").trim() ||
      safeStringify(args, 70)
    );
  }
  if (
    name === "browser_create_session" ||
    name === "browser_reload" ||
    name === "browser_back" ||
    name === "browser_forward" ||
    name === "browser_new_tab" ||
    name === "browser_extract_text" ||
    name === "browser_get_state" ||
    name === "browser_focus" ||
    name === "browser_import_storage_state" ||
    name === "browser_wheel" ||
    name === "browser_close_session"
  ) {
    return String(args.session_id ?? "");
  }
  return safeStringify(args, 70);
}

function parseJson<T>(value?: string): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function formatElapsed(ms?: number) {
  if (typeof ms !== "number" || Number.isNaN(ms)) return "";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function evidenceList(evidence: EvidenceBundle | undefined, key: string) {
  const value = evidence?.[key];
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    : [];
}

function evidenceStrings(evidence: EvidenceBundle | undefined, key: string) {
  const value = evidence?.[key];
  return Array.isArray(value)
    ? value.map((item) => String(item ?? "").trim()).filter(Boolean)
    : [];
}

function evidenceText(item: Record<string, unknown>, key: string) {
  return String(item[key] ?? "").trim();
}

function hasEvidenceDetails(evidence?: EvidenceBundle) {
  return (
    !!String(evidence?.summary ?? "").trim() ||
    evidenceList(evidence, "facts").length > 0 ||
    evidenceList(evidence, "sources").length > 0 ||
    evidenceStrings(evidence, "missing_fields").length > 0
  );
}

function statusFromToolCall(tc: ToolCall): AgentStatus {
  if (tc.status === "running") return "running";
  if (tc.status === "error" || tc.error) return "error";
  return "done";
}

function createCollector(
  subagentTokens: Record<string, string>,
  subagentDone: Record<string, boolean>,
  subagentResults: Record<string, SubagentRun>,
) {
  const agents: AgentRunView[] = [];
  const aliases = new Map<string, string>();
  const byKey = new Map<string, AgentRunView>();

  const registerAlias = (alias: string | undefined, key: string) => {
    if (alias) aliases.set(alias, key);
  };

  const resolveKey = (agentName?: string, subagentId?: string) => {
    if (agentName && aliases.has(agentName)) return aliases.get(agentName)!;
    if (subagentId && aliases.has(subagentId)) return aliases.get(subagentId)!;
    return `agent:${agentName || subagentId || `subagent-${agents.length + 1}`}`;
  };

  const ensureAgent = (
    source: Partial<AgentRunView> & {
      agentName?: string;
      subagentId?: string;
    },
  ) => {
    const agentName = source.agentName || source.subagentId || "subagent";
    const subagentId = source.subagentId || agentName;
    const key = resolveKey(agentName, subagentId);
    let agent = byKey.get(key);
    if (!agent) {
      agent = {
        key,
        subagentId,
        agentName,
        role: source.role,
        task: source.task ?? "",
        calls: [],
        tokenText: "",
        answer: "",
        failed: false,
        error: null,
        done: false,
        status: "pending",
        order: source.order ?? agents.length,
      };
      agents.push(agent);
      byKey.set(key, agent);
    }
    agent.subagentId = source.subagentId || agent.subagentId;
    agent.agentName = source.agentName || agent.agentName;
    agent.role = source.role || agent.role;
    agent.task = source.task || agent.task;
    agent.answer = source.answer || agent.answer;
    agent.rawAnswer = source.rawAnswer ?? agent.rawAnswer;
    agent.failed = source.failed ?? agent.failed;
    agent.error = source.error ?? agent.error;
    agent.maxToolCallsReached =
      source.maxToolCallsReached ?? agent.maxToolCallsReached;
    agent.stopReason = source.stopReason ?? agent.stopReason;
    agent.elapsedMs = source.elapsedMs ?? agent.elapsedMs;
    agent.evidence = source.evidence ?? agent.evidence;
    agent.done = source.done ?? agent.done;
    agent.order = Math.min(agent.order, source.order ?? agent.order);

    registerAlias(agent.agentName, agent.key);
    registerAlias(agent.subagentId, agent.key);
    return agent;
  };

  const mergeResult = (result: SubagentRun, fallbackOrder?: number) => {
    const agent = ensureAgent({
      subagentId: result.subagentId,
      agentName: result.agentName,
      role: result.role,
      task: result.task,
      answer: result.answer,
      rawAnswer: result.rawAnswer,
      failed: result.failed,
      error: result.error,
      maxToolCallsReached: result.maxToolCallsReached,
      stopReason: result.stopReason,
      elapsedMs: result.elapsedMs,
      evidence: result.evidence,
      done: true,
      order: fallbackOrder,
    });
    if (result.answer) agent.answer = result.answer;
  };

  const applyLiveState = () => {
    for (const [key, value] of Object.entries(subagentTokens)) {
      if (!value) continue;
      const agent = ensureAgent({ agentName: key, subagentId: key });
      if (value.length > agent.tokenText.length) {
        agent.tokenText = value;
      }
    }

    for (const [key, done] of Object.entries(subagentDone)) {
      if (!done) continue;
      ensureAgent({ agentName: key, subagentId: key, done: true });
    }

    for (const result of Object.values(subagentResults)) {
      if (!result) continue;
      mergeResult(result);
    }
  };

  return { agents, ensureAgent, mergeResult, applyLiveState };
}

function mergeDelegateResult(
  delegateCall: ToolCall,
  mergeResult: (result: SubagentRun, fallbackOrder?: number) => void,
) {
  const payload = parseJson<DelegatePayload>(delegateCall.result);
  if (!payload) return;

  const results = payload.results ?? {};
  const failed = new Set(payload.failed ?? []);
  const errors = payload.errors ?? {};

  payload.agents?.forEach((agent, index) => {
    const role = agent.role || "research";
    const agentName = agent.agentName || `subagent_${index + 1}`;
    const resultKey = `${role}:${agentName}`;
    mergeResult(
      {
        subagentId: agentName,
        agentName,
        role,
        task: agent.task,
        answer: agent.answer ?? results[resultKey] ?? "",
        rawAnswer: agent.rawAnswer,
        failed: agent.failed ?? failed.has(resultKey),
        error: agent.error ?? errors[resultKey] ?? null,
        maxToolCallsReached: agent.maxToolCallsReached,
        stopReason: agent.stopReason,
        elapsedMs: agent.elapsedMs,
        evidence: agent.evidence ?? payload.evidence?.[resultKey],
      },
      index,
    );
  });

  for (const [key, answer] of Object.entries(results)) {
    const [role = "research", ...nameParts] = key.split(":");
    const agentName = nameParts.join(":") || key;
    mergeResult({
      subagentId: agentName,
      agentName,
      role,
      answer,
      failed: false,
    });
  }

  for (const [key, error] of Object.entries(errors)) {
    const [role = "research", ...nameParts] = key.split(":");
    const agentName = nameParts.join(":") || key;
    mergeResult({
      subagentId: agentName,
      agentName,
      role,
      failed: true,
      error,
    });
  }
}

function buildMultiAgentView(
  toolCalls: ToolCall[],
  subagentTokens: Record<string, string>,
  subagentDone: Record<string, boolean>,
  subagentResults: Record<string, SubagentRun>,
): MultiAgentView {
  const delegateCalls = toolCalls.filter((tc) => tc.name === "delegate_task");
  const directCalls: ToolCall[] = [];
  const { agents, ensureAgent, mergeResult, applyLiveState } = createCollector(
    subagentTokens,
    subagentDone,
    subagentResults,
  );

  delegateCalls.forEach((delegateCall) => {
    const tasks = Array.isArray(delegateCall.args.tasks)
      ? delegateCall.args.tasks
      : [];
    tasks.forEach((rawTask, index) => {
      if (!rawTask || typeof rawTask !== "object") return;
      const spec = rawTask as Record<string, unknown>;
      const role = String(spec.role ?? "research");
      const agentName = String(
        spec.agent_name ?? spec.agentName ?? `${role}_${index + 1}`,
      );
      ensureAgent({
        subagentId: `${agentName}-pending`,
        agentName,
        role,
        task: String(spec.task ?? ""),
        order: index,
      });
    });
    mergeDelegateResult(delegateCall, mergeResult);
  });

  for (const tc of toolCalls) {
    if (tc.name === "delegate_task" || tc.name === "__subagent_answer__") {
      continue;
    }

    const isSubagentCall =
      tc.name === "__subagent_placeholder__" || !!tc.subagentId || !!tc.agentName;

    if (!isSubagentCall) {
      directCalls.push(tc);
      continue;
    }

    const agent = ensureAgent({
      subagentId: tc.subagentId,
      agentName: tc.agentName || tc.displayName || tc.subagentId,
      role: tc.role,
      task: tc.subagentTask || String(tc.args.task ?? ""),
      done: tc.status === "done" && tc.name === "__subagent_placeholder__",
    });

    if (tc.name !== "__subagent_placeholder__") {
      if (!agent.calls.some((item) => item.id === tc.id)) {
        agent.calls.push(tc);
      }
    }
  }

  applyLiveState();

  const finalizedAgents = agents
    .map((agent) => {
      const anyRunning = agent.calls.some((tc) => tc.status === "running");
      const anyError = agent.calls.some((tc) => tc.status === "error" || tc.error);
      const answer = agent.answer;
      const done = agent.done || (!!agent.answer && !agent.failed);
      const hasFinishedToolWork = agent.calls.length > 0 && !anyRunning;
      const status: AgentStatus = agent.failed
        ? "error"
        : anyError
          ? "error"
          : anyRunning
            ? "running"
            : done
              ? "done"
              : hasFinishedToolWork
                ? "summarizing"
                : agent.tokenText
                  ? "running"
                  : "pending";
      return {
        ...agent,
        answer,
        done,
        status,
      };
    })
    .sort((a, b) => a.order - b.order || a.agentName.localeCompare(b.agentName));

  return { delegateCalls, directCalls, agents: finalizedAgents };
}

function StatusIcon({
  status,
  color,
  size = 14,
}: {
  status: AgentStatus;
  color: string;
  size?: number;
}) {
  if (status === "running" || status === "summarizing") {
    return (
      <Loader2
        size={size}
        style={{ color, animation: "spin 1s linear infinite" }}
      />
    );
  }
  if (status === "error") return <AlertCircle size={size} color="#EF4444" />;
  if (status === "done") return <CheckCircle2 size={size} color="#22C55E" />;
  return <Hourglass size={size} color="var(--t3)" />;
}

function ToolCallItem({ tc, compact = false }: { tc: ToolCall; compact?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const meta = getToolMeta(tc);
  const status = statusFromToolCall(tc);
  const argsSummary = getArgsSummary(tc);
  const result = tc.result ?? "";

  return (
    <div
      className="overflow-hidden rounded-lg"
      style={{
        border: "0.5px solid var(--border)",
        background: "var(--panel-bg)",
      }}
    >
      <button
        type="button"
        onClick={() => tc.status !== "running" && setExpanded((value) => !value)}
        className="flex w-full items-center gap-2 px-2.5 py-2 text-left transition-colors"
        style={{ cursor: tc.status === "running" ? "default" : "pointer" }}
        title={meta.label}
      >
        <span className="shrink-0">
          <StatusIcon status={status} color={meta.color} size={13} />
        </span>
        <span
          className="flex shrink-0 items-center gap-1 text-[12px] font-medium"
          style={{ color: meta.color }}
        >
          {meta.icon}
          <span>{meta.label}</span>
        </span>
        {argsSummary && (
          <span
            className="min-w-0 flex-1 truncate text-[12px]"
            style={{ color: "var(--t3)", fontFamily: "var(--font-mono)" }}
          >
            {argsSummary}
          </span>
        )}
        {tc.status !== "running" && (
          <span className="ml-auto shrink-0" style={{ color: "var(--t3)" }}>
            {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </span>
        )}
      </button>

      {expanded && (
        <div
          className={compact ? "px-2.5 pb-2" : "px-3 pb-3"}
          style={{ borderTop: "0.5px solid var(--border)" }}
        >
          <div className="grid gap-2 pt-2">
            <DetailBlock title="参数" tone="muted">
              {safeStringify(tc.args, 2000)}
            </DetailBlock>
            {result && (
              <DetailBlock title={tc.error ? "错误" : "结果"} tone={tc.error ? "error" : "normal"}>
                {result}
              </DetailBlock>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function DetailBlock({
  title,
  children,
  tone,
}: {
  title: string;
  children: string;
  tone: "muted" | "normal" | "error";
}) {
  return (
    <div
      className="rounded-md px-2.5 py-2"
      style={{
        background: "var(--surface-solid)",
        border: "0.5px solid var(--border-faint)",
      }}
    >
      <div
        className="mb-1 text-[11px] font-medium"
        style={{ color: tone === "error" ? "var(--red)" : "var(--t3)" }}
      >
        {title}
      </div>
      <pre
        className="whitespace-pre-wrap break-words text-[12px] leading-relaxed"
        style={{
          color:
            tone === "error" ? "var(--red)" : tone === "muted" ? "var(--t3)" : "var(--t2)",
          fontFamily: "var(--font-mono)",
          maxHeight: 220,
          overflowY: "auto",
        }}
      >
        {children}
      </pre>
    </div>
  );
}

function SummaryPill({ children }: { children: ReactNode }) {
  return (
    <span
      className="inline-flex h-6 items-center rounded-md px-2 text-[11px] font-medium"
      style={{
        background: "var(--control-bg)",
        color: "var(--t3)",
      }}
    >
      {children}
    </span>
  );
}

function getAgentBrief(agent: AgentRunView) {
  if (agent.status === "error") return "失败，展开查看错误和工具明细";
  if (agent.maxToolCallsReached) return "已停止继续搜索，基于已有证据交给 Lead Agent 汇总";
  if (agent.status === "running") return "执行中，结果将交给 Lead Agent 汇总";
  if (agent.status === "summarizing") return "工具已完成，正在整理结果交给 Lead Agent";
  if (agent.status === "done") return "完成，结果已交给 Lead Agent 汇总";
  return "等待执行";
}

function SubagentEvidenceBlock({ agent }: { agent: AgentRunView }) {
  const facts = evidenceList(agent.evidence, "facts");
  const sources = evidenceList(agent.evidence, "sources");
  const missing = evidenceStrings(agent.evidence, "missing_fields");
  const summary = String(agent.evidence?.summary ?? "").trim();
  if (!summary && !facts.length && !sources.length && !missing.length) return null;

  return (
    <div
      className="mt-3 rounded-md px-3 py-2.5"
      style={{
        background: "var(--panel-bg-soft)",
        border: "0.5px solid var(--border-faint)",
      }}
    >
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <span className="text-[12px] font-semibold" style={{ color: "var(--t2)" }}>
          证据摘要
        </span>
        {facts.length > 0 && <SummaryPill>{facts.length} facts</SummaryPill>}
        {sources.length > 0 && <SummaryPill>{sources.length} sources</SummaryPill>}
        {missing.length > 0 && <SummaryPill>{missing.length} missing</SummaryPill>}
      </div>

      {summary && summary !== "No natural-language summary was produced." && (
        <div
          className="mb-2 text-[12px] leading-relaxed"
          style={{ color: "var(--t2)", wordBreak: "break-word" }}
        >
          {summary}
        </div>
      )}

      {facts.length > 0 && (
        <div className="grid gap-1.5">
          {facts.slice(0, 6).map((fact, index) => {
            const label = evidenceText(fact, "label") || evidenceText(fact, "field") || "事实";
            const value = evidenceText(fact, "value");
            const timeText = evidenceText(fact, "time");
            const source =
              evidenceText(fact, "source_title") || evidenceText(fact, "source_url");
            return (
              <div
                key={`${label}:${value}:${index}`}
                className="rounded-md px-2.5 py-1.5 text-[12px] leading-relaxed"
                style={{
                  background: "var(--surface-solid)",
                  border: "0.5px solid var(--border-faint)",
                  color: "var(--t2)",
                }}
              >
                <span className="font-medium" style={{ color: "var(--t1)" }}>
                  {label}
                </span>
                {value && <span>：{value}</span>}
                {(timeText || source) && (
                  <span style={{ color: "var(--t3)" }}>
                    {" "}
                    {timeText}
                    {timeText && source ? " · " : ""}
                    {source}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {facts.length === 0 && sources.length > 0 && (
        <div className="grid gap-1.5">
          {sources.slice(0, 4).map((source, index) => {
            const title = evidenceText(source, "title") || evidenceText(source, "url");
            const snippet = evidenceText(source, "snippet");
            return (
              <div
                key={`${title}:${index}`}
                className="rounded-md px-2.5 py-1.5 text-[12px] leading-relaxed"
                style={{
                  background: "var(--surface-solid)",
                  border: "0.5px solid var(--border-faint)",
                  color: "var(--t2)",
                }}
              >
                <span className="font-medium" style={{ color: "var(--t1)" }}>
                  {title || "来源"}
                </span>
                {snippet && <span>：{snippet}</span>}
              </div>
            );
          })}
        </div>
      )}

      {missing.length > 0 && (
        <div className="mt-2 text-[12px]" style={{ color: "var(--t3)" }}>
          未确认：{missing.slice(0, 6).join("、")}
        </div>
      )}
    </div>
  );
}

function SubagentDebugBlock({ agent }: { agent: AgentRunView }) {
  const [collapsed, setCollapsed] = useState(true);
  const content = agent.error || agent.rawAnswer || "";
  if (!content) return null;

  return (
    <div
      className="mt-3 overflow-hidden rounded-md"
      style={{
        background: agent.failed
          ? "rgba(239,68,68,0.08)"
          : "var(--panel-bg-soft)",
        border: `0.5px solid ${agent.failed ? "rgba(239,68,68,0.24)" : "var(--border-faint)"}`,
      }}
    >
      <button
        type="button"
        onClick={() => setCollapsed((value) => !value)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <span
          className="text-[12px] font-medium"
          style={{ color: agent.failed ? "var(--red)" : "var(--t2)" }}
        >
          {agent.failed ? "失败原因" : "原始调试输出"}
        </span>
        <SummaryPill>{agent.failed ? "error" : "debug"}</SummaryPill>
        {agent.maxToolCallsReached && <SummaryPill>tool budget</SummaryPill>}
        <span className="ml-auto" style={{ color: "var(--t3)" }}>
          {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        </span>
      </button>
      {!collapsed && (
        <div
          className="px-3 pb-3"
          style={{ borderTop: "0.5px solid var(--border-faint)" }}
        >
          <div
            className="markdown pt-2 text-[13px] leading-relaxed"
            style={{
              color: agent.failed ? "var(--red)" : "var(--t2)",
              wordBreak: "break-word",
            }}
          >
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
}

function SubagentAnswerBlock({ agent }: { agent: AgentRunView }) {
  const content = agent.answer;
  if (!content || hasEvidenceDetails(agent.evidence)) return null;

  return (
    <div
      className="mt-3 rounded-md px-3 py-2.5"
      style={{
        background: "var(--panel-bg-soft)",
        border: "0.5px solid var(--border-faint)",
      }}
    >
      <div className="mb-1 text-[12px] font-semibold" style={{ color: "var(--t2)" }}>
        结果摘要
      </div>
      <div
        className="markdown text-[13px] leading-relaxed"
        style={{ color: "var(--t2)", wordBreak: "break-word" }}
      >
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      </div>
    </div>
  );
}

function SubagentRunItem({ agent }: { agent: AgentRunView }) {
  const [collapsed, setCollapsed] = useState(true);
  const roleMeta = getRoleMeta(agent.role);
  const hasDetails =
    agent.answer ||
    agent.rawAnswer ||
    agent.error ||
    agent.calls.length > 0 ||
    agent.maxToolCallsReached ||
    hasEvidenceDetails(agent.evidence);

  return (
    <div
      className="rounded-lg"
      style={{
        border: "0.5px solid var(--border)",
        background: "var(--surface-solid)",
      }}
    >
      <button
        type="button"
        onClick={() => hasDetails && setCollapsed((value) => !value)}
        className="flex w-full items-start gap-2 px-3 py-2.5 text-left"
        style={{ cursor: hasDetails ? "pointer" : "default" }}
      >
        <span
          className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
          style={{ background: roleMeta.tint, color: roleMeta.color }}
        >
          {roleMeta.icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold"
              style={{ color: roleMeta.color, background: roleMeta.tint }}
            >
              {roleMeta.label}
            </span>
            <span
              className="truncate text-[13px] font-semibold"
              style={{ color: "var(--t1)" }}
            >
              {agent.agentName}
            </span>
            <span
              className="inline-flex items-center gap-1 text-[11px]"
              style={{ color: agent.status === "error" ? "var(--red)" : "var(--t3)" }}
            >
              <StatusIcon status={agent.status} color={roleMeta.color} size={12} />
              {STATUS_COPY[agent.status]}
            </span>
          </div>
          {agent.task && (
            <div
              className="mt-1 text-[12px] leading-relaxed"
              style={{
                color: "var(--t3)",
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {agent.task}
            </div>
          )}
          <div className="mt-1 text-[11px]" style={{ color: "var(--t3)" }}>
            {getAgentBrief(agent)}
          </div>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {agent.calls.length > 0 && <SummaryPill>{agent.calls.length} tools</SummaryPill>}
          {agent.maxToolCallsReached && <SummaryPill>budget</SummaryPill>}
          {agent.elapsedMs !== undefined && (
            <SummaryPill>{formatElapsed(agent.elapsedMs)}</SummaryPill>
          )}
          {hasDetails && (
            <span style={{ color: "var(--t3)" }}>
              {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
            </span>
          )}
        </div>
      </button>

      {!collapsed && hasDetails && (
        <div
          className="grid gap-2 px-3 pb-3"
          style={{ borderTop: "0.5px solid var(--border-faint)" }}
        >
          {agent.maxToolCallsReached && (
            <div
              className="mt-3 rounded-md px-3 py-2 text-[12px] leading-relaxed"
              style={{
                background: "rgba(245,158,11,0.12)",
                border: "0.5px solid rgba(245,158,11,0.24)",
                color: "#F59E0B",
              }}
            >
              已停止继续调用工具，并基于已有搜索证据交给 Lead Agent 汇总。
            </div>
          )}
          <SubagentEvidenceBlock agent={agent} />
          <SubagentAnswerBlock agent={agent} />

          {agent.calls.length > 0 && (
            <div className="grid gap-1.5 pt-3">
              {agent.calls.map((tc) => (
                <ToolCallItem key={`${agent.key}:${tc.id}`} tc={tc} compact />
              ))}
            </div>
          )}
          <SubagentDebugBlock agent={agent} />
        </div>
      )}
    </div>
  );
}

function MultiAgentBoard({ view }: { view: MultiAgentView }) {
  const [collapsed, setCollapsed] = useState(true);
  const running = view.agents.filter((agent) => agent.status === "running").length;
  const failed = view.agents.filter((agent) => agent.status === "error").length;
  const done = view.agents.filter((agent) => agent.status === "done").length;
  const totalTools =
    view.directCalls.length +
    view.agents.reduce((count, agent) => count + agent.calls.length, 0);

  return (
    <div
      className="mb-3 overflow-hidden rounded-lg"
      style={{
        border: "0.5px solid var(--border)",
        background: "var(--panel-bg-raised)",
        boxShadow: "0 10px 26px rgba(0,0,0,0.08)",
      }}
    >
      <button
        type="button"
        onClick={() => setCollapsed((value) => !value)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
      >
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
          style={{
            background: "rgba(37,99,235,0.12)",
            color: "#2563EB",
          }}
        >
          <BrainCircuit size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className="text-[13px] font-semibold"
              style={{ color: "var(--t1)" }}
            >
              Lead Agent 调度
            </span>
            <SummaryPill>{view.agents.length} agents</SummaryPill>
            {totalTools > 0 && <SummaryPill>{totalTools} tools</SummaryPill>}
            {running > 0 && <SummaryPill>{running} running</SummaryPill>}
            {failed > 0 && <SummaryPill>{failed} failed</SummaryPill>}
            {done > 0 && <SummaryPill>{done} done</SummaryPill>}
          </div>
          <div className="mt-0.5 truncate text-[12px]" style={{ color: "var(--t3)" }}>
            {view.delegateCalls.length > 0
              ? getArgsSummary(view.delegateCalls[0])
              : "子 Agent 执行链"}
          </div>
        </div>
        <span style={{ color: "var(--t3)" }}>
          {collapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
        </span>
      </button>

      {!collapsed && (
        <div className="grid gap-2 px-3 pb-3">
          {view.agents.map((agent) => (
            <SubagentRunItem key={agent.key} agent={agent} />
          ))}
          {view.directCalls.length > 0 && (
            <DirectToolsSection title="Lead Agent 补查/兜底工具" calls={view.directCalls} />
          )}
        </div>
      )}
    </div>
  );
}

function DirectToolsSection({
  title,
  calls,
}: {
  title: string;
  calls: ToolCall[];
}) {
  const [collapsed, setCollapsed] = useState(true);
  if (calls.length === 0) return null;

  return (
    <div
      className="rounded-lg"
      style={{
        border: "0.5px solid var(--border)",
        background: "var(--surface-solid)",
      }}
    >
      <button
        type="button"
        onClick={() => setCollapsed((value) => !value)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <span
          className="flex h-6 w-6 items-center justify-center rounded-md"
          style={{ background: "rgba(100,116,139,0.12)", color: "#64748B" }}
        >
          <Bot size={13} />
        </span>
        <span className="text-[12px] font-semibold" style={{ color: "var(--t1)" }}>
          {title}
        </span>
        <SummaryPill>{calls.length} tools</SummaryPill>
        <span className="ml-auto" style={{ color: "var(--t3)" }}>
          {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        </span>
      </button>
      {!collapsed && (
        <div className="grid gap-1.5 px-3 pb-3">
          {calls.map((tc) => (
            <ToolCallItem key={tc.id} tc={tc} compact />
          ))}
        </div>
      )}
    </div>
  );
}

interface ToolCallDisplayProps {
  toolCalls?: ToolCall[];
  subagentTokens?: Record<string, string>;
  subagentDone?: Record<string, boolean>;
  subagentResults?: Record<string, SubagentRun>;
}

export function ToolCallDisplay({
  toolCalls = [],
  subagentTokens = {},
  subagentDone = {},
  subagentResults = {},
}: ToolCallDisplayProps) {
  const visibleToolCalls = useMemo(
    () => toolCalls.filter(isVisibleToolCall),
    [toolCalls],
  );
  const view = useMemo(
    () =>
      buildMultiAgentView(
        visibleToolCalls,
        subagentTokens,
        subagentDone,
        subagentResults,
      ),
    [visibleToolCalls, subagentTokens, subagentDone, subagentResults],
  );

  const hasLiveSubagents =
    Object.keys(subagentTokens).length > 0 ||
    Object.keys(subagentDone).length > 0 ||
    Object.keys(subagentResults).length > 0;
  const hasMultiAgent = view.delegateCalls.length > 0 || view.agents.length > 0;
  const directOnlyCalls = view.directCalls.filter(
    (tc) => tc.name !== "__subagent_placeholder__",
  );

  if (!visibleToolCalls.length && !hasLiveSubagents) return null;

  return (
    <div className="mb-2">
      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes blink { 0%,100% { opacity:1; } 50% { opacity:0; } }
      `}</style>
      {hasMultiAgent ? (
        <MultiAgentBoard view={view} />
      ) : (
        <div className="grid gap-1.5">
          {directOnlyCalls.map((tc) => (
            <ToolCallItem key={tc.id} tc={tc} />
          ))}
        </div>
      )}
    </div>
  );
}
