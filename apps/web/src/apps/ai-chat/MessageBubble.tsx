"use client";

import { memo, useEffect, useRef, useState } from "react";
import { Brain, Check, Copy, RotateCcw, Sparkles } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import type { Components } from "react-markdown";
import type { AppWorkflowSummary, ChatMessage } from "./types";
import { buildUsageEstimateLabels } from "./usageEstimate";
import { ToolCallDisplay } from "./ToolCallDisplay";
import { summarizeWorkflowForDisplay } from "./workflowSummary";
import { buildReasoningDisplayText } from "./reasoningDisplay";

interface Props {
  message: ChatMessage;
  onRetry?: () => void;
}

const markdownComponents: Components = {
  code({ className, children, ...props }) {
    const match = /language-(\w+)/.exec(className ?? "");
    const isBlock = !!match || String(children).includes("\n");

    if (isBlock) {
      const lang = match?.[1] ?? "text";
      const code = String(children).replace(/\n$/, "");
      return <CodeBlock lang={lang} code={code} />;
    }

    return (
      <code
        className={className}
        style={{
          fontFamily: "var(--font-mono, ui-monospace, monospace)",
          fontSize: "0.95em",
          background: "var(--control-bg)",
          padding: "0.15em 0.4em",
          borderRadius: 4,
        }}
        {...props}
      >
        {children}
      </code>
    );
  },
};

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className="relative my-2 overflow-hidden rounded-xl"
      style={{ border: "0.5px solid var(--border)" }}
    >
      <div
        className="flex items-center justify-between px-3 py-1.5"
        style={{
          background: "var(--panel-bg)",
          borderBottom: "0.5px solid var(--border)",
        }}
      >
        <span
          className="text-[12px] font-medium"
          style={{ color: "var(--t3)", fontFamily: "var(--font-mono)" }}
        >
          {lang}
        </span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[12px] transition-colors"
          style={{ color: copied ? "#22C55E" : "var(--t3)" }}
          onMouseEnter={(event) => {
            event.currentTarget.style.background = "var(--control-bg)";
          }}
          onMouseLeave={(event) => {
            event.currentTarget.style.background = "transparent";
          }}
        >
          {copied ? (
            <>
              <Check size={11} /> 已复制
            </>
          ) : (
            <>
              <Copy size={11} /> 复制
            </>
          )}
        </button>
      </div>
      <SyntaxHighlighter
        language={lang}
        style={oneDark}
        customStyle={{
          margin: 0,
          padding: "0.8em 1em",
          fontSize: "0.92em",
          background: "var(--surface-solid)",
          borderRadius: 0,
        }}
        codeTagProps={{
          style: { fontFamily: "var(--font-mono, ui-monospace, monospace)" },
        }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
}

const MarkdownBody = memo(function MarkdownBody({
  content,
}: {
  content: string;
}) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
      {content}
    </ReactMarkdown>
  );
});

function UsageEstimate({ message }: { message: ChatMessage }) {
  const usage = message.usageEstimate;
  if (!usage) return null;
  const labels = buildUsageEstimateLabels(usage);

  return (
    <div
      className="mt-3 inline-flex flex-wrap items-center gap-2 rounded-full px-3 py-1 text-[11px]"
      style={{
        color: "var(--t3)",
        background: "var(--control-bg)",
        border: "0.5px solid var(--border)",
      }}
    >
      {labels.map((label) => (
        <span key={label}>{label}</span>
      ))}
    </div>
  );
}

function WorkflowSummary({ summary }: { summary?: AppWorkflowSummary }) {
  if (!summary) return null;

  const title = summarizeWorkflowForDisplay(summary);
  if (!title) return null;

  return (
    <div
      className="mb-3 mt-2 rounded-2xl p-3"
      style={{
        background: "var(--panel-bg)",
        border: "0.5px solid var(--border)",
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p
            className="text-[12px] font-semibold"
            style={{ color: "var(--t1)" }}
          >
            {title}
          </p>
          <p className="mt-0.5 text-[11px]" style={{ color: "var(--t3)" }}>
            {summary.appCount} 个系统 App 参与，按执行结果自动归类。
          </p>
        </div>
        <span
          className="rounded-full px-2 py-1 text-[11px]"
          style={{
            color: summary.hasFailures ? "var(--red)" : "var(--accent)",
            background: "var(--control-bg)",
          }}
        >
          {summary.hasFailures ? "需要关注" : "执行汇总"}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {summary.steps.map((step) => (
          <span
            key={step.id}
            className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px]"
            style={{
              color:
                step.status === "failed"
                  ? "var(--red)"
                  : step.status === "completed"
                    ? "var(--accent)"
                    : "var(--t3)",
              background: "var(--control-bg)",
            }}
          >
            {step.status === "completed" && <Check size={10} />}
            {step.status === "failed" && "!"}
            {step.appName}
          </span>
        ))}
      </div>

      {summary.results.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {summary.results.slice(0, 4).map((result, index) => (
            <div
              key={`${result.appId}:${result.id ?? index}`}
              className="rounded-xl px-2.5 py-2 text-[11px]"
              style={{ background: "var(--control-bg)", color: "var(--t2)" }}
            >
              <span className="font-medium" style={{ color: "var(--t1)" }}>
                {result.appName}
              </span>
              {result.tool && <span> · {result.tool}</span>}
              {result.preview && (
                <span style={{ color: "var(--t3)" }}> · {result.preview}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MessageBubbleView({ message, onRetry }: Props) {
  const isUser = message.role === "user";
  const isError = message.role === "error";
  const [copied, setCopied] = useState(false);
  const [hovered, setHovered] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (isUser) {
    return (
      <div className="flex justify-end px-5 py-1.5">
        <div
          className="max-w-[72%] whitespace-pre-wrap rounded-[20px] px-4 py-2.5 text-[14px] leading-relaxed"
          style={{
            background: "linear-gradient(180deg, #39A7FF, #007AFF)",
            color: "#fff",
            wordBreak: "break-word",
            borderBottomRightRadius: 6,
            boxShadow:
              "0 10px 24px rgba(0,122,255,0.2), inset 0 1px 0 rgba(255,255,255,0.25)",
          }}
        >
          {message.content}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex px-4 py-1.5">
        <div
          className="mr-3 mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
          style={{ background: "rgba(255,59,48,0.1)", fontSize: 14 }}
        >
          ⚠
        </div>
        <div className="min-w-0 flex-1">
          <p
            className="py-1 text-[14px] leading-relaxed"
            style={{ color: "var(--red)" }}
          >
            {message.content}
          </p>
          {onRetry && (
            <button
              onClick={onRetry}
              className="mt-1 flex items-center gap-1 rounded-lg px-2 py-1 text-[12px] transition-colors"
              style={{
                color: "var(--accent)",
                background: "rgba(10, 132, 255, 0.12)",
              }}
            >
              <RotateCcw size={11} /> 重试
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex px-5"
      style={{ paddingTop: 6, paddingBottom: 30 }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        className="mr-3 mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[12px]"
        style={{
          background:
            "linear-gradient(145deg, rgba(255,255,255,0.96), rgba(220,232,255,0.78))",
          border: "0.5px solid rgba(0,0,0,0.08)",
          boxShadow:
            "0 8px 18px rgba(30,64,175,0.12), inset 0 1px 0 rgba(255,255,255,0.88)",
          flexShrink: 0,
        }}
      >
        <Sparkles size={16} color="#0A84FF" strokeWidth={1.8} />
      </div>

      <div className="relative min-w-0 flex-1">
        <ReasoningBlock
          content={message.reasoningContent}
          streaming={message.streaming}
        />
        <ToolCallDisplay
          toolCalls={message.toolCalls}
          subagentTokens={message.subagentTokens}
          subagentDone={message.subagentDone}
          subagentResults={message.subagentResults}
        />
        <WorkflowSummary summary={message.workflowSummary} />
        <div
          className="markdown rounded-[18px] px-4 py-3 text-[14px] leading-relaxed"
          style={{
            color: "var(--t1)",
            wordBreak: "break-word",
            background: "rgba(255,255,255,0.62)",
            border: "0.5px solid rgba(0,0,0,0.07)",
            boxShadow:
              "0 1px 2px rgba(0,0,0,0.04), inset 0 1px 0 rgba(255,255,255,0.7)",
          }}
        >
          <MarkdownBody content={message.content} />
          {message.streaming && <StreamingDots />}
        </div>
        {!message.streaming && <UsageEstimate message={message} />}

        {!message.streaming && hovered && (
          <div
            className="absolute flex items-center gap-0.5"
            style={{ bottom: -26, left: 0 }}
          >
            <ActionBtn
              onClick={handleCopy}
              tooltip={copied ? "已复制" : "复制"}
            >
              {copied ? (
                <Check size={13} color="#22C55E" />
              ) : (
                <Copy size={13} />
              )}
            </ActionBtn>
            {onRetry && (
              <ActionBtn onClick={onRetry} tooltip="重新生成">
                <RotateCcw size={13} />
              </ActionBtn>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export const MessageBubble = memo(
  MessageBubbleView,
  (prev, next) =>
    prev.message === next.message &&
    Boolean(prev.onRetry) === Boolean(next.onRetry),
);

function ReasoningBlock({
  content,
  streaming,
}: {
  content?: string;
  streaming?: boolean;
}) {
  const text = buildReasoningDisplayText(content);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!streaming) return;
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [text, streaming]);

  if (!text) return null;

  return (
    <div
      className="mb-3 overflow-hidden rounded-lg text-[12px]"
      style={{
        border: "0.5px solid var(--border)",
        background: "var(--panel-bg)",
      }}
    >
      <div
        className="flex items-center gap-1.5 px-3 py-1.5 font-medium"
        style={{
          color: "var(--t2)",
          borderBottom: "0.5px solid var(--border)",
        }}
      >
        <Brain size={13} strokeWidth={1.8} />
        <span>思考过程</span>
      </div>
      <div
        ref={scrollRef}
        className="max-h-56 overflow-auto px-3 py-2 leading-relaxed"
        style={{
          color: "var(--t3)",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {text}
      </div>
    </div>
  );
}

function StreamingDots() {
  return (
    <span
      className="ml-1 inline-flex items-center gap-[3px] align-middle"
      style={{ height: "1em" }}
    >
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className="inline-block rounded-full"
          style={{
            width: 4,
            height: 4,
            background: "var(--t3)",
            animation: "dotBounce 1.2s ease-in-out infinite",
            animationDelay: `${index * 0.2}s`,
          }}
        />
      ))}
      <style>{`
        @keyframes dotBounce {
          0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
          40% { transform: translateY(-4px); opacity: 1; }
        }
      `}</style>
    </span>
  );
}

function ActionBtn({
  children,
  onClick,
  tooltip,
}: {
  children: React.ReactNode;
  onClick: () => void;
  tooltip: string;
}) {
  return (
    <button
      onClick={onClick}
      title={tooltip}
      className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors"
      style={{ color: "var(--t3)" }}
      onMouseEnter={(event) => {
        event.currentTarget.style.background = "var(--control-bg)";
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.background = "transparent";
      }}
    >
      {children}
    </button>
  );
}
