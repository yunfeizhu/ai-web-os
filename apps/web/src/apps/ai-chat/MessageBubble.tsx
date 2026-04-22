"use client";

import { useState } from "react";
import { Check, Copy, RotateCcw, Sparkles } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import type { Components } from "react-markdown";
import type { ChatMessage } from "./types";
import { ToolCallDisplay } from "./ToolCallDisplay";

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

export function MessageBubble({ message, onRetry }: Props) {
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
      <div className="flex justify-end px-4 py-1.5">
        <div
          className="max-w-[70%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-[14px] leading-relaxed"
          style={{
            background: "var(--accent)",
            color: "#fff",
            wordBreak: "break-word",
            borderBottomRightRadius: 4,
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
      className="flex px-4"
      style={{ paddingTop: 6, paddingBottom: 28 }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        className="mr-3 mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
        style={{
          background: "linear-gradient(135deg,#a78bfa,#6366f1)",
          flexShrink: 0,
        }}
      >
        <Sparkles size={14} color="white" strokeWidth={1.8} />
      </div>

      <div className="relative min-w-0 flex-1">
        <ToolCallDisplay
          toolCalls={message.toolCalls}
          subagentTokens={message.subagentTokens}
          subagentDone={message.subagentDone}
          subagentResults={message.subagentResults}
        />
        <div
          className="markdown text-[14px] leading-relaxed"
          style={{ color: "var(--t1)", wordBreak: "break-word" }}
        >
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={markdownComponents}
          >
            {message.content}
          </ReactMarkdown>
          {message.streaming && <StreamingDots />}
        </div>

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
