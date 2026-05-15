"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { Plus, Trash2, Send, Square, PenSquare, Sparkles } from "lucide-react";
import { streamChat } from "@/hooks/useStream";
import { API_BASE } from "@/lib/backend";
import { useSettingsStore } from "@/stores/settingsStore";
import { useWindowStore } from "@/stores/windowStore";
import { decodeModel, PROVIDERS } from "@/apps/settings/providers";
import { MessageBubble } from "./MessageBubble";
import { ModelPicker } from "./ModelPicker";
import { shouldSuppressDuplicateSubmit } from "./chatSendGate";
import { scrollMessagesToBottom } from "./scrolling";
import { isInternalToolEvent, isVisibleToolCall } from "./toolCallVisibility";
import type { AppWorkflowSummary, ChatMessage, Conversation } from "./types";

const API = `${API_BASE}/agents`;

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

const QUICK_PROMPTS = [
  { icon: "✍️", label: "帮我写作", prompt: "帮我写一篇关于" },
  { icon: "💡", label: "头脑风暴", prompt: "帮我想想关于" },
  { icon: "🔍", label: "解释概念", prompt: "请解释一下" },
  { icon: "💻", label: "写代码", prompt: "帮我写一段代码，实现" },
];

type AppIntent = {
  appId: string;
  title: string;
  icon: string;
  keywords: string[];
  appState?: Record<string, unknown>;
  reply: string;
};

const APP_INTENTS: AppIntent[] = [
  {
    appId: "mail",
    title: "邮件",
    icon: "Mail",
    keywords: ["邮件", "邮箱", "收件箱", "发件箱", "草稿箱", "未读", "附件"],
    appState: { activeFolder: "inbox", source: "ai-chat" },
    reply:
      "已为你打开系统邮件。你可以在邮件 App 中同步收件箱、查看未读邮件和处理附件。",
  },
  {
    appId: "calendar",
    title: "日历",
    icon: "Calendar",
    keywords: ["日历", "日程", "会议", "行程", "待办"],
    reply: "已为你打开日历。你可以查看今天日程或继续新建事件。",
  },
  {
    appId: "browser",
    title: "浏览器",
    icon: "Globe",
    keywords: ["浏览器", "网页"],
    reply: "已为你打开浏览器。",
  },
  {
    appId: "file-manager",
    title: "文件管理器",
    icon: "FolderOpen",
    keywords: ["文件", "文件管理器", "目录"],
    reply: "已为你打开文件管理器。",
  },
  {
    appId: "notes",
    title: "笔记",
    icon: "FileText",
    keywords: ["笔记", "备忘录"],
    reply: "已为你打开笔记。",
  },
  {
    appId: "document-editor",
    title: "文档",
    icon: "FilePenLine",
    keywords: ["文档", "富文本"],
    reply: "已为你打开文档。",
  },
  {
    appId: "whiteboard",
    title: "白板",
    icon: "PenTool",
    keywords: ["白板", "画布"],
    reply: "已为你打开白板。",
  },
  {
    appId: "terminal",
    title: "终端",
    icon: "Terminal",
    keywords: ["终端", "命令行"],
    reply: "已为你打开终端。",
  },
  {
    appId: "settings",
    title: "设置",
    icon: "Settings",
    keywords: ["设置", "系统设置"],
    reply: "已为你打开设置。",
  },
];

const RISKY_ACTION_PATTERNS = [
  /删除/,
  /清空/,
  /覆盖/,
  /重置/,
  /永久/,
  /批量.*(改写|删除|发送|移动)/,
  /发送.*邮件/,
  /发.*邮件/,
  /发出.*回复/,
];

function findAppIntent(input: string) {
  const text = input.trim();
  const isLaunchCommand = /^(打开|启动|进入|切到|切换到)/.test(text);
  return (
    APP_INTENTS.find((item) => {
      const exactMatch =
        item.title === text ||
        item.keywords.some((keyword) => keyword === text);
      const launchMatch =
        isLaunchCommand &&
        item.keywords.some((keyword) => text.includes(keyword));
      const appTaskMatch =
        item.appId !== "browser" &&
        item.keywords.some((keyword) => text.includes(keyword));
      return exactMatch || launchMatch || appTaskMatch;
    }) ?? null
  );
}

function findAppSearchResults(input: string) {
  const text = input.trim();
  if (!text) return [];
  return APP_INTENTS.filter((item) =>
    [item.title, ...item.keywords].some(
      (value) => value.includes(text) || text.includes(value),
    ),
  ).slice(0, 4);
}

function needsExecutionConfirmation(input: string) {
  return RISKY_ACTION_PATTERNS.some((pattern) => pattern.test(input));
}

function isCurrentTimeIntent(input: string) {
  const text = input.trim();
  if (!text) return false;
  return [
    /^(现在|当前)?几[点时]了?$/,
    /^(现在|当前)?时间$/,
    /^(现在|当前)是什么时间$/,
    /^今天(几号|日期|星期几|周几)$/,
    /^今天是什么(日期|日子|星期|周几)$/,
  ].some((pattern) => pattern.test(text));
}

function buildCurrentTimeReply() {
  const now = new Date();
  const date = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(now);
  const time = new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(now);
  return `现在是 ${date} ${time}。`;
}

function extractBrowserSessionId(
  toolName: string,
  args: Record<string, unknown>,
  result: string,
) {
  const directSessionId = String(args.session_id ?? "").trim();
  if (directSessionId) return directSessionId;

  if (toolName === "browser_create_session") {
    const match = /已创建浏览器会话[:：]\s*([^\s，,。；;]+)/.exec(result);
    if (match?.[1]) return match[1];
  }

  return "";
}

function getToolEventKey(event: {
  id: string;
  subagentId?: string;
  agentName?: string;
}) {
  const owner = event.subagentId || event.agentName;
  if (!owner) return event.id;
  if (event.id.startsWith(`${owner}::`)) return event.id;
  return `${owner}::${event.id}`;
}

type MessageListProps = {
  messages: ChatMessage[];
  statusText: string;
  bottomRef: RefObject<HTMLDivElement | null>;
  onRetryMessage: (userContent: string, retryHistory: ChatMessage[]) => void;
};

const MessageList = memo(function MessageList({
  messages,
  statusText,
  bottomRef,
  onRetryMessage,
}: MessageListProps) {
  return (
    <div className="py-4 mx-auto w-full" style={{ maxWidth: 720 }}>
      <div className="relative h-7 mb-1">
        {statusText && (
          <div
            className="absolute left-4 top-0 flex items-center gap-1.5 px-3 py-1 rounded-full text-[12px] pointer-events-none"
            style={{
              background: "var(--control-bg)",
              color: "var(--t3)",
              whiteSpace: "nowrap",
            }}
          >
            <span
              className="inline-block w-1.5 h-1.5 rounded-full"
              style={{ background: "var(--accent)" }}
            />
            {statusText}
          </div>
        )}
      </div>
      {messages.map((msg, idx) => {
        const onRetry =
          msg.role === "assistant" || msg.role === "error"
            ? () => {
                let userIdx = idx - 1;
                while (userIdx >= 0 && messages[userIdx].role !== "user") {
                  userIdx--;
                }
                if (userIdx < 0) return;
                const userContent = messages[userIdx].content;
                const retryHistory = messages.slice(0, userIdx);
                onRetryMessage(userContent, retryHistory);
              }
            : undefined;
        return <MessageBubble key={msg.id} message={msg} onRetry={onRetry} />;
      })}
      <div ref={bottomRef} />
    </div>
  );
});

export function AiChat() {
  const { providers, defaultModel, setDefaultModel, embeddingConfig } =
    useSettingsStore();
  const openWindow = useWindowStore((state) => state.openWindow);
  const updateAppState = useWindowStore((state) => state.updateAppState);

  const getInitialModel = () => {
    if (defaultModel) return defaultModel;
    for (const p of PROVIDERS) {
      const models = providers[p.id]?.enabledModels;
      if (providers[p.id]?.apiKey && models?.length) {
        return `${p.id}::${models[0]}`;
      }
    }
    return "";
  };

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [selectedModel, setSelectedModel] = useState(getInitialModel);
  const [loading, setLoading] = useState(false);
  const [statusText, setStatusText] = useState<string>("");
  const [pendingConfirmation, setPendingConfirmation] = useState("");
  const [hitlDialog, setHitlDialog] = useState<{
    requestId: string;
    toolName: string;
    args: Record<string, unknown>;
  } | null>(null);
  const [queuedMessage, setQueuedMessage] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const inFlightContentRef = useRef<string | null>(null);
  const queuedMessageRef = useRef<string | null>(null);
  const liveToolArgsRef = useRef<Record<string, Record<string, unknown>>>({});
  const pendingBrowserWindowTimersRef = useRef<Record<string, number>>({});
  const scrollBehaviorRef = useRef<"smooth" | "instant">("instant");
  const userScrolledUpRef = useRef(false);
  const inputRef = useRef("");

  useEffect(() => {
    inputRef.current = input;
  }, [input]);

  const setInputValue = useCallback((value: string) => {
    inputRef.current = value;
    setInput(value);
  }, []);

  const clearPendingBrowserWindowOpen = useCallback((sessionId: string) => {
    const timerId = pendingBrowserWindowTimersRef.current[sessionId];
    if (typeof timerId !== "number") return;
    window.clearTimeout(timerId);
    delete pendingBrowserWindowTimersRef.current[sessionId];
  }, []);

  const commitBrowserWindowOpen = useCallback(
    (sessionId: string, url?: string) => {
      const nextAppState: Record<string, unknown> = {
        activeSessionId: sessionId,
      };
      if (url?.trim()) {
        nextAppState.urlInput = url.trim();
      }

      const windowId = openWindow("browser", "浏览器", "Globe", {
        singleton: false,
        instanceKey: `browser-session:${sessionId}`,
        appState: nextAppState,
      });
      updateAppState(windowId, nextAppState);
    },
    [openWindow, updateAppState],
  );

  const syncBrowserWindowFromTool = useCallback(
    (
      toolName: string,
      args: Record<string, unknown>,
      result: string,
      error: boolean,
    ) => {
      if (error || !toolName.startsWith("browser_")) return;

      const sessionId = extractBrowserSessionId(toolName, args, result);
      if (!sessionId) return;

      if (toolName === "browser_close_session") {
        clearPendingBrowserWindowOpen(sessionId);
        return;
      }

      const url = String(args.url ?? "").trim();
      if (toolName === "browser_create_session" && !url) {
        clearPendingBrowserWindowOpen(sessionId);
        pendingBrowserWindowTimersRef.current[sessionId] = window.setTimeout(
          () => {
            delete pendingBrowserWindowTimersRef.current[sessionId];
            commitBrowserWindowOpen(sessionId);
          },
          450,
        );
        return;
      }

      clearPendingBrowserWindowOpen(sessionId);
      commitBrowserWindowOpen(sessionId, url);
    },
    [clearPendingBrowserWindowOpen, commitBrowserWindowOpen],
  );

  const openAppIntent = useCallback(
    (intent: AppIntent) => {
      const windowId = openWindow(intent.appId, intent.title, intent.icon, {
        singleton: true,
        appState: intent.appState,
      });
      if (intent.appState) {
        updateAppState(windowId, intent.appState);
      }
    },
    [openWindow, updateAppState],
  );

  const loadConversations = useCallback(async () => {
    try {
      const data = await apiFetch<Conversation[]>(
        "/conversations?app_id=ai-chat",
      );
      setConversations(data);
    } catch {}
  }, []);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    return () => {
      for (const timerId of Object.values(
        pendingBrowserWindowTimersRef.current,
      )) {
        window.clearTimeout(timerId);
      }
      pendingBrowserWindowTimersRef.current = {};
    };
  }, []);

  const loadMessages = useCallback(async (convId: string) => {
    try {
      scrollBehaviorRef.current = "instant";
      const data = await apiFetch<
        {
          id: string;
          role: string;
          content: string | null;
          reasoning_content?: string | null;
          tool_calls:
            | {
                id: string;
                name: string;
                displayName?: string | null;
                args: Record<string, unknown>;
                result?: string | null;
                error?: boolean | null;
                internal?: boolean | null;
                skipped?: boolean | null;
                skipReason?: string | null;
                displayResult?: string | null;
                subagentId?: string | null;
                subagentTask?: string | null;
                agentName?: string | null;
                role?: string | null;
              }[]
            | null;
          tool_call_id: string | null;
        }[]
      >(`/conversations/${convId}/messages`);

      // tool 消息结果 map：tool_call_id -> contents。旧版子 Agent 可能在不同
      // worker 内生成相同 tool_call_id，这里保留队列，按 tool_calls 顺序消费。
      const toolResultMap: Record<string, string[]> = {};
      data
        .filter((m) => m.role === "tool")
        .forEach((m) => {
          if (!m.tool_call_id) return;
          toolResultMap[m.tool_call_id] = toolResultMap[m.tool_call_id] ?? [];
          toolResultMap[m.tool_call_id].push(m.content ?? "");
        });

      // 过滤 role=tool 的中间消息，只展示 user/assistant
      const visible = data.filter(
        (m) => m.role === "user" || m.role === "assistant",
      );
      setMessages(
        visible.map((m) => {
          const rawCalls = m.tool_calls ?? [];
          const resultIndexById: Record<string, number> = {};
          const normalizedCalls = rawCalls.map((tc) => {
            const index = resultIndexById[tc.id] ?? 0;
            resultIndexById[tc.id] = index + 1;
            const result = toolResultMap[tc.id]?.[index] ?? tc.result ?? undefined;
            return {
              id: getToolEventKey({
                id: tc.id,
                subagentId: tc.subagentId ?? undefined,
                agentName: tc.agentName ?? undefined,
              }),
              name: tc.name,
              displayName: tc.displayName ?? null,
              args: tc.args,
              result,
              error: tc.error ?? false,
              internal: tc.internal ?? false,
              skipped: tc.skipped ?? false,
              skipReason: tc.skipReason ?? undefined,
              displayResult: tc.displayResult ?? undefined,
              status: "done" as const,
              subagentId: tc.subagentId ?? undefined,
              subagentTask: tc.subagentTask ?? undefined,
              agentName: tc.agentName ?? undefined,
              role: tc.role ?? undefined,
            };
          }).filter(isVisibleToolCall);

          return {
            id: m.id,
            role: m.role as ChatMessage["role"],
            content: m.content ?? "",
            reasoningContent: m.reasoning_content ?? undefined,
            toolCalls: normalizedCalls,
          };
        }),
      );
    } catch {}
  }, []);

  const selectConversation = useCallback(
    async (convId: string) => {
      setActiveId(convId);
      await loadMessages(convId);
    },
    [loadMessages],
  );

  const newConversation = useCallback(() => {
    setActiveId(null);
    setMessages([]);
  }, []);

  const deleteConversation = useCallback(
    async (convId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      try {
        await apiFetch(`/conversations/${convId}`, { method: "DELETE" });
        setConversations((prev) => prev.filter((c) => c.id !== convId));
        if (activeId === convId) {
          setActiveId(null);
          setMessages([]);
        }
      } catch {}
    },
    [activeId],
  );

  useEffect(() => {
    if (!userScrolledUpRef.current) {
      scrollMessagesToBottom(
        scrollContainerRef.current,
        scrollBehaviorRef.current,
      );
    }
  }, [messages]);

  const handleScroll = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    // 距离底部超过 80px 视为用户正在向上滚动
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    userScrolledUpRef.current = !atBottom;
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const nextInput = e.target.value;
    setInputValue(nextInput);
    if (pendingConfirmation && nextInput.trim() !== pendingConfirmation) {
      setPendingConfirmation("");
    }
    e.target.style.height = "auto";
    e.target.style.height = Math.min(e.target.scrollHeight, 200) + "px";
  };

  const stopGeneration = () => {
    abortRef.current?.abort();
  };

  // 后端重启后会重新初始化记忆管理器。
  const sendMessage = useCallback(
    async (text?: string, historyOverride?: ChatMessage[]) => {
      const content = (text ?? inputRef.current).trim();
      if (!content) return;

      const hasActiveRequest = Boolean(inFlightContentRef.current) || loading;
      if (hasActiveRequest && !historyOverride) {
        if (
          shouldSuppressDuplicateSubmit({
            content,
            inFlightContent: inFlightContentRef.current,
            queuedContent: queuedMessageRef.current,
          })
        ) {
          setStatusText("已忽略重复发送的相同消息。");
          return;
        }

        queuedMessageRef.current = content;
        setQueuedMessage(content);
        setInputValue("");
        if (textareaRef.current) textareaRef.current.style.height = "auto";
        setStatusText("消息已排队，上一轮完成后自动发送。");
        return;
      }

      if (isCurrentTimeIntent(content)) {
        setInputValue("");
        if (textareaRef.current) {
          textareaRef.current.style.height = "auto";
        }
        scrollBehaviorRef.current = "smooth";
        userScrolledUpRef.current = false;
        setStatusText("");
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "user",
            content,
          },
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: buildCurrentTimeReply(),
            streaming: false,
          },
        ]);
        return;
      }

      if (
        needsExecutionConfirmation(content) &&
        pendingConfirmation !== content
      ) {
        setPendingConfirmation(content);
        setStatusText("检测到高风险操作，请确认后继续。");
        return;
      }

      setPendingConfirmation("");

      const appIntent = findAppIntent(content);
      if (appIntent) {
        openAppIntent(appIntent);
        setInputValue("");
        if (textareaRef.current) {
          textareaRef.current.style.height = "auto";
        }
        scrollBehaviorRef.current = "smooth";
        userScrolledUpRef.current = false;
        setStatusText("");
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "user",
            content,
          },
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: appIntent.reply,
            streaming: false,
          },
        ]);
        return;
      }

      if (!selectedModel) {
        setStatusText("请先选择模型。");
        return;
      }

      const { providerId, modelId } = decodeModel(selectedModel);
      const providerCfg = providers[providerId];
      const providerDef = PROVIDERS.find((p) => p.id === providerId);
      if (!providerCfg?.apiKey) return;

      const apiKey = providerCfg.apiKey;
      const apiBase = providerCfg.baseUrl || providerDef?.defaultBaseUrl;
      inFlightContentRef.current = content;

      let convId = activeId;
      if (!convId) {
        try {
          const conv = await apiFetch<Conversation>("/conversations", {
            method: "POST",
            body: JSON.stringify({ title: "新对话", model: modelId }),
          });
          setConversations((prev) => [conv, ...prev]);
          setActiveId(conv.id);
          convId = conv.id;
        } catch {
          inFlightContentRef.current = null;
          return;
        }
      }

      setInputValue("");
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
      setLoading(true);
      scrollBehaviorRef.current = "smooth";
      userScrolledUpRef.current = false;

      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content,
      };
      const assistantId = crypto.randomUUID();
      const assistantMsg: ChatMessage = {
        id: assistantId,
        role: "assistant",
        content: "",
        streaming: true,
      };
      setMessages((prev) => [...prev, userMsg, assistantMsg]);

      // Build history with full tool_calls context so the LLM sees prior
      // tool interactions across conversation turns (OpenAI/Anthropic format).
      const history: Record<string, unknown>[] = [];
      const historySource = historyOverride ?? messages;
      for (const m of historySource) {
        if (m.role !== "user" && m.role !== "assistant") {
          continue;
        }
        if (m.role === "assistant" && m.streaming) {
          continue;
        }
        if (m.role === "assistant") {
          // Exclude sub-agent tool calls (agentName is set): they belong to sub-agents
          // and were never issued by the main LLM directly.
          const completedCalls = (m.toolCalls ?? []).filter(
            (tc) => tc.status === "done" && tc.result != null && !tc.agentName,
          );
          if (completedCalls.length > 0) {
            // assistant message with tool_calls
            const assistantHistory: Record<string, unknown> = {
              role: "assistant",
              content: m.content || null,
              tool_calls: completedCalls.map((tc) => ({
                id: tc.id,
                type: "function",
                function: {
                  name: tc.name,
                  arguments: JSON.stringify(tc.args ?? {}),
                },
              })),
            };
            if (m.reasoningContent?.trim()) {
              assistantHistory.reasoning_content = m.reasoningContent;
            }
            history.push(assistantHistory);
            // corresponding tool result messages
            for (const tc of completedCalls) {
              history.push({
                role: "tool",
                tool_call_id: tc.id,
                content: tc.result ?? "",
              });
            }
          } else {
            if (m.content.trim()) {
              const assistantHistory: Record<string, unknown> = {
                role: "assistant",
                content: m.content,
              };
              if (m.reasoningContent?.trim()) {
                assistantHistory.reasoning_content = m.reasoningContent;
              }
              history.push(assistantHistory);
            }
          }
        } else {
          history.push({ role: m.role, content: m.content });
        }
      }
      const abort = new AbortController();
      abortRef.current = abort;

      try {
        const { title, usageEstimate } = await streamChat(
          {
            conversationId: convId,
            appId: "ai-chat",
            message: content,
            model: modelId,
            providerId,
            history,
            systemPrompt:
              "你是 AI-Web OS 的 AI 助手。你可以理解用户意图，必要时使用工具操作浏览器、文件、知识库或其他系统能力。邮件、日历、文件、文档、笔记、白板等属于系统内置 App 的能力，不能用浏览器或第三方网页服务替代；如果用户要处理这些系统能力，应引导用户使用对应 App。回答要简洁，涉及危险操作前应先说明计划并等待用户确认。当用户同时询问多个互相独立的事项时，可以用 delegate_task 并行处理。",
            apiKey,
            apiBase,
            enableMemory: true,
            compatType: providerCfg.compatType ?? "openai",
            embeddingConfig: embeddingConfig ?? undefined,
            llmApiKey: apiKey,
            llmApiBase: apiBase,
            onStatus: (s, event) => {
              if (s === "plan_preview") {
                const steps = Array.isArray(event?.steps) ? event.steps.length : 0;
                setStatusText(
                  steps > 0
                    ? `已生成执行计划预览（${steps} 步），风险操作会先请求确认。`
                    : "已生成执行计划预览，风险操作会先请求确认。",
                );
              } else if (s === "workflow_plan" || s === "workflow_summary") {
                if (!event) return;
                const summary = event as unknown as AppWorkflowSummary;
                if (s === "workflow_plan") {
                  setStatusText(
                    `已生成多 App 工作流计划（${summary.appCount ?? 0} 个 App）。`,
                  );
                } else {
                  setStatusText("已生成多 App 执行结果汇总。");
                }
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId
                      ? {
                          ...m,
                          workflowSummary: summary,
                        }
                      : m,
                  ),
                );
              } else if (s === "recalled") {
                setStatusText("已召回相关记忆，正在组织回答…");
              } else if (s === "context_compacted") {
                setStatusText("已压缩较早上下文，正在继续回答…");
              } else if (s === "graph_node") {
                if (event?.node === "validate_result" && event?.error) {
                  setStatusText("工具结果未通过校验，正在让模型修正…");
                } else if (event?.node === "respond") {
                  setStatusText("");
                } else {
                  setStatusText("正在按执行链路推进任务…");
                }
              } else if (s === "tool_policy") {
                if (event?.decision === "skipped") {
                  setStatusText("已有结果足够，已跳过不必要的补充工具…");
                } else {
                  setStatusText("已拦截一次不合规工具调用，正在修正…");
                }
              } else if (s === "usage_estimate") {
                setStatusText("已完成 Token 估算，正在收尾…");
              }
            },
            onReasoningToken: (token) => {
              setStatusText("模型正在思考…");
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? {
                        ...m,
                        reasoningContent: `${m.reasoningContent ?? ""}${token}`,
                      }
                    : m,
                ),
              );
            },
            onToken: (token) => {
              setStatusText("");
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, content: m.content + token }
                    : m,
                ),
              );
            },
            onToolCall: (event) => {
              setStatusText("");
              if (isInternalToolEvent({ ...event, result: undefined, error: false })) {
                return;
              }
              const toolEventKey = getToolEventKey(event);
              liveToolArgsRef.current[toolEventKey] = event.args;
              setMessages((prev) =>
                prev.map((m) => {
                  if (m.id !== assistantId) return m;
                  const existing = m.toolCalls ?? [];
                  const alreadyExists = existing.some(
                    (tc) => tc.id === toolEventKey,
                  );
                  if (alreadyExists) {
                    return {
                      ...m,
                      toolCalls: existing.map((tc) =>
                        tc.id === toolEventKey
                          ? {
                              ...tc,
                              args: event.args,
                              displayName: event.displayName ?? tc.displayName,
                              internal: event.internal ?? tc.internal,
                              skipped: event.skipped ?? tc.skipped,
                              skipReason: event.skipReason ?? tc.skipReason,
                              displayResult: event.displayResult ?? tc.displayResult,
                            }
                          : tc,
                      ),
                    };
                  }
                  // When delegate_task is called, pre-insert placeholder cards for each sub-task
                  const extraPlaceholders: typeof existing = [];
                  if (event.name === "delegate_task") {
                    const tasks = (event.args.tasks ?? []) as {
                      task: string;
                      role?: string;
                      agent_name?: string;
                      agentName?: string;
                    }[];
                    for (const spec of tasks) {
                      const agentName =
                        spec.agent_name ?? spec.agentName ?? "subagent";
                      const placeholderId = `placeholder:${agentName}:${event.id}`;
                      if (!existing.some((tc) => tc.id === placeholderId)) {
                        extraPlaceholders.push({
                          id: placeholderId,
                          name: "__subagent_placeholder__",
                          displayName: agentName,
                          args: { task: spec.task },
                          status: "running" as const,
                          subagentId: `${agentName}-pending`,
                          subagentTask: spec.task,
                          agentName: agentName,
                          role: spec.role,
                        });
                      }
                    }
                  }
                  return {
                    ...m,
                    // Clear speculative preamble tokens emitted before the first tool call,
                    // or when delegate_task is called (sub-agents take over the answer).
                    content:
                      existing.length === 0 || event.name === "delegate_task"
                        ? ""
                        : m.content,
                    toolCalls: [
                      ...existing,
                      {
                        id: toolEventKey,
                        name: event.name,
                        displayName: event.displayName ?? null,
                        args: event.args,
                        status: "running" as const,
                        subagentId: event.subagentId,
                        subagentTask: event.subagentTask,
                        agentName: event.agentName,
                        role: event.role,
                        internal: event.internal,
                        skipped: event.skipped,
                        skipReason: event.skipReason,
                        displayResult: event.displayResult,
                      },
                      ...extraPlaceholders,
                    ],
                  };
                }),
              );
            },
            onToolResult: (event) => {
              const toolEventKey = getToolEventKey(event);
              const toolArgs = liveToolArgsRef.current[toolEventKey] ?? {};
              if (isInternalToolEvent(event)) {
                setMessages((prev) =>
                  prev.map((m) => {
                    if (m.id !== assistantId) return m;
                    return {
                      ...m,
                      toolCalls: (m.toolCalls ?? []).filter(
                        (tc) => tc.id !== toolEventKey,
                      ),
                    };
                  }),
                );
                delete liveToolArgsRef.current[toolEventKey];
                return;
              }
              setMessages((prev) =>
                prev.map((m) => {
                  if (m.id !== assistantId) return m;
                  return {
                    ...m,
                    toolCalls: (m.toolCalls ?? []).map((tc) =>
                      tc.id === toolEventKey
                        ? {
                            ...tc,
                            displayName:
                              event.displayName ?? tc.displayName ?? null,
                            result: event.result,
                            error: event.error,
                            internal: event.internal ?? tc.internal,
                            skipped: event.skipped ?? tc.skipped,
                            skipReason: event.skipReason ?? tc.skipReason,
                            displayResult: event.displayResult ?? tc.displayResult,
                            status: event.error
                              ? ("error" as const)
                              : ("done" as const),
                            subagentId: event.subagentId ?? tc.subagentId,
                            subagentTask: event.subagentTask ?? tc.subagentTask,
                            agentName: event.agentName ?? tc.agentName,
                            role: event.role ?? tc.role,
                          }
                        : tc,
                    ),
                  };
                }),
              );
              syncBrowserWindowFromTool(
                event.name,
                toolArgs,
                event.result,
                event.error,
              );
              delete liveToolArgsRef.current[toolEventKey];
            },
            onConfirmRequired: (requestId, toolName, args) => {
              setHitlDialog({ requestId, toolName, args });
            },
            onSubagentResult: (event) => {
              const agentName = event.agentName || event.subagentId;
              const subagentId = event.subagentId || agentName;
              // Mark the sub-agent as done so its card shows checkmark and stops streaming cursor.
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? {
                        ...m,
                        subagentDone: {
                          ...(m.subagentDone ?? {}),
                          [subagentId]: true,
                          [agentName]: true,
                        },
                        subagentResults: {
                          ...(m.subagentResults ?? {}),
                          [agentName]: {
                            subagentId,
                            agentName,
                            role: event.role,
                            task: event.task,
                            answer: event.answer,
                            rawAnswer: event.rawAnswer,
                            failed: event.failed,
                            error: event.error,
                            maxToolCallsReached: event.maxToolCallsReached,
                            stopReason: event.stopReason,
                            elapsedMs: event.elapsedMs,
                            evidence: event.evidence,
                          },
                          [subagentId]: {
                            subagentId,
                            agentName,
                            role: event.role,
                            task: event.task,
                            answer: event.answer,
                            rawAnswer: event.rawAnswer,
                            failed: event.failed,
                            error: event.error,
                            maxToolCallsReached: event.maxToolCallsReached,
                            stopReason: event.stopReason,
                            elapsedMs: event.elapsedMs,
                            evidence: event.evidence,
                          },
                        },
                      }
                    : m,
                ),
              );
            },
          },
          abort.signal,
        );

        setStatusText("");
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  streaming: false,
                  usageEstimate,
                }
              : m,
          ),
        );
        if (title) {
          setConversations((prev) =>
            prev.map((c) => (c.id === convId ? { ...c, title } : c)),
          );
        }
      } catch (err) {
        setStatusText("");
        if ((err as Error).name === "AbortError") {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    streaming: false,
                  }
                : m,
            ),
          );
          return;
        }
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  role: "error" as const,
                  content: `错误：${(err as Error).message}`,
                  streaming: false,
                }
              : m,
          ),
        );
      } finally {
        setLoading(false);
        inFlightContentRef.current = null;
        abortRef.current = null;
        liveToolArgsRef.current = {};
      }
    },
    [
      loading,
      activeId,
      messages,
      selectedModel,
      providers,
      embeddingConfig,
      openAppIntent,
      pendingConfirmation,
      setInputValue,
      syncBrowserWindowFromTool,
    ],
  );

  const handleRetryMessage = useCallback(
    (userContent: string, retryHistory: ChatMessage[]) => {
      setMessages(retryHistory);
      sendMessage(userContent, retryHistory);
    },
    [sendMessage],
  );

  useEffect(() => {
    if (!loading && queuedMessage) {
      const msg = queuedMessage;
      queuedMessageRef.current = null;
      setQueuedMessage(null);
      sendMessage(msg);
    }
  }, [loading, queuedMessage, sendMessage]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const activeTitle = conversations.find((c) => c.id === activeId)?.title;
  const appSearchResults = findAppSearchResults(input);

  return (
    <div
      className="flex h-full overflow-hidden"
      style={{ background: "var(--window-content-bg)", color: "var(--t1)" }}
    >
      {/* ── 侧边栏 ── */}
      <aside
        className="flex flex-col shrink-0 h-full"
        style={{
          width: 220,
          borderRight: "0.5px solid var(--border)",
          background: "var(--panel-bg)",
        }}
      >
        {/* 新建对话 */}
        <div className="p-3">
          <button
            onClick={newConversation}
            className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-[14px] font-medium transition-all"
            style={{ background: "var(--accent)", color: "#fff" }}
          >
            <span>新对话</span>
            <PenSquare size={14} />
          </button>
        </div>

        {/* 会话列表 */}
        <div className="flex-1 overflow-y-auto px-2 pb-2">
          {conversations.length === 0 ? (
            <p
              className="text-[14px] px-2 py-4 text-center"
              style={{ color: "var(--t3)" }}
            >
              暂无历史对话
            </p>
          ) : (
            <div className="flex flex-col gap-0.5">
              {conversations.map((conv) => {
                const active = activeId === conv.id;
                return (
                  <div
                    key={conv.id}
                    onClick={() => selectConversation(conv.id)}
                    className="group flex items-center gap-2 px-2.5 py-2 rounded-lg cursor-pointer transition-colors relative"
                    style={{
                      background: active
                        ? "rgba(10, 132, 255, 0.16)"
                        : "transparent",
                    }}
                    onMouseEnter={(e) => {
                      if (!active)
                        (e.currentTarget as HTMLElement).style.background =
                          "var(--control-bg)";
                    }}
                    onMouseLeave={(e) => {
                      if (!active)
                        (e.currentTarget as HTMLElement).style.background =
                          "transparent";
                    }}
                  >
                    <span
                      className="flex-1 text-[14px] truncate"
                      style={{
                        color: active ? "var(--accent)" : "var(--t1)",
                        fontWeight: active ? 500 : 400,
                      }}
                    >
                      {conv.title}
                    </span>
                    <button
                      onClick={(e) => deleteConversation(conv.id, e)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                      style={{
                        width: 22,
                        height: 22,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        borderRadius: 6,
                        color: "var(--t3)",
                      }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLElement).style.background =
                          "rgba(255,59,48,0.1)";
                        (e.currentTarget as HTMLElement).style.color =
                          "var(--red)";
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLElement).style.background =
                          "transparent";
                        (e.currentTarget as HTMLElement).style.color =
                          "var(--t3)";
                      }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </aside>

      {/* ── 主区域 ── */}
      <div className="flex flex-col flex-1 min-w-0 h-full relative">
        {/* 顶栏 */}
        <header
          className="flex items-center justify-between px-4 shrink-0"
          style={{
            height: 48,
            borderBottom: "0.5px solid var(--border)",
            background: "var(--panel-bg-soft)",
          }}
        >
          <span
            className="text-[14px] font-medium truncate"
            style={{ color: "var(--t2)" }}
          >
            {activeTitle ?? "AI 助手"}
          </span>
          <ModelPicker
            value={selectedModel}
            onChange={(v) => {
              setSelectedModel(v);
              setDefaultModel(v);
            }}
          />
        </header>

        {/* 消息区 */}
        <div
          ref={scrollContainerRef}
          className="flex-1 overflow-y-auto"
          onScroll={handleScroll}
        >
          {messages.length === 0 ? (
            /* 空状态 */
            <div className="flex flex-col items-center justify-center h-full px-6 gap-6 select-none">
              <div className="text-center">
                <div
                  className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4"
                  style={{
                    background: "linear-gradient(135deg,#a78bfa,#6366f1)",
                  }}
                >
                  <Sparkles size={28} color="white" strokeWidth={1.6} />
                </div>
                <p
                  className="text-[17px] font-semibold mb-1"
                  style={{ color: "var(--t1)" }}
                >
                  有什么可以帮你的？
                </p>
                <p className="text-[14px]" style={{ color: "var(--t3)" }}>
                  {selectedModel
                    ? "选择一个话题开始对话"
                    : "请先在右上角选择模型"}
                </p>
              </div>

              {selectedModel && (
                <div
                  className="grid grid-cols-2 gap-2 w-full"
                  style={{ maxWidth: 400 }}
                >
                  {QUICK_PROMPTS.map((q) => (
                    <button
                      key={q.label}
                      onClick={() => {
                        setInputValue(q.prompt);
                        textareaRef.current?.focus();
                      }}
                      className="flex flex-col gap-1 px-3 py-3 rounded-xl text-left transition-all"
                      style={{
                        background: "var(--panel-bg)",
                        border: "0.5px solid var(--border)",
                      }}
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.background =
                          "rgba(10, 132, 255, 0.12)")
                      }
                      onMouseLeave={(e) =>
                        (e.currentTarget.style.background = "var(--panel-bg)")
                      }
                    >
                      <span className="text-[17px]">{q.icon}</span>
                      <span
                        className="text-[14px] font-medium"
                        style={{ color: "var(--t1)" }}
                      >
                        {q.label}
                      </span>
                      <span
                        className="text-[14px]"
                        style={{ color: "var(--t3)" }}
                      >
                        {q.prompt}…
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <MessageList
              messages={messages}
              statusText={statusText}
              bottomRef={bottomRef}
              onRetryMessage={handleRetryMessage}
            />
          )}
        </div>

        {/* 输入区 */}
        <div
          className="shrink-0 px-4 pb-4 pt-2"
          style={{
            background: "var(--panel-bg-soft)",
            borderTop: "0.5px solid var(--border)",
          }}
        >
          {pendingConfirmation && (
            <div
              className="mx-auto mb-2 flex flex-wrap items-center gap-2 rounded-2xl border px-3 py-2 text-[12px]"
              style={{
                maxWidth: 720,
                borderColor: "rgba(245,158,11,0.24)",
                background: "rgba(245, 158, 11, 0.14)",
                color: "#ffb340",
              }}
            >
              <span className="min-w-0 flex-1">
                检测到删除、发送、覆盖或批量修改等高风险动作，请确认后继续。
              </span>
              <button
                className="rounded-full px-3 py-1 font-medium text-white"
                style={{ background: "#d97706" }}
                onClick={() => sendMessage(pendingConfirmation)}
              >
                确认执行
              </button>
              <button
                className="rounded-full px-3 py-1 font-medium"
                style={{ background: "var(--control-bg)", color: "#ffb340" }}
                onClick={() => {
                  setPendingConfirmation("");
                  setStatusText("已取消高风险操作。");
                }}
              >
                取消
              </button>
            </div>
          )}
          {appSearchResults.length > 0 && (
            <div
              className="mx-auto mb-2 flex flex-wrap gap-2"
              style={{ maxWidth: 720 }}
            >
              {appSearchResults.map((app) => (
                <button
                  key={app.appId}
                  className="rounded-full border px-3 py-1.5 text-[12px] transition-colors"
                  style={{
                    borderColor: "var(--border)",
                    background: "var(--control-bg)",
                    color: "var(--t2)",
                  }}
                  onClick={() => {
                    openAppIntent(app);
                    setInputValue("");
                    setStatusText("");
                    setMessages((prev) => [
                      ...prev,
                      {
                        id: crypto.randomUUID(),
                        role: "user",
                        content: `打开${app.title}`,
                      },
                      {
                        id: crypto.randomUUID(),
                        role: "assistant",
                        content: app.reply,
                        streaming: false,
                      },
                    ]);
                  }}
                >
                  打开{app.title}
                </button>
              ))}
            </div>
          )}
          <div
            className="mx-auto rounded-2xl overflow-hidden transition-shadow"
            style={{
              maxWidth: 720,
              background: "var(--input-bg)",
              border: "0.5px solid var(--border)",
              boxShadow:
                "0 12px 32px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.05)",
            }}
          >
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder={
                selectedModel
                  ? "输入消息… (Enter 发送，Shift+Enter 换行)"
                  : "请先选择模型"
              }
              rows={1}
              disabled={!selectedModel}
              className="w-full resize-none bg-transparent outline-none text-[14px] leading-relaxed px-4 pt-3 pb-1"
              style={{
                color: "var(--t1)",
                maxHeight: 200,
                fontFamily: "var(--font-sans)",
                display: "block",
              }}
            />
            <div className="flex items-center justify-between px-3 pb-2.5">
              <span className="text-[14px]" style={{ color: "var(--t3)" }}>
                {input.length > 0 ? `${input.length} 字` : ""}
              </span>
              {loading ? (
                <button
                  onClick={stopGeneration}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[14px] font-medium transition-all"
                  style={{
                    background: "var(--control-bg)",
                    color: "var(--t2)",
                  }}
                >
                  <Square size={11} fill="currentColor" /> 停止
                </button>
              ) : (
                <button
                  onClick={() => sendMessage()}
                  disabled={!input.trim() || !selectedModel}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[14px] font-medium transition-all"
                  style={{
                    background:
                      input.trim() && selectedModel
                        ? "var(--accent)"
                        : "var(--disabled-bg)",
                    color: input.trim() && selectedModel ? "#fff" : "var(--t3)",
                  }}
                >
                  <Send size={11} /> 发送
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── HITL 确认弹窗 ── */}
      {hitlDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{
            background: "rgba(0,0,0,0.45)",
            backdropFilter: "blur(4px)",
          }}
        >
          <div
            className="rounded-2xl overflow-hidden flex flex-col gap-0"
            style={{
              width: 400,
              maxWidth: "90vw",
              background: "var(--panel-bg)",
              border: "0.5px solid var(--border)",
              boxShadow: "0 24px 60px rgba(0,0,0,0.4)",
            }}
          >
            <div className="px-5 pt-5 pb-3">
              <p
                className="text-[15px] font-semibold mb-1"
                style={{ color: "var(--t1)" }}
              >
                工具调用确认
              </p>
              <p className="text-[13px] mb-3" style={{ color: "var(--t3)" }}>
                Agent 请求执行以下操作，请选择是否允许：
              </p>
              <div
                className="rounded-xl px-3 py-2.5"
                style={{
                  background: "var(--surface-solid)",
                  border: "0.5px solid var(--border)",
                }}
              >
                <p
                  className="text-[12px] font-medium mb-1"
                  style={{ color: "var(--accent)" }}
                >
                  {hitlDialog.toolName}
                </p>
                <pre
                  className="text-[12px] leading-relaxed whitespace-pre-wrap break-all"
                  style={{
                    color: "var(--t2)",
                    fontFamily: "var(--font-mono)",
                    maxHeight: 160,
                    overflowY: "auto",
                  }}
                >
                  {JSON.stringify(hitlDialog.args, null, 2)}
                </pre>
              </div>
            </div>
            <div className="flex gap-2 px-5 pb-5">
              <button
                className="flex-1 py-2 rounded-xl text-[14px] font-medium transition-all"
                style={{ background: "var(--control-bg)", color: "var(--t2)" }}
                onClick={async () => {
                  setHitlDialog(null);
                  await fetch(
                    `${API}/confirm?request_id=${hitlDialog.requestId}&approved=false`,
                    { method: "POST" },
                  );
                }}
              >
                拒绝
              </button>
              <button
                className="flex-1 py-2 rounded-xl text-[14px] font-medium transition-all"
                style={{ background: "var(--accent)", color: "#fff" }}
                onClick={async () => {
                  setHitlDialog(null);
                  await fetch(
                    `${API}/confirm?request_id=${hitlDialog.requestId}&approved=true`,
                    { method: "POST" },
                  );
                }}
              >
                允许执行
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
