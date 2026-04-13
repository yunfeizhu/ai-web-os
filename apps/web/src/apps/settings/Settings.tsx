"use client";

import { useState } from "react";
import { BookOpen, Brain, Info, KeyRound, Palette } from "lucide-react";
import { ApiKeyConfig } from "./ApiKeyConfig";
import { KnowledgeBase } from "./KnowledgeBase";
import { MemoryManager } from "./MemoryManager";
import { ThemeConfig } from "./ThemeConfig";

type Tab = "api-keys" | "appearance" | "memory" | "knowledge" | "about";

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "api-keys", label: "API Keys", icon: <KeyRound size={15} /> },
  { id: "appearance", label: "外观", icon: <Palette size={15} /> },
  { id: "memory", label: "记忆", icon: <Brain size={15} /> },
  { id: "knowledge", label: "知识库", icon: <BookOpen size={15} /> },
  { id: "about", label: "关于", icon: <Info size={15} /> },
];

export function Settings() {
  const [tab, setTab] = useState<Tab>("api-keys");

  return (
    <div className="flex h-full" style={{ color: "var(--t1)" }}>
      <nav
        className="flex w-[180px] shrink-0 flex-col gap-0.5 p-2"
        style={{
          borderRight: "0.5px solid rgba(0,0,0,0.08)",
          background: "rgba(0,0,0,0.02)",
        }}
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[14px] font-medium transition-colors"
            style={{
              background: tab === t.id ? "var(--accent)" : "transparent",
              color: tab === t.id ? "#fff" : "var(--t2)",
            }}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </nav>

      <div className="flex-1 overflow-y-auto p-5">
        {tab === "api-keys" && <ApiKeyConfig />}
        {tab === "appearance" && <ThemeConfig />}
        {tab === "memory" && <MemoryManager />}
        {tab === "knowledge" && <KnowledgeBase />}
        {tab === "about" && <AboutPanel />}
      </div>
    </div>
  );
}

function AboutPanel() {
  return (
    <div>
      <SectionTitle>关于 AI-Native OS</SectionTitle>
      <div
        className="space-y-3 rounded-xl p-5 text-[14px] leading-relaxed"
        style={{
          background: "rgba(0,0,0,0.03)",
          border: "0.5px solid rgba(0,0,0,0.08)",
          color: "var(--t2)",
        }}
      >
        <div className="flex items-center gap-2">
          <span
            className="text-[11px] font-semibold uppercase tracking-wide"
            style={{ color: "var(--t3)" }}
          >
            版本
          </span>
          <span style={{ color: "var(--t1)" }}>0.1.0 - Phase I: OS Core Shell</span>
        </div>
        <p>AI-Native OS 是以 AI Agent 为核心运行时的全新计算范式。</p>
      </div>
    </div>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-4 text-[16px] font-semibold" style={{ color: "var(--t1)" }}>
      {children}
    </h2>
  );
}
