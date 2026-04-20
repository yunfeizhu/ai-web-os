"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Trash2, Send, Square, PenSquare, Sparkles } from "lucide-react";
import { streamChat } from "@/hooks/useStream";
import { API_BASE } from "@/lib/backend";
import { useSettingsStore } from "@/stores/settingsStore";
import { useWindowStore } from "@/stores/windowStore";
import { decodeModel, PROVIDERS } from "@/apps/settings/providers";
import { MessageBubble } from "./MessageBubble";
import { ModelPicker } from "./ModelPicker";
import type { ChatMessage, Conversation } from "./types";

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

  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const liveToolArgsRef = useRef<Record<string, Record<string, unknown>>>({});
  const pendingBrowserWindowTimersRef = useRef<Record<string, number>>({});
  const scrollBehaviorRef = useRef<"smooth" | "instant">("instant");
  const userScrolledUpRef = useRef(false);

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
      for (const timerId of Object.values(pendingBrowserWindowTimersRef.current)) {
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
          tool_calls:
            | {
                id: string;
                name: string;
                displayName?: string | null;
                args: Record<string, unknown>;
                result?: string | null;
              }[]
            | null;
          tool_call_id: string | null;
        }[]
      >(`/conversations/${convId}/messages`);

      // tool 娑堟伅缁撴灉 map锛歵ool_call_id 鈫?content
      const toolResultMap: Record<string, string> = {};
      data
        .filter((m) => m.role === "tool")
        .forEach((m) => {
          if (m.tool_call_id) toolResultMap[m.tool_call_id] = m.content ?? "";
        });

      // 杩囨护鎺?role=tool 鐨勪腑闂存秷鎭紝鍙樉绀?user/assistant
      const visible = data.filter(
        (m) => m.role === "user" || m.role === "assistant",
      );
      setMessages(
        visible.map((m) => {
          const rawCalls = m.tool_calls ?? [];
          const normalizedCalls = rawCalls.map((tc) => ({
            id: tc.id,
            name: tc.name,
            displayName: tc.displayName ?? null,
            args: tc.args,
            result: toolResultMap[tc.id] ?? tc.result ?? undefined,
            status: "done" as const,
          }));

          return {
            id: m.id,
            role: m.role as ChatMessage["role"],
            content: m.content ?? "",
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
      bottomRef.current?.scrollIntoView({
        behavior: scrollBehaviorRef.current,
      });
    }
  }, [messages]);

  const handleScroll = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    // 璺濈搴曢儴瓒呰繃 80px 瑙嗕负鐢ㄦ埛鍚戜笂婊氬姩
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    userScrolledUpRef.current = !atBottom;
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = Math.min(e.target.scrollHeight, 200) + "px";
  };

  const stopGeneration = () => {
    abortRef.current?.abort();
  };

  // 鍚庣閲嶅惎鍚庤嚜鍔ㄩ噸鏂板垵濮嬪寲璁板繂绠＄悊鍣?
  const sendMessage = useCallback(
    async (text?: string) => {
      const content = (text ?? input).trim();
      if (!content || loading || !selectedModel) return;

      const { providerId, modelId } = decodeModel(selectedModel);
      const providerCfg = providers[providerId];
      const providerDef = PROVIDERS.find((p) => p.id === providerId);
      if (!providerCfg?.apiKey) return;

      const apiKey = providerCfg.apiKey;
      const apiBase = providerCfg.baseUrl || providerDef?.defaultBaseUrl;

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
          return;
        }
      }

      setInput("");
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
      for (const m of messages) {
        if (m.role === "assistant") {
          const completedCalls = (m.toolCalls ?? []).filter(
            (tc) => tc.status === "done" && tc.result != null,
          );
          if (completedCalls.length > 0) {
            // assistant message with tool_calls
            history.push({
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
            });
            // corresponding tool result messages
            for (const tc of completedCalls) {
              history.push({
                role: "tool",
                tool_call_id: tc.id,
                content: tc.result ?? "",
              });
            }
          } else {
            history.push({ role: "assistant", content: m.content });
          }
        } else {
          history.push({ role: m.role, content: m.content });
        }
      }
      const abort = new AbortController();
      abortRef.current = abort;

      try {
        const { title } = await streamChat(
          {
            conversationId: convId,
            appId: "ai-chat",
            message: content,
            model: modelId,
            providerId,
            history,
            apiKey,
            apiBase,
            enableMemory: true,
            compatType: providerCfg.compatType ?? "openai",
            embeddingConfig: embeddingConfig ?? undefined,
            llmApiKey: apiKey,
            llmApiBase: apiBase,
            onStatus: (s) => {
              if (s === "recalled") {
                // const count = (event?.count as number) ?? 0;
                // setStatusText(`宸插彫鍥?${count} 鏉¤蹇哷);
                // setTimeout(() => setStatusText(""), 2000);
              }
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
              liveToolArgsRef.current[event.id] = event.args;
              setMessages((prev) =>
                prev.map((m) => {
                  if (m.id !== assistantId) return m;
                  const existing = m.toolCalls ?? [];
                  return {
                    ...m,
                    toolCalls: [
                      ...existing,
                      {
                        id: event.id,
                        name: event.name,
                        displayName: event.displayName ?? null,
                        args: event.args,
                        status: "running" as const,
                      },
                    ],
                  };
                }),
              );
            },
            onToolResult: (event) => {
              const toolArgs = liveToolArgsRef.current[event.id] ?? {};
              setMessages((prev) =>
                prev.map((m) => {
                  if (m.id !== assistantId) return m;
                  return {
                    ...m,
                    toolCalls: (m.toolCalls ?? []).map((tc) =>
                      tc.id === event.id
                        ? {
                            ...tc,
                            displayName:
                              event.displayName ?? tc.displayName ?? null,
                            result: event.result,
                            error: event.error,
                            status: event.error
                              ? ("error" as const)
                              : ("done" as const),
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
              delete liveToolArgsRef.current[event.id];
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
        abortRef.current = null;
        liveToolArgsRef.current = {};
      }
    },
    [
      input,
      loading,
      activeId,
      messages,
      selectedModel,
      providers,
      embeddingConfig,
      openWindow,
      syncBrowserWindowFromTool,
      updateAppState,
    ],
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const activeTitle = conversations.find((c) => c.id === activeId)?.title;

  return (
    <div
      className="flex h-full overflow-hidden"
      style={{ background: "var(--bg, #fff)", color: "var(--t1)" }}
    >
      {/* ── 侧边栏 ── */}
      <aside
        className="flex flex-col shrink-0 h-full"
        style={{
          width: 220,
          borderRight: "0.5px solid rgba(0,0,0,0.07)",
          background: "rgba(250,250,252,0.9)",
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
                        ? "rgba(0,122,255,0.08)"
                        : "transparent",
                    }}
                    onMouseEnter={(e) => {
                      if (!active)
                        (e.currentTarget as HTMLElement).style.background =
                          "rgba(0,0,0,0.04)";
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
            borderBottom: "0.5px solid rgba(0,0,0,0.07)",
            background: "rgba(250,250,252,0.8)",
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
                        setInput(q.prompt);
                        textareaRef.current?.focus();
                      }}
                      className="flex flex-col gap-1 px-3 py-3 rounded-xl text-left transition-all"
                      style={{
                        background: "rgba(0,0,0,0.03)",
                        border: "0.5px solid rgba(0,0,0,0.07)",
                      }}
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.background =
                          "rgba(0,122,255,0.05)")
                      }
                      onMouseLeave={(e) =>
                        (e.currentTarget.style.background = "rgba(0,0,0,0.03)")
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
            /* 消息列表 */
            <div className="py-4 mx-auto w-full" style={{ maxWidth: 720 }}>
              {/* 记忆召回提示：固定高度占位，toast 浮在内部不撑开布局 */}
              <div className="relative h-7 mb-1">
                {statusText && (
                  <div
                    className="absolute left-4 top-0 flex items-center gap-1.5 px-3 py-1 rounded-full text-[12px] pointer-events-none"
                    style={{
                      background: "rgba(0,0,0,0.05)",
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
                // 找到该 assistant 消息对应的上一条 user 消息，用于重试
                const onRetry =
                  msg.role === "assistant" || msg.role === "error"
                    ? () => {
                        // 找到紧邻的上一条 user 消息的索引
                        let userIdx = idx - 1;
                        while (
                          userIdx >= 0 &&
                          messages[userIdx].role !== "user"
                        )
                          userIdx--;
                        if (userIdx < 0) return;
                        const userContent = messages[userIdx].content;
                        // 移除 user 消息 + 这条 assistant/error 消息（及之后所有内容）
                        setMessages((prev) => prev.slice(0, userIdx));
                        sendMessage(userContent);
                      }
                    : undefined;
                return (
                  <MessageBubble key={msg.id} message={msg} onRetry={onRetry} />
                );
              })}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        {/* 输入区 */}
        <div
          className="shrink-0 px-4 pb-4 pt-2"
          style={{ background: "rgba(250,250,252,0.8)" }}
        >
          <div
            className="mx-auto rounded-2xl overflow-hidden transition-shadow"
            style={{
              maxWidth: 720,
              background: "#fff",
              border: "0.5px solid rgba(0,0,0,0.12)",
              boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
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
                  style={{ background: "rgba(0,0,0,0.06)", color: "var(--t2)" }}
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
                        : "rgba(0,0,0,0.06)",
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
    </div>
  );
}
