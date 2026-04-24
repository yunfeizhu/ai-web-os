"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, Send, Square } from "lucide-react";

import {
  AVATAR_APP_ID,
  buildAvatarEmbeddingPayload,
  buildAvatarSystemPrompt,
  confirmAvatarAction,
  getOrCreateAvatarConversation,
  resolveAvatarAppLaunchIntent,
  resolveAvatarConversationModel,
  resolveAvatarModel,
} from "@/apps/avatar-pet/avatar-chat";
import { parseAvatarEmotions } from "@/apps/avatar-pet/emotion-parser";
import type { ChatMessage, ToolCall } from "@/apps/ai-chat/types";
import {
  streamChat,
  type ToolCallEvent,
  type ToolResultEvent,
} from "@/hooks/useStream";
import { useAvatarStore } from "@/stores/avatarStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useWindowStore } from "@/stores/windowStore";

type BubbleMessage = ChatMessage;

type PendingConfirmation = {
  requestId: string;
  toolName: string;
  args: Record<string, unknown>;
  deciding: boolean;
};

type AvatarBubbleProps = {
  maxHeight?: number;
};

function toolEventKey(
  event: Pick<ToolCallEvent | ToolResultEvent, "id" | "subagentId" | "agentName">,
) {
  const baseId = event.id || crypto.randomUUID();
  const owner = event.subagentId || event.agentName;
  if (!owner) return baseId;
  if (baseId.startsWith(`${owner}::`)) return baseId;
  return `${owner}::${baseId}`;
}

function buildHistory(messages: BubbleMessage[]): Record<string, unknown>[] {
  return messages
    .filter((message) => {
      return (
        (message.role === "user" || message.role === "assistant") &&
        !message.streaming &&
        message.content.trim().length > 0
      );
    })
    .map((message) => ({
      role: message.role,
      content: message.content,
    }));
}

function getToolLabel(tool: ToolCall) {
  return tool.displayName || tool.name;
}

function getToolStatusText(tool: ToolCall) {
  if (tool.status === "running") return "运行中";
  if (tool.status === "error") return "失败";
  return "完成";
}

export function AvatarBubble({ maxHeight = 360 }: AvatarBubbleProps) {
  const providers = useSettingsStore((state) => state.providers);
  const defaultModel = useSettingsStore((state) => state.defaultModel);
  const avatarModel = useSettingsStore((state) => state.avatarModel);
  const embeddingConfig = useSettingsStore((state) => state.embeddingConfig);
  const setCurrentEmotion = useAvatarStore((state) => state.setCurrentEmotion);
  const openWindow = useWindowStore((state) => state.openWindow);
  const updateAppState = useWindowStore((state) => state.updateAppState);
  const [messages, setMessages] = useState<BubbleMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [pendingConfirm, setPendingConfirm] =
    useState<PendingConfirmation | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const assistantRawRef = useRef("");
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const mountedRef = useRef(true);
  const streamRunIdRef = useRef<string | null>(null);

  const resolvedModel = useMemo(
    () =>
      resolveAvatarModel(
        resolveAvatarConversationModel(avatarModel, defaultModel),
        providers,
      ),
    [avatarModel, defaultModel, providers],
  );

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      streamRunIdRef.current = null;
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  const scrollToBottom = () => {
    if (!mountedRef.current) return;
    requestAnimationFrame(() => {
      if (!mountedRef.current) return;
      messagesEndRef.current?.scrollIntoView({ block: "end" });
    });
  };

  const safeSetMessages = (
    updater: BubbleMessage[] | ((messages: BubbleMessage[]) => BubbleMessage[]),
  ) => {
    if (!mountedRef.current) return;
    setMessages(updater);
    scrollToBottom();
  };

  const appendError = (content: string) => {
    safeSetMessages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        role: "error",
        content,
      },
    ]);
  };

  const updateAssistant = (
    assistantId: string,
    updater: (message: BubbleMessage) => BubbleMessage,
  ) => {
    safeSetMessages((prev) =>
      prev.map((message) =>
        message.id === assistantId ? updater(message) : message,
      ),
    );
  };

  const isActiveRun = (runId: string) => {
    return mountedRef.current && streamRunIdRef.current === runId;
  };

  const handleOpenChat = () => {
    openWindow("ai-chat", "AI 助手", "MessageSquare", { singleton: false });
  };

  const handleAbort = () => {
    abortRef.current?.abort();
    abortRef.current = null;
  };

  const handleConfirm = async (approved: boolean) => {
    const confirmation = pendingConfirm;
    if (!confirmation) return;

    setPendingConfirm({ ...confirmation, deciding: true });
    try {
      await confirmAvatarAction(confirmation.requestId, approved);
      if (mountedRef.current) {
        setPendingConfirm(null);
      }
    } catch (error) {
      if (!mountedRef.current) return;
      setPendingConfirm({ ...confirmation, deciding: false });
      appendError(
        error instanceof Error
          ? `确认失败：${error.message}`
          : "确认失败，请稍后重试。",
      );
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const content = input.trim();
    if (!content || loading) return;

    const appLaunchIntent = resolveAvatarAppLaunchIntent(content);
    if (appLaunchIntent) {
      const userMessage: BubbleMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content,
      };
      const parsed = parseAvatarEmotions(appLaunchIntent.reply);
      const assistantMessage: BubbleMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: parsed.text,
      };
      const windowId = openWindow(
        appLaunchIntent.appId,
        appLaunchIntent.title,
        appLaunchIntent.icon,
        {
          singleton: true,
          appState: appLaunchIntent.appState,
        },
      );

      if (appLaunchIntent.appState) {
        updateAppState(windowId, appLaunchIntent.appState);
      }
      if (parsed.emotions.length > 0) {
        setCurrentEmotion(parsed.currentEmotion);
      }

      setInput("");
      setPendingConfirm(null);
      safeSetMessages((prev) => [...prev, userMessage, assistantMessage]);
      return;
    }

    if (!resolvedModel) {
      appendError("请先在设置中配置可用模型和 API Key。");
      return;
    }

    const runId = crypto.randomUUID();
    const userMessage: BubbleMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content,
    };
    const assistantId = crypto.randomUUID();
    const assistantMessage: BubbleMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
      streaming: true,
    };
    const history = buildHistory(messages);

    setInput("");
    setPendingConfirm(null);
    setLoading(true);
    assistantRawRef.current = "";
    streamRunIdRef.current = runId;
    safeSetMessages((prev) => [...prev, userMessage, assistantMessage]);

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const conversation = await getOrCreateAvatarConversation(
        resolvedModel.modelId,
      );
      if (!isActiveRun(runId)) return;

      await streamChat(
        {
          conversationId: conversation.id,
          appId: AVATAR_APP_ID,
          message: content,
          model: resolvedModel.modelId,
          providerId: resolvedModel.providerId,
          history,
          systemPrompt: buildAvatarSystemPrompt(),
          apiKey: resolvedModel.provider.apiKey,
          apiBase: resolvedModel.apiBase,
          enableMemory: true,
          compatType: resolvedModel.provider.compatType ?? "openai",
          embeddingConfig: buildAvatarEmbeddingPayload(embeddingConfig),
          llmApiKey: resolvedModel.provider.apiKey,
          llmApiBase: resolvedModel.apiBase,
          onToken: (token) => {
            if (!isActiveRun(runId)) return;
            assistantRawRef.current += token;
            const parsed = parseAvatarEmotions(assistantRawRef.current);
            if (parsed.emotions.length > 0) {
              setCurrentEmotion(parsed.currentEmotion);
            }
            updateAssistant(assistantId, (message) => ({
              ...message,
              content: parsed.text,
            }));
          },
          onToolCall: (tool) => {
            if (!isActiveRun(runId)) return;
            const key = toolEventKey(tool);
            updateAssistant(assistantId, (message) => {
              const existing = message.toolCalls ?? [];
              const nextTool: ToolCall = {
                id: key,
                name: tool.name,
                displayName: tool.displayName ?? null,
                args: tool.args,
                status: "running",
                subagentId: tool.subagentId,
                subagentTask: tool.subagentTask,
                agentName: tool.agentName,
                role: tool.role,
              };

              if (existing.some((item) => item.id === key)) {
                return {
                  ...message,
                  toolCalls: existing.map((item) =>
                    item.id === key ? { ...item, ...nextTool } : item,
                  ),
                };
              }

              return {
                ...message,
                toolCalls: [...existing, nextTool],
              };
            });
          },
          onToolResult: (tool) => {
            if (!isActiveRun(runId)) return;
            const key = toolEventKey(tool);
            updateAssistant(assistantId, (message) => ({
              ...message,
              toolCalls: (message.toolCalls ?? []).map((item) =>
                item.id === key
                  ? {
                      ...item,
                      displayName: tool.displayName ?? item.displayName,
                      result: tool.result,
                      error: tool.error,
                      status: tool.error ? "error" : "done",
                      subagentId: tool.subagentId ?? item.subagentId,
                      subagentTask: tool.subagentTask ?? item.subagentTask,
                      agentName: tool.agentName ?? item.agentName,
                      role: tool.role ?? item.role,
                    }
                  : item,
              ),
            }));
          },
          onConfirmRequired: (requestId, toolName, args) => {
            if (!isActiveRun(runId)) return;
            setPendingConfirm({
              requestId,
              toolName,
              args,
              deciding: false,
            });
          },
        },
        abort.signal,
      );
    } catch (error) {
      if (!isActiveRun(runId)) return;

      const aborted =
        error instanceof DOMException && error.name === "AbortError";
      if (aborted) {
        updateAssistant(assistantId, (message) => ({
          ...message,
          content: message.content || "已停止生成。",
          streaming: false,
        }));
      } else {
        updateAssistant(assistantId, (message) => ({
          ...message,
          role: "error",
          content:
            error instanceof Error
              ? `发送失败：${error.message}`
              : "发送失败，请稍后重试。",
          streaming: false,
          toolCalls: undefined,
        }));
      }
    } finally {
      if (!isActiveRun(runId)) return;
      abortRef.current = null;
      streamRunIdRef.current = null;
      setLoading(false);
      setPendingConfirm(null);
      updateAssistant(assistantId, (message) => ({
        ...message,
        streaming: false,
      }));
    }
  };

  return (
    <section
      data-avatar-control="true"
      className="flex w-[min(320px,calc(100vw-32px))] flex-col overflow-hidden rounded-lg text-[13px] leading-5"
      style={{
        maxHeight,
        color: "rgba(24,24,27,0.9)",
        background: "rgba(255,255,255,0.84)",
        border: "1px solid rgba(255,255,255,0.64)",
        backdropFilter: "blur(24px) saturate(170%)",
        WebkitBackdropFilter: "blur(24px) saturate(170%)",
        boxShadow:
          "0 14px 34px rgba(15,23,42,0.18), 0 1px 0 rgba(255,255,255,0.75) inset",
      }}
    >
      <div className="flex items-center justify-between border-b border-zinc-900/10 px-3 py-2">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium text-zinc-900">
            虚拟伙伴
          </div>
          <div className="truncate text-[11px] text-zinc-500">
            {resolvedModel
              ? `${resolvedModel.providerId} · ${resolvedModel.modelId}`
              : "未配置可用模型"}
          </div>
        </div>
        <button
          type="button"
          onClick={handleOpenChat}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-600 transition-colors hover:bg-zinc-900/5 active:bg-zinc-900/10"
          title="打开 AI 助手"
          aria-label="打开 AI 助手"
        >
          <ExternalLink size={16} strokeWidth={1.9} />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-2">
        {messages.length === 0 ? (
          <div className="rounded-md bg-zinc-900/[0.04] px-2.5 py-2 text-zinc-600">
            我在这里，需要时可以直接问我。
          </div>
        ) : null}

        {messages.map((message) => (
          <div
            key={message.id}
            className={
              message.role === "user"
                ? "ml-8 rounded-md bg-zinc-900 px-2.5 py-2 text-white"
                : message.role === "error"
                  ? "rounded-md border border-red-200 bg-red-50 px-2.5 py-2 text-red-700"
                  : "mr-5 rounded-md bg-zinc-900/[0.05] px-2.5 py-2 text-zinc-800"
            }
          >
            <div className="whitespace-pre-wrap break-words">
              {message.content ||
                (message.streaming ? "正在思考..." : "我还没有组织好回答。")}
            </div>
            {message.toolCalls?.length ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {message.toolCalls.map((tool) => (
                  <span
                    key={tool.id}
                    className={`inline-flex max-w-full items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] ${
                      tool.status === "error"
                        ? "border-red-200 bg-red-50 text-red-700"
                        : tool.status === "done"
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : "border-amber-200 bg-amber-50 text-amber-700"
                    }`}
                    title={getToolLabel(tool)}
                  >
                    <span className="truncate">{getToolLabel(tool)}</span>
                    <span className="shrink-0 opacity-75">
                      {getToolStatusText(tool)}
                    </span>
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        ))}

        {pendingConfirm ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-amber-900">
            <div className="font-medium">需要确认工具操作</div>
            <div className="mt-0.5 break-words text-[12px]">
              {pendingConfirm.toolName}
            </div>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => void handleConfirm(false)}
                disabled={pendingConfirm.deciding}
                className="h-7 flex-1 rounded-md bg-white/80 px-2 text-[12px] text-zinc-700 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                拒绝
              </button>
              <button
                type="button"
                onClick={() => void handleConfirm(true)}
                disabled={pendingConfirm.deciding}
                className="h-7 flex-1 rounded-md bg-zinc-900 px-2 text-[12px] text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                允许
              </button>
            </div>
          </div>
        ) : null}
        <div ref={messagesEndRef} />
      </div>

      <form
        onSubmit={handleSubmit}
        className="flex items-end gap-2 border-t border-zinc-900/10 p-2"
      >
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          rows={1}
          className="max-h-20 min-h-8 flex-1 resize-none rounded-md border border-zinc-200 bg-white/80 px-2 py-1.5 text-[13px] text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus:border-zinc-400"
          placeholder="问问虚拟伙伴..."
          disabled={loading}
        />
        {loading ? (
          <button
            type="button"
            onClick={handleAbort}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-900 text-white transition-colors hover:bg-zinc-700"
            title="停止生成"
            aria-label="停止生成"
          >
            <Square size={14} fill="currentColor" strokeWidth={1.8} />
          </button>
        ) : (
          <button
            type="submit"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-900 text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-45"
            title="发送"
            aria-label="发送"
            disabled={!input.trim()}
          >
            <Send size={15} strokeWidth={1.9} />
          </button>
        )}
      </form>
    </section>
  );
}
