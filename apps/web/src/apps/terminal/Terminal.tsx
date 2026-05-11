"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

import { streamChat } from "@/hooks/useStream";
import { apiFetch, getActiveModelContext } from "@/lib/backend";
import { useWindowStore } from "@/stores/windowStore";
import type { ChatMessage, ToolCall } from "@/apps/ai-chat/types";

// Windows Terminal / CMD inspired palette
const T = {
  bg: "#0C0C0C",
  text: "#CCCCCC",
  muted: "#8A8A8A",
  promptUser: "#CCCCCC",
  promptAt: "#CCCCCC",
  promptHost: "#CCCCCC",
  promptDir: "#CCCCCC",
  promptSign: "#CCCCCC",
  output: "#CCCCCC",
  error: "#F48771",
  toolLabel: "#9CDCFE",
  toolResult: "#CCCCCC",
  toolError: "#F48771",
  scrollThumb: "rgba(255,255,255,0.2)",
};

const USERNAME = "ai-os";
const HOSTNAME = "ai-web";

type FileEntry = {
  id: string;
  name: string;
  path: string;
  kind: "file" | "dir";
  size: number;
  updated_at: string;
};

type FilesResponse = {
  path: string;
  entries: FileEntry[];
};

type TerminalBuiltinResult = {
  output: string;
  nextPath?: string;
};

function PromptPrefix({ dir = "~" }: { dir?: string }) {
  return (
    <span
      style={{
        fontFamily:
          "'Cascadia Code', 'Cascadia Mono', Consolas, Menlo, 'SF Mono', Monaco, 'Courier New', monospace",
        fontSize: 15,
        lineHeight: "1.6",
        userSelect: "none",
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ color: T.promptUser }}>{USERNAME}</span>
      <span style={{ color: T.promptAt }}>@</span>
      <span style={{ color: T.promptHost }}>{HOSTNAME}</span>
      <span style={{ color: T.promptSign }}> </span>
      <span style={{ color: T.promptDir }}>{dir}</span>
      <span style={{ color: T.promptSign, marginRight: 6 }}> %</span>
    </span>
  );
}

export function Terminal({ windowId }: { windowId: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [currentPath, setCurrentPath] = useState("/");
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const outputRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const focusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const historyDraftRef = useRef("");
  const ctx = getActiveModelContext();
  const isFocused = useWindowStore(
    (state) => state.windows[windowId]?.isFocused ?? false,
  );

  const focusInput = (delay = 30) => {
    if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
    focusTimerRef.current = setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(
        inputRef.current.value.length,
        inputRef.current.value.length,
      );
    }, delay);
  };

  useEffect(() => {
    if (!isFocused) return;
    focusInput();

    return () => {
      if (focusTimerRef.current) {
        clearTimeout(focusTimerRef.current);
        focusTimerRef.current = null;
      }
    };
  }, [isFocused]);

  useEffect(
    () => () => {
      if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    outputRef.current?.scrollTo({
      top: outputRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, loading]);

  const handleHistoryNavigation = (direction: "up" | "down") => {
    if (commandHistory.length === 0) return;

    if (direction === "up") {
      if (historyIndex === null) {
        historyDraftRef.current = input;
        const nextIndex = commandHistory.length - 1;
        setHistoryIndex(nextIndex);
        setInput(commandHistory[nextIndex] ?? "");
        return;
      }

      const nextIndex = Math.max(0, historyIndex - 1);
      setHistoryIndex(nextIndex);
      setInput(commandHistory[nextIndex] ?? "");
      return;
    }

    if (historyIndex === null) return;

    if (historyIndex >= commandHistory.length - 1) {
      setHistoryIndex(null);
      setInput(historyDraftRef.current);
      return;
    }

    const nextIndex = historyIndex + 1;
    setHistoryIndex(nextIndex);
    setInput(commandHistory[nextIndex] ?? "");
  };

  const sendCommand = async (raw?: string) => {
    const command = (raw ?? input).trim();
    if (!command || loading) return;

    const promptDir = formatPromptDir(currentPath);
    setCommandHistory((prev) => [...prev, command]);
    setHistoryIndex(null);
    historyDraftRef.current = "";

    try {
      const builtinResult = await executeBuiltinCommand(command, currentPath);
      if (builtinResult) {
        const nextPath = builtinResult.nextPath ?? currentPath;
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "user" as const,
            content: command,
            cwdLabel: promptDir,
          },
          ...(builtinResult.output
            ? [
                {
                  id: crypto.randomUUID(),
                  role: "assistant" as const,
                  content: builtinResult.output,
                },
              ]
            : []),
        ]);
        setCurrentPath(nextPath);
        setInput("");
        focusInput();
        return;
      }
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "user" as const,
          content: command,
          cwdLabel: promptDir,
        },
        {
          id: crypto.randomUUID(),
          role: "error" as const,
          content: `bash: 执行失败: ${(error as Error).message}`,
        },
      ]);
      setInput("");
      focusInput();
      return;
    }

    if (!ctx) {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "error" as const,
          content: "bash: error: 请先在设置中配置并选择可用模型。",
        },
      ]);
      return;
    }

    const assistantId = crypto.randomUUID();
    setMessages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        role: "user" as const,
        content: command,
        cwdLabel: promptDir,
      },
      { id: assistantId, role: "assistant" as const, content: "", streaming: true },
    ]);
    setInput("");
    setLoading(true);
    focusInput();

    try {
      await streamChat({
        conversationId: "",
        appId: "terminal",
        message: command,
        model: ctx.modelId,
        providerId: ctx.providerId,
        history: messages.map((m) => ({
          role: m.role === "error" ? "assistant" : m.role,
          content: m.content,
        })),
        apiKey: ctx.apiKey,
        apiBase: ctx.apiBase,
        compatType: ctx.compatType,
        enableMemory: false,
        systemPrompt:
          "你是 AI-Web OS 的终端 App。优先使用工具完成文件系统相关任务。输出保持终端风格，简洁、直接、可执行，不要使用聊天语气。严禁使用 Markdown 格式，不得使用反引号、代码块（```）、星号、井号等任何 Markdown 语法，直接输出纯文本。",
        onToken: (token) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, content: m.content + token } : m,
            ),
          );
        },
        onToolCall: (event) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    toolCalls: [
                      ...(m.toolCalls ?? []),
                      {
                        id: event.id,
                        name: event.name,
                        displayName: event.displayName ?? null,
                        args: event.args,
                        status: "running" as const,
                      },
                    ],
                  }
                : m,
            ),
          );
        },
        onToolResult: (event) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    toolCalls: (m.toolCalls ?? []).map((t) =>
                      t.id === event.id
                        ? {
                            ...t,
                            displayName: event.displayName ?? t.displayName ?? null,
                            result: event.result,
                            error: event.error,
                            status: event.error
                              ? ("error" as const)
                              : ("done" as const),
                          }
                        : t,
                    ),
                  }
                : m,
            ),
          );
        },
      });

      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId ? { ...m, streaming: false } : m,
        ),
      );
    } catch (error) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                role: "error" as const,
                streaming: false,
                content: `bash: 执行失败：${(error as Error).message}`,
              }
            : m,
        ),
      );
    } finally {
      setLoading(false);
      if (isFocused) focusInput();
    }
  };

  return (
    <>
      <style>{`
        .mac-terminal-root {
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
          text-rendering: optimizeLegibility;
          font-feature-settings: "liga" 0, "calt" 0;
        }
        .mac-terminal-root * {
          -webkit-font-smoothing: antialiased;
        }
        .mac-terminal-scroll::-webkit-scrollbar {
          width: 6px;
        }
        .mac-terminal-scroll::-webkit-scrollbar-thumb {
          background: ${T.scrollThumb};
          border-radius: 3px;
        }
        .mac-terminal-scroll::-webkit-scrollbar-track {
          background: transparent;
        }
        .mac-terminal-cursor {
          display: inline-block;
          width: 7px;
          height: 14px;
          background: ${T.text};
          margin-left: 1px;
          vertical-align: text-bottom;
          animation: mac-blink 1.2s step-end infinite;
        }
        @keyframes mac-blink {
          0%, 100% {
            opacity: 1;
          }
          50% {
            opacity: 0;
          }
        }
      `}</style>

      <div
        className="mac-terminal-root flex h-full flex-col overflow-hidden"
        style={{
          background: T.bg,
          fontFamily:
            "'Cascadia Code', 'Cascadia Mono', Consolas, Menlo, 'SF Mono', Monaco, 'Courier New', monospace",
        }}
      >
        <div
          ref={outputRef}
          className="mac-terminal-scroll min-h-0 flex-1 overflow-y-auto px-4 py-3"
          style={{ background: T.bg }}
          onClick={() => inputRef.current?.focus()}
        >
          <div
            style={{
              color: T.text,
              fontSize: 15,
              lineHeight: "1.6",
              marginBottom: 4,
            }}
          >
            Last login: {new Date().toUTCString().replace(" GMT", "")} on ttys000
          </div>

          {messages.length === 0 ? (
            <div style={{ fontSize: 15, lineHeight: "1.6", color: T.text }}>
              输入自然语言命令，系统将以终端方式响应。
            </div>
          ) : (
            <div>
              {messages.map((message) => (
                <TerminalEntry
                  key={message.id}
                  message={message}
                  loading={loading}
                />
              ))}
            </div>
          )}
        </div>

        <div
          style={{
            background: T.bg,
            borderTop: "1px solid rgba(255,255,255,0.06)",
            paddingLeft: 16,
            paddingRight: 16,
            paddingTop: 6,
            paddingBottom: 8,
            flexShrink: 0,
          }}
          onClick={() => inputRef.current?.focus()}
        >
          <div style={{ display: "flex", alignItems: "baseline" }}>
            <PromptPrefix dir={formatPromptDir(currentPath)} />
            <div
              style={{
                position: "relative",
                flex: 1,
                display: "flex",
                alignItems: "center",
              }}
            >
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => {
                  const nextValue = e.target.value;
                  setInput(nextValue);
                  if (historyIndex === null) {
                    historyDraftRef.current = nextValue;
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    handleHistoryNavigation("up");
                    return;
                  }
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    handleHistoryNavigation("down");
                    return;
                  }
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void sendCommand();
                  }
                }}
                disabled={loading}
                autoFocus
                placeholder={loading ? "" : ""}
                className="w-full bg-transparent outline-none"
                style={{
                  color: T.text,
                  fontFamily:
                    "'Cascadia Code', 'Cascadia Mono', Consolas, Menlo, 'SF Mono', Monaco, 'Courier New', monospace",
                  fontSize: 15,
                  lineHeight: "1.6",
                  caretColor: T.text,
                  border: "none",
                  padding: 0,
                }}
              />
              {loading && (
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    color: T.muted,
                    fontSize: 13,
                    marginLeft: 6,
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                  }}
                >
                  <Loader2 size={11} className="animate-spin" />
                  执行中…
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function TerminalEntry({
  message,
  loading,
}: {
  message: ChatMessage;
  loading: boolean;
}) {
  if (message.role === "user") {
    return (
      <div style={{ display: "flex", alignItems: "baseline", marginBottom: 2 }}>
        <PromptPrefix dir={message.cwdLabel || "~"} />
        <span
          style={{
            color: T.text,
            fontSize: 15,
            lineHeight: "1.6",
            whiteSpace: "pre-wrap",
          }}
        >
          {message.content}
        </span>
      </div>
    );
  }

  return (
    <div style={{ marginBottom: 10, paddingLeft: 0 }}>
      {message.toolCalls?.length ? (
        <div style={{ marginBottom: 4 }}>
          {message.toolCalls.map((tool) => (
            <ToolLog key={tool.id} tool={tool} />
          ))}
        </div>
      ) : null}

      {(message.content || message.streaming || loading) && (
        <pre
          style={{
            color: message.role === "error" ? T.error : T.output,
            fontSize: 15,
            lineHeight: "1.6",
            fontFamily:
              "'Cascadia Code', 'Cascadia Mono', Consolas, Menlo, 'SF Mono', Monaco, 'Courier New', monospace",
            whiteSpace: "pre-wrap",
            margin: 0,
            padding: 0,
          }}
        >
          {message.streaming ? message.content : stripCodeFences(message.content)}
          {message.streaming && <span className="mac-terminal-cursor" />}
        </pre>
      )}
    </div>
  );
}

function normalizeVirtualPath(path: string) {
  const raw = (path || "/").replace(/\\/g, "/").trim();
  if (!raw) return "/";
  const withRoot = raw.startsWith("/") ? raw : `/${raw}`;
  const parts = withRoot.split("/");
  const normalized: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      normalized.pop();
      continue;
    }
    normalized.push(part);
  }
  return `/${normalized.join("/")}`.replace(/\/+/g, "/") || "/";
}

function resolveTerminalPath(input: string, currentPath: string) {
  if (!input) return currentPath;
  if (input === "~") return "/";
  if (/^[a-zA-Z]:?$/.test(input)) return `/${input[0].toUpperCase()}`;
  if (input.startsWith("/")) return normalizeVirtualPath(input);
  return normalizeVirtualPath(`${currentPath}/${input}`);
}

function formatPromptDir(path: string) {
  if (!path || path === "/") return "~";
  return path;
}

function formatEntryLine(entry: FileEntry) {
  const typeLabel = entry.kind === "dir" ? "📁" : formatFileSize(entry.size);
  const updated = formatTimestamp(entry.updated_at);
  return `${updated}  ${typeLabel.padStart(8)}  ${entry.path}`;
}

function formatFileSize(size: number) {
  if (!Number.isFinite(size) || size < 1024) return `${Math.max(0, size)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = size / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[index]}`;
}

function formatTimestamp(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${d} ${hh}:${mm}`;
}

async function executeBuiltinCommand(
  command: string,
  currentPath: string,
): Promise<TerminalBuiltinResult | null> {
  const trimmed = command.trim();
  const enterDriveMatch = trimmed.match(/^进入\s*([a-zA-Z])\s*盘$/i);
  if (enterDriveMatch) {
    const nextPath = `/${enterDriveMatch[1].toUpperCase()}`;
    const response = await apiFetch<FilesResponse>(
      `/files?path=${encodeURIComponent(nextPath)}`,
    );
    return {
      nextPath,
      output: response.entries.length
        ? response.entries.map(formatEntryLine).join("\n")
        : "目录为空。",
    };
  }

  const listCommand = parseListCommand(trimmed);
  if (listCommand) {
    const targetPath = resolveTerminalPath(listCommand.path ?? ".", currentPath);
    const response = await apiFetch<FilesResponse>(
      `/files?path=${encodeURIComponent(targetPath)}`,
    );
    return {
      output: response.entries.length
        ? response.entries.map(formatEntryLine).join("\n")
        : "目录为空。",
    };
  }

  const cdMatch = trimmed.match(/^cd\s+(.+)$/i);
  if (cdMatch) {
    const nextPath = resolveTerminalPath(cdMatch[1].trim(), currentPath);
    await apiFetch<FileEntry>(`/files/resolve?path=${encodeURIComponent(nextPath)}`);
    return { nextPath, output: "" };
  }

  if (/^pwd$/i.test(trimmed)) {
    return { output: currentPath };
  }

  return null;
}

function parseListCommand(command: string): { path?: string } | null {
  const tokens = command.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;

  const head = tokens[0].toLowerCase();
  if (head !== "ll" && head !== "ls") return null;

  let path: string | undefined;
  for (const token of tokens.slice(1)) {
    if (token.startsWith("-")) continue;
    path = token;
    break;
  }

  return { path };
}

function ToolLog({ tool }: { tool: ToolCall }) {
  const [open, setOpen] = useState(false);

  return (
    <div style={{ marginBottom: 2 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 14,
          lineHeight: "1.6",
          cursor: "pointer",
          userSelect: "none",
        }}
        onClick={() => setOpen((v) => !v)}
      >
        <span
          style={{
            color: T.muted,
            display: "inline-block",
            transform: open ? "rotate(90deg)" : "rotate(0deg)",
            transition: "transform 0.15s ease",
          }}
        >
          ▶
        </span>
        <span style={{ color: tool.status === "error" ? T.toolError : T.toolLabel }}>
          {tool.status === "running" && (
            <Loader2
              size={11}
              className="animate-spin"
              style={{ display: "inline", marginRight: 4 }}
            />
          )}
          [{tool.displayName || tool.name}]
        </span>
        <span style={{ color: T.muted }}>{getToolSummary(tool)}</span>
        {tool.status === "done" && <span style={{ color: "#00D900" }}>✓</span>}
        {tool.status === "error" && <span style={{ color: T.toolError }}>✗</span>}
      </div>

      {open && tool.result && (
        <pre
          style={{
            margin: "0 0 0 16px",
            padding: "2px 0",
            fontSize: 14,
            lineHeight: "1.5",
            fontFamily:
              "'Cascadia Code', 'Cascadia Mono', Consolas, Menlo, 'SF Mono', Monaco, 'Courier New', monospace",
            color: tool.error ? T.toolError : T.toolResult,
            whiteSpace: "pre-wrap",
            borderLeft: `2px solid ${
              tool.error ? "rgba(229,0,0,0.3)" : "rgba(0,230,230,0.2)"
            }`,
            paddingLeft: 8,
          }}
        >
          {tool.result}
        </pre>
      )}
    </div>
  );
}

function stripCodeFences(text: string): string {
  return text.replace(/^```[^\n]*\n?([\s\S]*?)```\s*$/gm, "$1").trim();
}

function getToolSummary(tool: ToolCall) {
  if (tool.name === "list_files") return String(tool.args.path ?? "/");
  if (tool.name === "read_file") return String(tool.args.path ?? "");
  if (tool.name === "write_file") return String(tool.args.path ?? "");
  if (tool.name === "retrieve_knowledge") return String(tool.args.query ?? "");
  if (tool.name === "fetch_url") return String(tool.args.url ?? "");
  return JSON.stringify(tool.args).slice(0, 48);
}
