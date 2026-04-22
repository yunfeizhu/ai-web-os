"use client";

import { useRef, useState } from "react";
import {
  BookOpen,
  Boxes,
  Brain,
  Download,
  Info,
  KeyRound,
  Palette,
  Upload,
} from "lucide-react";

import { AppManager } from "./AppManager";
import { ApiKeyConfig } from "./ApiKeyConfig";
import { KnowledgeBase } from "./KnowledgeBase";
import { MemoryManager } from "./MemoryManager";
import { ThemeConfig } from "./ThemeConfig";

type Tab =
  | "api-keys"
  | "appearance"
  | "memory"
  | "knowledge"
  | "extensions"
  | "about";

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "api-keys", label: "模型与密钥", icon: <KeyRound size={15} /> },
  { id: "appearance", label: "外观", icon: <Palette size={15} /> },
  { id: "memory", label: "记忆", icon: <Brain size={15} /> },
  { id: "knowledge", label: "知识库", icon: <BookOpen size={15} /> },
  { id: "extensions", label: "扩展能力", icon: <Boxes size={15} /> },
  { id: "about", label: "关于", icon: <Info size={15} /> },
];

// ── 本地配置 localStorage 键列表（需随 store 同步更新）
const LOCAL_STORAGE_KEYS = ["ai-os-settings", "ainative-desktop"] as const;

const CONFIG_VERSION = "1";

function exportConfig() {
  const snapshot: Record<string, unknown> = {
    _version: CONFIG_VERSION,
    _exported_at: new Date().toISOString(),
  };
  for (const key of LOCAL_STORAGE_KEYS) {
    const raw = localStorage.getItem(key);
    if (raw) {
      try {
        snapshot[key] = JSON.parse(raw);
      } catch {
        snapshot[key] = raw;
      }
    }
  }
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `ai-native-os-config-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importConfig(file: File, onDone: (ok: boolean, msg: string) => void) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target?.result as string) as Record<
        string,
        unknown
      >;
      for (const key of LOCAL_STORAGE_KEYS) {
        if (key in data) {
          localStorage.setItem(key, JSON.stringify(data[key]));
        }
      }
      onDone(true, "配置已导入，页面将在 1 秒后刷新以生效");
      setTimeout(() => window.location.reload(), 1000);
    } catch {
      onDone(false, "文件格式错误，请选择有效的配置文件");
    }
  };
  reader.readAsText(file);
}

export function Settings() {
  const [tab, setTab] = useState<Tab>("api-keys");

  return (
    <div className="settings-root flex h-full" style={{ color: "var(--t1)" }}>
      <nav
        className="flex w-[180px] shrink-0 flex-col gap-0.5 p-2"
        style={{
          borderRight: "0.5px solid var(--border)",
          background: "var(--panel-bg-soft)",
        }}
      >
        {TABS.map((tabItem) => (
          <button
            key={tabItem.id}
            onClick={() => setTab(tabItem.id)}
            className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[14px] font-medium transition-colors"
            style={{
              background: tab === tabItem.id ? "var(--accent)" : "transparent",
              color: tab === tabItem.id ? "#fff" : "var(--t2)",
            }}
          >
            {tabItem.icon}
            {tabItem.label}
          </button>
        ))}
      </nav>

      <div className="flex-1 overflow-y-auto p-5">
        {tab === "api-keys" && <ApiKeyConfig />}
        {tab === "appearance" && <ThemeConfig />}
        {tab === "memory" && <MemoryManager />}
        {tab === "knowledge" && <KnowledgeBase />}
        {tab === "extensions" && <AppManager />}
        {tab === "about" && <AboutPanel />}
      </div>
    </div>
  );
}

function AboutPanel() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [importStatus, setImportStatus] = useState<{
    ok: boolean;
    msg: string;
  } | null>(null);

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    importConfig(file, (ok, msg) => setImportStatus({ ok, msg }));
    e.target.value = "";
  };

  return (
    <div className="space-y-6">
      <SectionTitle>关于 AI-Native OS</SectionTitle>

      {/* 版本信息 */}
      <div
        className="space-y-3 rounded-xl p-5 text-[14px] leading-relaxed"
        style={{
          background: "var(--panel-bg)",
          border: "0.5px solid var(--border)",
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
          <span style={{ color: "var(--t1)" }}>
            0.1.0 - Phase I: OS Core Shell
          </span>
        </div>
        <p>
          AI-Native OS 是以 AI Agent 为核心运行时的新一代本地智能操作系统原型。
        </p>
      </div>

      {/* 数据归属说明 */}
      <div>
        <h3
          className="mb-3 text-[14px] font-semibold"
          style={{ color: "var(--t1)" }}
        >
          数据归属
        </h3>
        <div
          className="rounded-xl text-[13px]"
          style={{ border: "0.5px solid var(--border)", overflow: "hidden" }}
        >
          {[
            {
              label: "API Keys / 模型配置",
              location: "浏览器 localStorage",
              note: "从不上传服务器",
              secure: true,
            },
            {
              label: "Embedding 配置",
              location: "浏览器 localStorage",
              note: "从不上传服务器",
              secure: true,
            },
            {
              label: "外部 MCP 配置",
              location: "本地文件 (~/.ai-native-os/mcp.json)",
              note: "仅本地进程读取",
              secure: true,
            },
            {
              label: "主题 / 壁纸",
              location: "浏览器 localStorage",
              note: "",
              secure: false,
            },
            {
              label: "对话历史 / 记忆",
              location: "本地数据库 (PostgreSQL)",
              note: "可本地部署",
              secure: false,
            },
          ].map((row, i) => (
            <div
              key={i}
              className="flex items-center gap-3 px-4 py-2.5"
              style={{
                borderTop: i > 0 ? "0.5px solid var(--border)" : undefined,
                background: "var(--panel-bg)",
              }}
            >
              <span className="w-40 shrink-0" style={{ color: "var(--t1)" }}>
                {row.label}
              </span>
              <span className="flex-1" style={{ color: "var(--t2)" }}>
                {row.location}
              </span>
              {row.secure && (
                <span
                  className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                  style={{
                    background: "color-mix(in srgb, #34c759 15%, transparent)",
                    color: "#34c759",
                  }}
                >
                  {row.note}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* 配置导出 / 导入 */}
      <div>
        <h3
          className="mb-3 text-[14px] font-semibold"
          style={{ color: "var(--t1)" }}
        >
          配置备份
        </h3>
        <p className="mb-4 text-[13px]" style={{ color: "var(--t2)" }}>
          导出的 JSON 文件包含所有本地存储的配置（含 API Keys），请妥善保管。
        </p>
        <div className="flex gap-3">
          <button
            onClick={exportConfig}
            className="flex items-center gap-2 rounded-lg px-4 py-2 text-[13px] font-medium transition-colors"
            style={{
              background: "var(--accent)",
              color: "#fff",
            }}
          >
            <Download size={14} />
            导出配置
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            className="flex items-center gap-2 rounded-lg px-4 py-2 text-[13px] font-medium transition-colors"
            style={{
              background: "var(--panel-bg)",
              border: "0.5px solid var(--border)",
              color: "var(--t1)",
            }}
          >
            <Upload size={14} />
            导入配置
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={handleImport}
          />
        </div>
        {importStatus && (
          <p
            className="mt-3 text-[13px]"
            style={{ color: importStatus.ok ? "#34c759" : "#ff453a" }}
          >
            {importStatus.msg}
          </p>
        )}
      </div>
    </div>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2
      className="mb-4 text-[16px] font-semibold"
      style={{ color: "var(--t1)" }}
    >
      {children}
    </h2>
  );
}
