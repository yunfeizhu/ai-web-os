"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  AppWindow,
  Boxes,
  Cable,
  CheckCircle2,
  KeyRound,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Wrench,
} from "lucide-react";

import { apiFetch } from "@/lib/backend";
import { SectionTitle } from "./Settings";
import { AppManager } from "./AppManager";

export type ExtensionKind = "app" | "mcp" | "skill";

export interface ExtensionTool {
  name: string;
  description?: string;
}

export interface ExtensionSummary {
  id: string;
  kind: ExtensionKind;
  name: string;
  description: string;
  version: string;
  source: "builtin" | "local" | "external" | string;
  sourcePath: string;
  enabled: boolean;
  status: "ok" | "warning" | "error" | "disabled" | string;
  runtimeStatus: string;
  category: string;
  permissions: string[];
  tools: ExtensionTool[];
  transport?: string | null;
  lastError?: string | null;
}

export function summarizeExtensions(extensions: ExtensionSummary[]) {
  return {
    total: extensions.length,
    apps: extensions.filter((item) => item.kind === "app").length,
    mcp: extensions.filter((item) => item.kind === "mcp").length,
    skills: extensions.filter((item) => item.kind === "skill").length,
    available: extensions.filter((item) => item.status === "ok").length,
    disabled: extensions.filter((item) => item.status === "disabled").length,
    attention: extensions.filter((item) => item.status === "warning" || item.status === "error").length,
    tools: extensions.reduce((sum, item) => sum + item.tools.length, 0),
  };
}

type Filter = "all" | ExtensionKind | "attention";

const KIND_META: Record<ExtensionKind, { label: string; icon: React.ReactNode; color: string }> = {
  app: { label: "App", icon: <AppWindow size={13} />, color: "#0EA5E9" },
  mcp: { label: "MCP", icon: <Cable size={13} />, color: "#059669" },
  skill: { label: "Skill", icon: <Sparkles size={13} />, color: "#D97706" },
};

export function ExtensionCenter() {
  const [extensions, setExtensions] = useState<ExtensionSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const loadExtensions = async () => {
    setLoading(true);
    setError("");
    try {
      setExtensions(await apiFetch<ExtensionSummary[]>("/extensions"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "读取扩展目录失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadExtensions().catch(() => undefined);
  }, []);

  const summary = useMemo(() => summarizeExtensions(extensions), [extensions]);
  const filtered = useMemo(() => {
    if (filter === "all") return extensions;
    if (filter === "attention") {
      return extensions.filter((item) => item.status === "warning" || item.status === "error");
    }
    return extensions.filter((item) => item.kind === filter);
  }, [extensions, filter]);

  return (
    <div className="space-y-5">
      <SectionTitle>扩展中心 2.0</SectionTitle>

      <section
        className="relative overflow-hidden rounded-3xl p-5"
        style={{
          background:
            "linear-gradient(135deg, color-mix(in srgb, var(--panel-bg) 78%, #0ea5e9 22%), var(--panel-bg-soft))",
          border: "0.5px solid var(--border)",
        }}
      >
        <div
          className="pointer-events-none absolute right-[-80px] top-[-120px] h-64 w-64 rounded-full blur-3xl"
          style={{ background: "rgba(14,165,233,0.18)" }}
        />
        <div className="relative flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 rounded-full px-3 py-1 text-[12px] font-medium"
              style={{ background: "var(--control-bg)", color: "var(--t2)" }}>
              <ShieldCheck size={13} />
              本地优先能力控制台
            </div>
            <h3 className="text-[22px] font-semibold tracking-[-0.02em]" style={{ color: "var(--t1)" }}>
              Apps / Skills / MCP 的统一扩展目录
            </h3>
            <p className="mt-2 max-w-2xl text-[13px] leading-relaxed" style={{ color: "var(--t2)" }}>
              这里只做本地能力的发现、状态、权限和工具可见性，不做云端 Marketplace。安装、连接和密钥等动作仍复用下方已有管理面板。
            </p>
          </div>
          <button
            onClick={() => void loadExtensions()}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl px-4 text-[13px] font-medium"
            style={{ background: "var(--accent)", color: "#fff" }}
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            刷新目录
          </button>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-7">
        <Metric label="总扩展" value={summary.total} />
        <Metric label="Apps" value={summary.apps} />
        <Metric label="MCP" value={summary.mcp} />
        <Metric label="Skills" value={summary.skills} />
        <Metric label="可用" value={summary.available} tone="green" />
        <Metric label="需关注" value={summary.attention} tone="amber" />
        <Metric label="工具" value={summary.tools} tone="blue" />
      </div>

      <div className="flex flex-wrap gap-2">
        {([
          ["all", "全部"],
          ["app", "Apps"],
          ["mcp", "MCP"],
          ["skill", "Skills"],
          ["attention", "需关注"],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setFilter(id)}
            className="rounded-full px-3 py-1.5 text-[12px] font-medium"
            style={{
              background: filter === id ? "var(--accent)" : "var(--control-bg)",
              color: filter === id ? "#fff" : "var(--t2)",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {error ? (
        <div className="rounded-2xl px-4 py-3 text-[13px]" style={errorStyle}>
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {filtered.map((extension) => (
          <ExtensionCard key={`${extension.kind}:${extension.id}`} extension={extension} />
        ))}
      </div>

      {!loading && filtered.length === 0 ? (
        <div
          className="rounded-2xl p-4 text-[13px]"
          style={{ background: "var(--panel-bg-soft)", border: "0.5px solid var(--border)", color: "var(--t2)" }}
        >
          当前筛选下没有扩展。
        </div>
      ) : null}

      <AppManager />
    </div>
  );
}

function ExtensionCard({ extension }: { extension: ExtensionSummary }) {
  const kindMeta = KIND_META[extension.kind];
  const statusMeta = getStatusMeta(extension.status);

  return (
    <article
      className="rounded-2xl p-4"
      style={{ background: "var(--panel-bg-soft)", border: "0.5px solid var(--border)" }}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Badge icon={kindMeta.icon} label={kindMeta.label} color={kindMeta.color} />
            <Badge icon={statusMeta.icon} label={statusMeta.label} color={statusMeta.color} />
            <Badge label={extension.source === "builtin" ? "builtin" : "local"} />
            {extension.transport ? <Badge label={extension.transport} /> : null}
          </div>
          <h4 className="truncate text-[15px] font-semibold" style={{ color: "var(--t1)" }}>
            {extension.name}
          </h4>
          <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed" style={{ color: "var(--t2)" }}>
            {extension.description || "暂无描述"}
          </p>
        </div>
        <span className="shrink-0 rounded-full px-2 py-0.5 text-[11px]" style={{ background: "var(--control-bg)", color: "var(--t3)" }}>
          {extension.version}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 text-[12px]">
        <Info label="ID" value={extension.id} />
        <Info label="运行状态" value={extension.runtimeStatus} />
        <Info label="分类" value={extension.category || "-"} />
        <Info label="工具数" value={String(extension.tools.length)} />
      </div>

      {extension.permissions.length > 0 ? (
        <div className="mt-3">
          <div className="mb-1 flex items-center gap-1.5 text-[12px] font-medium" style={{ color: "var(--t3)" }}>
            <KeyRound size={12} />
            权限
          </div>
          <div className="flex flex-wrap gap-1.5">
            {extension.permissions.map((permission) => (
              <Badge key={permission} label={permission} />
            ))}
          </div>
        </div>
      ) : null}

      {extension.tools.length > 0 ? (
        <div className="mt-3">
          <div className="mb-1 flex items-center gap-1.5 text-[12px] font-medium" style={{ color: "var(--t3)" }}>
            <Wrench size={12} />
            暴露工具
          </div>
          <div className="space-y-1.5">
            {extension.tools.slice(0, 4).map((tool) => (
              <div key={tool.name} className="rounded-xl px-2.5 py-2 text-[12px]" style={{ background: "var(--panel-bg)" }}>
                <span className="font-medium" style={{ color: "var(--t1)" }}>{tool.name}</span>
                {tool.description ? <span style={{ color: "var(--t3)" }}> · {tool.description}</span> : null}
              </div>
            ))}
            {extension.tools.length > 4 ? (
              <div className="text-[12px]" style={{ color: "var(--t3)" }}>
                还有 {extension.tools.length - 4} 个工具，可在下方管理面板查看。
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {extension.lastError ? (
        <div className="mt-3 rounded-xl px-3 py-2 text-[12px]" style={errorStyle}>
          {extension.lastError}
        </div>
      ) : null}

      {extension.sourcePath ? (
        <div className="mt-3 truncate text-[11px]" style={{ color: "var(--t3)" }} title={extension.sourcePath}>
          {extension.sourcePath}
        </div>
      ) : null}
    </article>
  );
}

function Metric({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number;
  tone?: "neutral" | "green" | "amber" | "blue";
}) {
  const color = tone === "green" ? "#059669" : tone === "amber" ? "#D97706" : tone === "blue" ? "#0EA5E9" : "var(--t1)";
  return (
    <div
      className="rounded-2xl p-3"
      style={{ background: "var(--panel-bg-soft)", border: "0.5px solid var(--border)" }}
    >
      <div className="text-[11px] font-medium uppercase tracking-wide" style={{ color: "var(--t3)" }}>
        {label}
      </div>
      <div className="mt-1 text-[22px] font-semibold tracking-[-0.03em]" style={{ color }}>
        {value}
      </div>
    </div>
  );
}

function Badge({
  label,
  icon,
  color = "var(--t3)",
}: {
  label: string;
  icon?: React.ReactNode;
  color?: string;
}) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{ background: "var(--control-bg)", color }}
    >
      {icon}
      {label}
    </span>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl px-2.5 py-2" style={{ background: "var(--panel-bg)" }}>
      <div className="text-[11px]" style={{ color: "var(--t3)" }}>
        {label}
      </div>
      <div className="mt-0.5 truncate text-[12px] font-medium" style={{ color: "var(--t1)" }} title={value}>
        {value}
      </div>
    </div>
  );
}

function getStatusMeta(status: string) {
  if (status === "ok") {
    return { label: "可用", color: "#059669", icon: <CheckCircle2 size={12} /> };
  }
  if (status === "disabled") {
    return { label: "已禁用", color: "var(--t3)", icon: <Boxes size={12} /> };
  }
  return { label: "需关注", color: "#D97706", icon: <AlertTriangle size={12} /> };
}

const errorStyle = {
  background: "rgba(220,38,38,0.08)",
  border: "0.5px solid rgba(220,38,38,0.18)",
  color: "#b91c1c",
};
