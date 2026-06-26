"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Search, Upload } from "lucide-react";

import { ApiKeyConfig } from "./ApiKeyConfig";
import { AvatarSettings } from "./AvatarSettings";
import { ChannelSettings } from "./ChannelSettings";
import { ExtensionCenter } from "./ExtensionCenter";
import { KnowledgeBase } from "./KnowledgeBase";
import { MemoryManager } from "./MemoryManager";
import { ThemeConfig } from "./ThemeConfig";

type Tab =
  | "api-keys"
  | "appearance"
  | "avatar"
  | "memory"
  | "knowledge"
  | "channels"
  | "extensions"
  | "about";

const TAB_IDS: Tab[] = [
  "api-keys",
  "appearance",
  "avatar",
  "memory",
  "knowledge",
  "channels",
  "extensions",
  "about",
];

function isTab(value: unknown): value is Tab {
  return typeof value === "string" && TAB_IDS.includes(value as Tab);
}

function readInitialTab(appState?: Record<string, unknown>): Tab {
  return isTab(appState?.initialTab) ? appState.initialTab : "api-keys";
}

const SETTINGS_ICON_BASE = "/icons/settings";

const TABS: { id: Tab; label: string; iconSrc: string }[] = [
  {
    id: "api-keys",
    label: "模型与密钥",
    iconSrc: `${SETTINGS_ICON_BASE}/models.png`,
  },
  {
    id: "appearance",
    label: "外观",
    iconSrc: `${SETTINGS_ICON_BASE}/appearance.png`,
  },
  {
    id: "avatar",
    label: "虚拟伙伴",
    iconSrc: `${SETTINGS_ICON_BASE}/avatar.png`,
  },
  {
    id: "memory",
    label: "记忆",
    iconSrc: `${SETTINGS_ICON_BASE}/memory.png`,
  },
  {
    id: "knowledge",
    label: "知识库",
    iconSrc: `${SETTINGS_ICON_BASE}/knowledge.png`,
  },
  {
    id: "channels",
    label: "渠道接入",
    iconSrc: `${SETTINGS_ICON_BASE}/channels.png`,
  },
  {
    id: "extensions",
    label: "扩展能力",
    iconSrc: `${SETTINGS_ICON_BASE}/extensions.png`,
  },
  { id: "about", label: "关于", iconSrc: `${SETTINGS_ICON_BASE}/about.png` },
];

// ── 本地配置 localStorage 键列表（需随 store 同步更新）
const LOCAL_STORAGE_KEYS = [
  "ai-os-settings",
  "ainative-desktop",
  "ainative-avatar",
] as const;

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
  a.download = `ai-web-os-config-${new Date().toISOString().slice(0, 10)}.json`;
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

interface SettingsProps {
  appState?: Record<string, unknown>;
}

export function Settings({ appState }: SettingsProps) {
  const [tab, setTab] = useState<Tab>(() => readInitialTab(appState));
  const [query, setQuery] = useState("");
  const visibleTabs = TABS.filter((tabItem) =>
    tabItem.label.toLowerCase().includes(query.trim().toLowerCase()),
  );

  useEffect(() => {
    if (isTab(appState?.initialTab)) {
      setTab(appState.initialTab);
    }
  }, [appState]);

  return (
    <div
      className="settings-root settings-macos flex h-full overflow-hidden"
      style={{ color: "var(--t1)" }}
    >
      <nav
        className="settings-sidebar flex w-[236px] shrink-0 flex-col px-4 pb-4 pt-5"
      >
        <label className="settings-search mb-4 flex h-9 items-center gap-2 rounded-[11px] px-3">
          <Search
            aria-hidden="true"
            className="settings-search-icon h-[13px] w-[13px] shrink-0"
            strokeWidth={2.15}
          />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="min-w-0 flex-1 border-0 bg-transparent p-0 text-[14px] outline-none"
            placeholder="搜索"
          />
        </label>

        <div className="settings-account mb-5 flex items-center gap-3 rounded-[14px] px-2.5 py-2.5">
          <div className="settings-account-avatar flex h-10 w-10 shrink-0 items-center justify-center">
            <img
              src={`${SETTINGS_ICON_BASE}/account.png`}
              alt=""
              className="h-10 w-10"
              draggable={false}
            />
          </div>
          <div className="min-w-0">
            <div className="truncate text-[15px] font-semibold">AI-Web OS</div>
            <div className="truncate text-[12px]">本地账户</div>
          </div>
        </div>

        <div className="settings-nav-scroll min-h-0 flex-1 overflow-y-auto">
          <div className="mb-2 px-2 text-[12px] font-semibold">系统设置</div>
          <div className="space-y-1">
            {(visibleTabs.length ? visibleTabs : TABS).map((tabItem) => (
              <button
                key={tabItem.id}
                onClick={() => setTab(tabItem.id)}
                className="settings-nav-button flex h-[34px] w-full items-center gap-2.5 rounded-[9px] px-2.5 text-left text-[14px] font-medium transition-colors"
                data-active={tab === tabItem.id}
              >
                <span className="settings-nav-icon flex h-6 w-6 shrink-0 items-center justify-center">
                  <img
                    src={tabItem.iconSrc}
                    alt=""
                    className="h-6 w-6"
                    draggable={false}
                  />
                </span>
                <span className="min-w-0 truncate">{tabItem.label}</span>
              </button>
            ))}
          </div>
        </div>
      </nav>

      <div className="settings-content flex-1 overflow-y-auto">
        <div className="settings-content-inner mx-auto w-full max-w-[900px] px-8 pb-10 pt-7">
          {tab === "api-keys" && <ApiKeyConfig />}
          {tab === "appearance" && <ThemeConfig />}
          {tab === "avatar" && <AvatarSettings />}
          {tab === "memory" && <MemoryManager />}
          {tab === "knowledge" && <KnowledgeBase />}
          {tab === "channels" && <ChannelSettings />}
          {tab === "extensions" && <ExtensionCenter />}
          {tab === "about" && <AboutPanel />}
        </div>
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
      <SectionTitle>关于 AI-Web OS</SectionTitle>

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
          AI-Web OS 是以 AI Agent 为核心运行时的新一代本地智能操作系统原型。
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
              location: "本地文件 (~/.ai-web-os/mcp.json)",
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
      className="settings-section-title mb-4 text-[22px] font-semibold"
      style={{ color: "var(--t1)" }}
    >
      {children}
    </h2>
  );
}
