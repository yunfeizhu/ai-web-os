"use client";

import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Link,
  Calculator,
  Code2,
  Loader2,
  CheckCircle2,
  AlertCircle,
  BookOpen,
  Globe,
  MousePointerClick,
  Keyboard,
  Hourglass,
  XCircle,
} from "lucide-react";
import type { ToolCall } from "./types";

const TOOL_META: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  fetch_url:          { label: "读取网页",  icon: <Link size={13} />,       color: "#5856D6" },
  calculator:         { label: "计算器",    icon: <Calculator size={13} />, color: "#34C759" },
  python_exec:        { label: "执行代码",  icon: <Code2 size={13} />,      color: "#FF9F0A" },
  retrieve_knowledge: { label: "知识库检索", icon: <BookOpen size={13} />,  color: "#5AC8FA" },
  browser_create_session: { label: "创建浏览器会话", icon: <Globe size={13} />, color: "#0A84FF" },
  browser_open: { label: "打开网页", icon: <Globe size={13} />, color: "#0A84FF" },
  browser_click: { label: "点击页面元素", icon: <MousePointerClick size={13} />, color: "#2563EB" },
  browser_type: { label: "输入文本", icon: <Keyboard size={13} />, color: "#2563EB" },
  browser_press: { label: "按键", icon: <Keyboard size={13} />, color: "#2563EB" },
  browser_wait_for: { label: "等待页面", icon: <Hourglass size={13} />, color: "#F59E0B" },
  browser_extract_text: { label: "提取页面正文", icon: <BookOpen size={13} />, color: "#14B8A6" },
  browser_get_state: { label: "读取页面状态", icon: <Globe size={13} />, color: "#6366F1" },
  browser_close_session: { label: "关闭浏览器会话", icon: <XCircle size={13} />, color: "#EF4444" },
};

function getArgsSummary(name: string, args: Record<string, unknown>): string {
  if (name === "fetch_url")   return String(args.url ?? "");
  if (name === "calculator")  return String(args.expression ?? "");
  if (name === "python_exec") {
    const code = String(args.code ?? "");
    const firstLine = code.split("\n")[0];
    return firstLine.length > 50 ? firstLine.slice(0, 50) + "…" : firstLine;
  }
  if (name === "retrieve_knowledge") return String(args.query ?? "");
  if (name === "browser_open") return String(args.url ?? "");
  if (name === "browser_click" || name === "browser_type" || name === "browser_wait_for") {
    return String(args.selector ?? "");
  }
  if (name === "browser_press") return String(args.key ?? "");
  if (
    name === "browser_create_session" ||
    name === "browser_extract_text" ||
    name === "browser_get_state" ||
    name === "browser_close_session"
  ) {
    return String(args.session_id ?? "");
  }
  return JSON.stringify(args).slice(0, 60);
}

interface ToolCallItemProps {
  tc: ToolCall;
}

function ToolCallItem({ tc }: ToolCallItemProps) {
  const [expanded, setExpanded] = useState(false);
  const meta = TOOL_META[tc.name] ?? { label: tc.displayName || tc.name, icon: <Code2 size={13} />, color: "#888" };
  const argsSummary = getArgsSummary(tc.name, tc.args);

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{
        border: "0.5px solid rgba(0,0,0,0.09)",
        background: "rgba(0,0,0,0.02)",
        marginBottom: 6,
      }}
    >
      {/* 工具调用头部 */}
      <button
        onClick={() => tc.status !== "running" && setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left transition-colors"
        style={{ cursor: tc.status === "running" ? "default" : "pointer" }}
        onMouseEnter={(e) => {
          if (tc.status !== "running") (e.currentTarget as HTMLElement).style.background = "rgba(0,0,0,0.03)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.background = "transparent";
        }}
      >
        {/* 状态图标 */}
        <span className="shrink-0">
          {tc.status === "running" ? (
            <Loader2 size={13} style={{ color: meta.color, animation: "spin 1s linear infinite" }} />
          ) : tc.status === "error" ? (
            <AlertCircle size={13} style={{ color: "#FF3B30" }} />
          ) : (
            <CheckCircle2 size={13} style={{ color: "#28C840" }} />
          )}
        </span>

        {/* 工具图标 + 名称 */}
        <span className="shrink-0 flex items-center gap-1" style={{ color: meta.color }}>
          {meta.icon}
          <span className="text-[12px] font-medium">{meta.label}</span>
        </span>

        {/* 参数摘要 */}
        {argsSummary && (
          <span
            className="flex-1 min-w-0 text-[12px] truncate"
            style={{ color: "var(--t3)", fontFamily: "var(--font-mono)" }}
          >
            {argsSummary}
          </span>
        )}

        {/* 展开箭头 */}
        {tc.status !== "running" && (
          <span className="shrink-0 ml-auto" style={{ color: "var(--t3)" }}>
            {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </span>
        )}
      </button>

      {/* 展开内容：结果 */}
      {expanded && tc.result !== undefined && (
        <div
          style={{
            borderTop: "0.5px solid rgba(0,0,0,0.07)",
            padding: "8px 12px",
            background: "rgba(0,0,0,0.015)",
          }}
        >
          <pre
            className="text-[12px] leading-relaxed whitespace-pre-wrap"
            style={{
              color: tc.error ? "var(--red)" : "var(--t2)",
              fontFamily: "var(--font-mono)",
              maxHeight: 240,
              overflowY: "auto",
              wordBreak: "break-word",
            }}
          >
            {tc.result}
          </pre>
        </div>
      )}
    </div>
  );
}

interface ToolCallDisplayProps {
  toolCalls?: ToolCall[];
}

export function ToolCallDisplay({ toolCalls }: ToolCallDisplayProps) {
  if (!toolCalls || toolCalls.length === 0) return null;

  return (
    <div className="mb-2">
      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
      {toolCalls.map((tc) => (
        <ToolCallItem key={tc.id} tc={tc} />
      ))}
    </div>
  );
}
