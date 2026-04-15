"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  Boxes,
  Loader2,
  Pencil,
  Play,
  Plus,
  Power,
  RefreshCw,
  Sparkles,
  Trash2,
  Wrench,
} from "lucide-react";

import { apiFetch } from "@/lib/backend";
import { SectionTitle } from "./Settings";

interface ToolItem {
  name: string;
  description?: string;
}

interface MCPTransportConfig {
  transport?: "stdio" | "streamable-http" | string;
  command?: string;
  args?: string[];
  url?: string;
  headers?: Record<string, string>;
}

interface MCPManifest {
  id: string;
  name?: string;
  version?: string;
  description?: string;
  category?: string;
  permissions?: string[];
  tools?: ToolItem[];
  mcp?: MCPTransportConfig;
}

interface ManagedApp {
  id: string;
  name: string;
  version: string;
  description: string;
  status: string;
  enabled: boolean;
  is_builtin: boolean;
  permissions: string[];
  settings: Record<string, unknown>;
  manifest: MCPManifest;
  tools: ToolItem[];
  runtime: {
    status: string;
    transport?: string | null;
    pid?: number | null;
    initialized?: boolean;
    protocol_version?: string | null;
    tool_count?: number | null;
  };
  last_error?: string | null;
}

interface MCPFormState {
  id: string;
  name: string;
  description: string;
  category: string;
  transport: "stdio" | "streamable-http";
  command: string;
  argsText: string;
  url: string;
  headersText: string;
  permissions: string;
}

const DEFAULT_FORM: MCPFormState = {
  id: "",
  name: "",
  description: "",
  category: "utility",
  transport: "stdio",
  command: "",
  argsText: "",
  url: "",
  headersText: "",
  permissions: "",
};

export function AppManager() {
  const [apps, setApps] = useState<ManagedApp[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingForm, setSavingForm] = useState(false);
  const [form, setForm] = useState<MCPFormState>(DEFAULT_FORM);
  const [isIdCustomized, setIsIdCustomized] = useState(false);
  const [editingAppId, setEditingAppId] = useState<string | null>(null);
  const [formError, setFormError] = useState("");
  const [formSuccess, setFormSuccess] = useState("");
  const [toolMap, setToolMap] = useState<Record<string, ToolItem[]>>({});
  const [toolLoadingMap, setToolLoadingMap] = useState<Record<string, boolean>>({});
  const [toolErrorMap, setToolErrorMap] = useState<Record<string, string>>({});
  const [actionErrorMap, setActionErrorMap] = useState<Record<string, string>>({});
  const [activeLoadingMap, setActiveLoadingMap] = useState<Record<string, boolean>>({});
  const [deleteLoadingMap, setDeleteLoadingMap] = useState<Record<string, boolean>>({});
  const formRef = useRef<HTMLDivElement | null>(null);

  const loadApps = async () => {
    setLoading(true);
    try {
      const data = await apiFetch<ManagedApp[]>("/apps");
      setApps(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadApps().catch(() => undefined);
  }, []);

  const externalApps = useMemo(() => apps.filter((app) => !app.is_builtin), [apps]);
  const externalAppMap = useMemo(
    () => new Map(externalApps.map((app) => [app.id, app])),
    [externalApps],
  );
  const activeCount = useMemo(
    () => apps.filter((app) => app.runtime?.status === "active").length,
    [apps],
  );
  const isEditing = Boolean(editingAppId);
  const editingApp = editingAppId ? externalAppMap.get(editingAppId) ?? null : null;

  const resetForm = () => {
    setForm(DEFAULT_FORM);
    setIsIdCustomized(false);
    setEditingAppId(null);
    setFormError("");
    setFormSuccess("");
  };

  const startEdit = (app: ManagedApp) => {
    setEditingAppId(app.id);
    setFormError("");
    setFormSuccess("");
    setIsIdCustomized(true);
    setForm(formFromApp(app));
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const refreshTools = async (appId: string) => {
    setToolLoadingMap((prev) => ({ ...prev, [appId]: true }));
    setToolErrorMap((prev) => ({ ...prev, [appId]: "" }));
    setActionErrorMap((prev) => ({ ...prev, [appId]: "" }));
    try {
      const data = await apiFetch<{ app_id: string; tools: ToolItem[] }>(`/apps/${appId}/tools`);
      setToolMap((prev) => ({ ...prev, [appId]: data.tools ?? [] }));
      await loadApps();
    } catch (error) {
      const message = error instanceof Error ? error.message : "刷新工具失败";
      setToolErrorMap((prev) => ({ ...prev, [appId]: message }));
      await loadApps().catch(() => undefined);
    } finally {
      setToolLoadingMap((prev) => ({ ...prev, [appId]: false }));
    }
  };

  const toggleEnabled = async (app: ManagedApp) => {
    setActionErrorMap((prev) => ({ ...prev, [app.id]: "" }));
    try {
      await apiFetch(`/apps/${app.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !app.enabled }),
      });
      await loadApps();
    } catch (error) {
      const message = error instanceof Error ? error.message : "更新状态失败";
      setActionErrorMap((prev) => ({ ...prev, [app.id]: message }));
      await loadApps().catch(() => undefined);
    }
  };

  const toggleActive = async (app: ManagedApp) => {
    setActionErrorMap((prev) => ({ ...prev, [app.id]: "" }));
    setActiveLoadingMap((prev) => ({ ...prev, [app.id]: true }));
    try {
      await apiFetch(`/apps/${app.id}/${app.runtime?.status === "active" ? "deactivate" : "activate"}`, {
        method: "POST",
      });
      await loadApps();
    } catch (error) {
      const message = error instanceof Error ? error.message : "连接服务失败";
      setActionErrorMap((prev) => ({ ...prev, [app.id]: message }));
      await loadApps().catch(() => undefined);
    } finally {
      setActiveLoadingMap((prev) => ({ ...prev, [app.id]: false }));
    }
  };

  const deleteApp = async (app: ManagedApp) => {
    const confirmed = window.confirm(`确定要删除 MCP 服务“${app.name}”吗？\n\n这会从本地配置中移除该服务。`);
    if (!confirmed) {
      return;
    }

    setActionErrorMap((prev) => ({ ...prev, [app.id]: "" }));
    setDeleteLoadingMap((prev) => ({ ...prev, [app.id]: true }));
    try {
      await apiFetch(`/apps/${app.id}`, {
        method: "DELETE",
      });
      await loadApps();
      setToolMap((prev) => {
        const next = { ...prev };
        delete next[app.id];
        return next;
      });
      setToolLoadingMap((prev) => {
        const next = { ...prev };
        delete next[app.id];
        return next;
      });
      setToolErrorMap((prev) => {
        const next = { ...prev };
        delete next[app.id];
        return next;
      });
      setActionErrorMap((prev) => {
        const next = { ...prev };
        delete next[app.id];
        return next;
      });
      setActiveLoadingMap((prev) => {
        const next = { ...prev };
        delete next[app.id];
        return next;
      });
      if (editingAppId === app.id) {
        resetForm();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "删除服务失败";
      setActionErrorMap((prev) => ({ ...prev, [app.id]: message }));
      await loadApps().catch(() => undefined);
    } finally {
      setDeleteLoadingMap((prev) => ({ ...prev, [app.id]: false }));
    }
  };

  const submitForm = async () => {
    const id = normalizeAppId(form.id || form.name);
    if (!id) {
      setFormError("请填写扩展 ID 或名称。");
      return;
    }

    if (form.transport === "stdio" && !form.command.trim()) {
      setFormError("请填写 MCP 命令。");
      return;
    }

    if (form.transport === "streamable-http" && !form.url.trim()) {
      setFormError("请填写远程 MCP URL。");
      return;
    }

    const baseManifest = editingApp?.manifest;
    const manifest = buildManifest(form, baseManifest);

    setSavingForm(true);
    setFormError("");
    setFormSuccess("");

    try {
      if (isEditing && editingAppId) {
        await apiFetch(`/apps/${editingAppId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ manifest }),
        });
        setFormSuccess(`已更新 MCP 服务：${manifest.name}`);
      } else {
        await apiFetch("/apps/install", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            manifest,
            enabled: true,
          }),
        });
        setFormSuccess(`已接入 MCP 服务：${manifest.name}`);
      }

      await loadApps();
      setForm(buildEmptyForm());
      setEditingAppId(null);
      setIsIdCustomized(false);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : isEditing ? "保存修改失败" : "接入失败");
    } finally {
      setSavingForm(false);
    }
  };

  return (
    <div className="space-y-5">
      <SectionTitle>扩展能力</SectionTitle>

      <div
        className="rounded-2xl p-4"
        style={{ background: "rgba(0,0,0,0.02)", border: "0.5px solid rgba(0,0,0,0.08)" }}
      >
        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[15px] font-semibold">
              <Boxes size={15} />
              扩展总览
            </div>
            <div className="mt-1 text-[13px]" style={{ color: "var(--t2)" }}>
              这里统一管理外部 MCP 服务，以及后续会接入的 Skills 技能。
            </div>
          </div>
          <button
            onClick={async () => {
              await apiFetch("/apps/rescan", { method: "POST" });
              await loadApps();
            }}
            className="inline-flex h-9 items-center justify-center rounded-lg px-3 text-[13px] leading-none"
            style={{ background: "rgba(0,0,0,0.05)" }}
          >
            <span className="inline-flex items-center gap-1.5 leading-none">
              <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
              重新扫描
            </span>
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <StatCard label="外部 MCP 服务" value={externalApps.length} tone="blue" />
          <StatCard label="活跃连接" value={activeCount} tone="green" />
          <StatCard label="已发现扩展" value={externalApps.length} tone="neutral" />
        </div>
      </div>

      <div
        ref={formRef}
        className="rounded-2xl p-4"
        style={{
          background: isEditing ? "rgba(16,185,129,0.05)" : "rgba(0,122,255,0.04)",
          border: isEditing ? "0.5px solid rgba(16,185,129,0.20)" : "0.5px solid rgba(0,122,255,0.16)",
        }}
      >
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-[15px] font-semibold">
            {isEditing ? <Pencil size={15} /> : <Plus size={15} />}
            {isEditing ? "编辑 MCP 服务" : "接入 MCP 服务"}
          </div>
          {isEditing ? (
            <button
              onClick={resetForm}
              className="inline-flex h-8 items-center justify-center rounded-lg px-3 text-[12px]"
              style={{ background: "rgba(0,0,0,0.05)", color: "var(--t2)" }}
            >
              取消编辑
            </button>
          ) : null}
        </div>

        <div className="mb-4 text-[13px]" style={{ color: "var(--t2)" }}>
          {isEditing
            ? "这里可以修改已接入 MCP 的名称、命令、URL、请求头和权限。保存后，如果该服务当前处于连接状态，会自动按新配置重新连接。stdio MCP 在当前部署节点执行。"
            : "这里支持接入服务端执行的 stdio MCP，或者直接连接远程 HTTP MCP endpoint。当前固定内置 Node.js、Python、uv 运行时，暂仅建议接入 Node/Python 类 stdio MCP。"}
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="名称">
            <input
              value={form.name}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  name: event.target.value,
                  id: isIdCustomized ? prev.id : normalizeAppId(event.target.value),
                }))
              }
              className="w-full rounded-lg px-3 py-2 text-[13px] outline-none"
              style={inputStyle}
              placeholder="例如：Tavily Search"
            />
          </Field>

          <Field label="扩展 ID">
            <input
              value={form.id}
              readOnly={isEditing}
              onChange={(event) => {
                const normalized = normalizeAppId(event.target.value);
                setForm((prev) => ({ ...prev, id: normalized }));
                setIsIdCustomized(normalized.length > 0);
              }}
              className="w-full rounded-lg px-3 py-2 text-[13px] outline-none"
              style={{
                ...inputStyle,
                opacity: isEditing ? 0.72 : 1,
                cursor: isEditing ? "not-allowed" : "text",
              }}
              placeholder="例如：tavily-search"
            />
          </Field>

          <Field label="描述">
            <input
              value={form.description}
              onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
              className="w-full rounded-lg px-3 py-2 text-[13px] outline-none"
              style={inputStyle}
              placeholder="简要说明这个 MCP 服务是做什么的"
            />
          </Field>

          <Field label="分类">
            <select
              value={form.category}
              onChange={(event) => setForm((prev) => ({ ...prev, category: event.target.value }))}
              className="w-full rounded-lg px-3 py-2 text-[13px] outline-none"
              style={inputStyle}
            >
              <option value="utility">utility</option>
              <option value="productivity">productivity</option>
              <option value="development">development</option>
              <option value="system">system</option>
              <option value="communication">communication</option>
              <option value="creative">creative</option>
            </select>
          </Field>

          <Field label="接入方式">
            <select
              value={form.transport}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  transport: event.target.value as "stdio" | "streamable-http",
                }))
              }
              className="w-full rounded-lg px-3 py-2 text-[13px] outline-none"
              style={inputStyle}
            >
              <option value="stdio">stdio（本地命令）</option>
              <option value="streamable-http">远程 HTTP MCP</option>
            </select>
          </Field>

          <Field label={form.transport === "stdio" ? "Command" : "URL"}>
            {form.transport === "stdio" ? (
              <input
                value={form.command}
                onChange={(event) => setForm((prev) => ({ ...prev, command: event.target.value }))}
                className="w-full rounded-lg px-3 py-2 text-[13px] outline-none"
                style={inputStyle}
                placeholder="例如：npx、node、python、uvx"
              />
            ) : (
              <input
                value={form.url}
                onChange={(event) => setForm((prev) => ({ ...prev, url: event.target.value }))}
                className="w-full rounded-lg px-3 py-2 text-[13px] outline-none"
                style={inputStyle}
                placeholder="例如：https://mcp.example.com/mcp"
              />
            )}
          </Field>

          <Field label="Permissions">
            <input
              value={form.permissions}
              onChange={(event) => setForm((prev) => ({ ...prev, permissions: event.target.value }))}
              className="w-full rounded-lg px-3 py-2 text-[13px] outline-none"
              style={inputStyle}
              placeholder="逗号分隔，例如：network, filesystem"
            />
          </Field>
        </div>

        {form.transport === "stdio" ? (
          <div className="mt-3">
            <div
              className="mb-3 rounded-xl px-3 py-2 text-[12px]"
              style={{ background: "rgba(0,122,255,0.06)", color: "var(--t2)" }}
            >
              stdio MCP 会在当前部署节点执行。当前镜像固定内置 Node.js、Python、uv 运行时，暂仅支持 Node/Python 类 stdio MCP。
            </div>
            <Field label="Args">
              <textarea
                value={form.argsText}
                onChange={(event) => setForm((prev) => ({ ...prev, argsText: event.target.value }))}
                className="min-h-[96px] w-full rounded-lg px-3 py-2 text-[13px] outline-none"
                style={inputStyle}
                placeholder={"每行一个参数\n例如：\n-m\nmy_mcp_server"}
              />
            </Field>
          </div>
        ) : (
          <div className="mt-3">
            <Field label="Headers">
              <textarea
                value={form.headersText}
                onChange={(event) => setForm((prev) => ({ ...prev, headersText: event.target.value }))}
                className="min-h-[96px] w-full rounded-lg px-3 py-2 text-[13px] outline-none"
                style={inputStyle}
                placeholder={"每行一个请求头\n例如：\nAuthorization: Bearer xxx\nX-API-Key: yyy"}
              />
            </Field>
          </div>
        )}

        {formError ? (
          <div className="mt-3 rounded-xl px-3 py-2 text-[13px]" style={errorBannerStyle}>
            {formError}
          </div>
        ) : null}

        {formSuccess ? (
          <div className="mt-3 rounded-xl px-3 py-2 text-[13px]" style={successBannerStyle}>
            {formSuccess}
          </div>
        ) : null}

        <div className="mt-4 flex justify-end gap-2">
          {isEditing ? (
            <button
              onClick={resetForm}
              className="rounded-lg px-3 py-2 text-[13px]"
              style={{ background: "rgba(0,0,0,0.05)", color: "var(--t2)" }}
            >
              取消
            </button>
          ) : null}
          <button
            onClick={() => void submitForm()}
            disabled={savingForm}
            className="rounded-lg px-3 py-2 text-[13px] font-medium text-white"
            style={{
              background: savingForm
                ? isEditing
                  ? "rgba(16,185,129,0.55)"
                  : "rgba(0,122,255,0.55)"
                : isEditing
                  ? "#059669"
                  : "#007AFF",
              opacity: savingForm ? 0.85 : 1,
            }}
          >
            <span className="inline-flex items-center gap-1.5">
              {savingForm ? <Loader2 size={13} className="animate-spin" /> : isEditing ? <Pencil size={13} /> : <Plus size={13} />}
              {savingForm ? (isEditing ? "保存中…" : "接入中…") : isEditing ? "保存修改" : "接入 MCP 服务"}
            </span>
          </button>
        </div>
      </div>

      <div
        className="rounded-2xl p-4"
        style={{ background: "rgba(250,204,21,0.08)", border: "0.5px solid rgba(245,158,11,0.18)" }}
      >
        <div className="mb-2 flex items-center gap-2 text-[15px] font-semibold">
          <Sparkles size={15} />
          Skills 技能
        </div>
        <div className="text-[13px]" style={{ color: "var(--t2)" }}>
          这里后续会补齐 Skills 的安装、启用和版本管理入口。当前先保留为统一的扩展能力中心。
        </div>
      </div>

      {externalApps.length > 0 ? (
        <div className="space-y-3">
          <SubsectionTitle>已接入的 MCP 服务</SubsectionTitle>
          {externalApps.map((app) => (
            <ManagedAppCard
              key={app.id}
              app={app}
              onEdit={startEdit}
              onDelete={deleteApp}
              onToggleEnabled={toggleEnabled}
              onToggleActive={toggleActive}
              onRefreshTools={refreshTools}
              runtimeTools={toolMap[app.id]}
              toolLoading={toolLoadingMap[app.id]}
              activeLoading={activeLoadingMap[app.id]}
              deleteLoading={deleteLoadingMap[app.id]}
              toolError={toolErrorMap[app.id]}
              actionError={actionErrorMap[app.id]}
            />
          ))}
        </div>
      ) : (
        <div
          className="rounded-2xl p-4 text-[13px]"
          style={{ background: "rgba(0,0,0,0.02)", border: "0.5px solid rgba(0,0,0,0.08)", color: "var(--t2)" }}
        >
          当前还没有接入外部 MCP 服务。你可以先在上方填写命令、URL 与参数，接入第一个扩展。
        </div>
      )}
    </div>
  );
}

function ManagedAppCard({
  app,
  onEdit,
  onDelete,
  onToggleEnabled,
  onToggleActive,
  onRefreshTools,
  runtimeTools,
  toolLoading,
  activeLoading,
  deleteLoading,
  toolError,
  actionError,
}: {
  app: ManagedApp;
  onEdit: (app: ManagedApp) => void;
  onDelete: (app: ManagedApp) => Promise<void>;
  onToggleEnabled: (app: ManagedApp) => Promise<void>;
  onToggleActive: (app: ManagedApp) => Promise<void>;
  onRefreshTools: (appId: string) => Promise<void>;
  runtimeTools?: ToolItem[];
  toolLoading?: boolean;
  activeLoading?: boolean;
  deleteLoading?: boolean;
  toolError?: string;
  actionError?: string;
}) {
  const displayTools = runtimeTools ?? app.tools;

  return (
    <div
      className="rounded-2xl p-4"
      style={{ background: "rgba(0,0,0,0.02)", border: "0.5px solid rgba(0,0,0,0.08)" }}
    >
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[15px] font-semibold">{app.name}</span>
            <span
              className="rounded-full px-2 py-0.5 text-[11px]"
              style={{ background: "rgba(0,0,0,0.05)", color: "var(--t3)" }}
            >
              {app.version}
            </span>
            <span
              className="rounded-full px-2 py-0.5 text-[11px]"
              style={{ background: "rgba(16,185,129,0.10)", color: "#059669" }}
            >
              MCP 服务
            </span>
          </div>
          <div className="mt-1 text-[13px]" style={{ color: "var(--t2)" }}>
            {app.description}
          </div>
          <div className="mt-2 flex flex-wrap gap-2 text-[12px]">
            <Badge label={`状态: ${app.runtime?.status || app.status}`} />
            <Badge label={`可用: ${app.enabled ? "是" : "否"}`} />
            {app.runtime?.transport ? <Badge label={`transport: ${app.runtime.transport}`} /> : null}
            {app.runtime?.initialized ? <Badge label="initialized" /> : null}
            {app.permissions.map((permission) => (
              <Badge key={permission} label={permission} />
            ))}
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          <button
            onClick={() => onEdit(app)}
            className="inline-flex h-9 items-center justify-center rounded-lg px-3 text-[13px] leading-none"
            style={{ background: "rgba(5,150,105,0.08)", color: "#047857" }}
          >
            <span className="inline-flex items-center gap-1.5 leading-none">
              <Pencil size={13} />
              编辑配置
            </span>
          </button>

          <button
            onClick={() => void onToggleEnabled(app)}
            className="inline-flex h-9 items-center justify-center rounded-lg px-3 text-[13px] leading-none"
            style={{ background: "rgba(0,0,0,0.05)" }}
          >
            <span className="inline-flex items-center gap-1.5 leading-none">
              <Power size={13} />
              {app.enabled ? "禁用" : "启用"}
            </span>
          </button>

          <button
            onClick={() => void onToggleActive(app)}
            disabled={activeLoading}
            className="inline-flex h-9 items-center justify-center rounded-lg px-3 text-[13px] leading-none"
            style={{
              background: "rgba(0,0,0,0.05)",
              opacity: activeLoading ? 0.72 : 1,
              cursor: activeLoading ? "wait" : "pointer",
            }}
          >
            <span className="inline-flex items-center gap-1.5 leading-none">
              {activeLoading ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
              {app.runtime?.status === "active" ? "断开服务" : "连接服务"}
            </span>
          </button>

          <button
            onClick={() => void onRefreshTools(app.id)}
            className="inline-flex h-9 items-center justify-center rounded-lg px-3 text-[13px] leading-none"
            style={{ background: "rgba(0,0,0,0.05)" }}
          >
            <span className="inline-flex items-center gap-1.5 leading-none">
              <Wrench size={13} />
              {toolLoading ? "刷新中…" : "刷新工具"}
            </span>
          </button>

          <button
            onClick={() => void onDelete(app)}
            disabled={deleteLoading}
            className="inline-flex h-9 items-center justify-center rounded-lg px-3 text-[13px] leading-none"
            style={{
              background: "rgba(220,38,38,0.08)",
              color: "#dc2626",
              opacity: deleteLoading ? 0.72 : 1,
              cursor: deleteLoading ? "wait" : "pointer",
            }}
          >
            <span className="inline-flex items-center gap-1.5 leading-none">
              {deleteLoading ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
              {deleteLoading ? "删除中…" : "删除服务"}
            </span>
          </button>
        </div>
      </div>

      {actionError || app.last_error ? (
        <div className="mb-3 rounded-xl px-3 py-2 text-[12px]" style={errorBannerStyle}>
          {actionError || app.last_error}
        </div>
      ) : null}

      <div className="rounded-xl p-3 text-[13px]" style={{ background: "rgba(255,255,255,0.65)" }}>
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="font-medium" style={{ color: "var(--t2)" }}>
            MCP 工具
          </div>
          {app.runtime?.protocol_version ? (
            <span style={{ color: "var(--t3)" }}>MCP {app.runtime.protocol_version}</span>
          ) : null}
        </div>

        {toolError ? (
          <div className="mb-2 text-[12px]" style={{ color: "#dc2626" }}>
            {toolError}
          </div>
        ) : null}

        {displayTools.length === 0 ? (
          <span style={{ color: "var(--t3)" }}>
            当前没有可展示的 MCP 工具，或尚未刷新运行时工具列表。
          </span>
        ) : (
          <div className="space-y-1.5">
            {displayTools.map((tool) => (
              <div
                key={tool.name}
                className="rounded-lg px-2.5 py-2"
                style={{ background: "rgba(0,0,0,0.03)" }}
              >
                <div className="font-medium">{tool.name}</div>
                {tool.description ? (
                  <div className="mt-0.5 text-[12px]" style={{ color: "var(--t3)" }}>
                    {tool.description}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1 text-[12px] font-medium" style={{ color: "var(--t3)" }}>
        {label}
      </div>
      {children}
    </label>
  );
}

function Badge({ label }: { label: string }) {
  return (
    <span
      className="rounded-full px-2 py-0.5"
      style={{ background: "rgba(0,0,0,0.05)", color: "var(--t3)" }}
    >
      {label}
    </span>
  );
}

function SubsectionTitle({ children }: { children: ReactNode }) {
  return (
    <h3 className="text-[14px] font-semibold" style={{ color: "var(--t2)" }}>
      {children}
    </h3>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "neutral" | "blue" | "green";
}) {
  const toneStyles = {
    neutral: { background: "rgba(0,0,0,0.03)", color: "var(--t1)" },
    blue: { background: "rgba(0,122,255,0.08)", color: "#007AFF" },
    green: { background: "rgba(16,185,129,0.10)", color: "#059669" },
  }[tone];

  return (
    <div
      className="rounded-xl p-3"
      style={{ background: "rgba(255,255,255,0.7)", border: "0.5px solid rgba(0,0,0,0.06)" }}
    >
      <div className="text-[12px]" style={{ color: "var(--t3)" }}>
        {label}
      </div>
      <div
        className="mt-2 inline-flex rounded-full px-2.5 py-1 text-[14px] font-semibold"
        style={toneStyles}
      >
        {value}
      </div>
    </div>
  );
}

function buildEmptyForm(): MCPFormState {
  return { ...DEFAULT_FORM };
}

function buildManifest(form: MCPFormState, baseManifest?: MCPManifest): MCPManifest {
  const manifest: MCPManifest = {
    ...baseManifest,
    id: normalizeAppId(form.id || form.name),
    name: form.name.trim() || normalizeAppId(form.id || form.name),
    version: baseManifest?.version || "1.0.0",
    description:
      form.description.trim() ||
      (form.transport === "stdio"
        ? "通过前端接入的 stdio MCP 服务。"
        : "通过前端接入的远程 HTTP MCP 服务。"),
    category: form.category.trim() || "utility",
    permissions: splitCommaList(form.permissions),
    tools: baseManifest?.tools ?? [],
    mcp:
      form.transport === "stdio"
        ? {
            transport: "stdio",
            command: form.command.trim(),
            args: splitArgs(form.argsText),
          }
        : {
            transport: "streamable-http",
            url: form.url.trim(),
            headers: splitHeaders(form.headersText),
          },
  };

  return manifest;
}

function formFromApp(app: ManagedApp): MCPFormState {
  const manifest = app.manifest || { id: app.id };
  const mcp = manifest.mcp || {};
  const transport = mcp.transport === "streamable-http" ? "streamable-http" : "stdio";

  return {
    id: manifest.id || app.id,
    name: manifest.name || app.name,
    description: manifest.description || app.description,
    category: manifest.category || "utility",
    transport,
    command: transport === "stdio" ? mcp.command || "" : "",
    argsText: transport === "stdio" ? joinArgs(mcp.args) : "",
    url: transport === "streamable-http" ? mcp.url || "" : "",
    headersText: transport === "streamable-http" ? joinHeaders(mcp.headers) : "",
    permissions: (manifest.permissions || app.permissions || []).join(", "),
  };
}

function normalizeAppId(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function splitCommaList(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitArgs(value: string) {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function joinArgs(value?: string[]) {
  return (value || []).join("\n");
}

function splitHeaders(value: string) {
  const headers: Record<string, string> = {};

  for (const rawLine of value.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const headerValue = line.slice(separatorIndex + 1).trim();
    if (key && headerValue) {
      headers[key] = headerValue;
    }
  }

  return headers;
}

function joinHeaders(value?: Record<string, string>) {
  return Object.entries(value || {})
    .map(([key, headerValue]) => `${key}: ${headerValue}`)
    .join("\n");
}

const inputStyle: CSSProperties = {
  background: "rgba(255,255,255,0.8)",
  border: "0.5px solid rgba(0,0,0,0.12)",
  color: "var(--t1)",
};

const errorBannerStyle: CSSProperties = {
  background: "rgba(220,38,38,0.08)",
  color: "#dc2626",
};

const successBannerStyle: CSSProperties = {
  background: "rgba(22,163,74,0.10)",
  color: "#15803d",
};
