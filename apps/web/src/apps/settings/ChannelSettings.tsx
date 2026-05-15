"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bot,
  CheckCircle2,
  KeyRound,
  Loader2,
  RefreshCw,
  RotateCw,
  Save,
  ShieldCheck,
  Wifi,
  WifiOff,
} from "lucide-react";

import { apiFetch, buildApiUrl } from "@/lib/backend";
import { useSettingsStore } from "@/stores/settingsStore";
import {
  buildChannelModelOptions,
  findChannelModelOption,
} from "./channelModelOptions";
import { encodeModel } from "./providers";
import { SectionTitle } from "./Settings";

type QQBotAgentConfig = {
  userId: string;
  appId: string;
  model: string;
  providerId: string;
  compatType: string;
  apiKey: string;
  apiBase: string;
  enableMemory: boolean;
  systemPrompt: string;
  hasApiKey: boolean;
};

type QQBotConfig = {
  version: number;
  enabled: boolean;
  appId: string;
  appSecret: string;
  botUserId: string;
  accountId: string;
  allowPrivate: boolean;
  allowGroup: boolean;
  allowUnlisted: boolean;
  allowedUsers: string[];
  allowedGroups: string[];
  agent: QQBotAgentConfig;
  hasAppSecret: boolean;
};

type QQBotConfigResponse = {
  path: string;
  exists: boolean;
  source: "file" | "env" | "default";
  config: QQBotConfig;
};

type QQBotStatus = {
  enabled: boolean;
  running: boolean;
  source: string;
  path: string;
  message: string;
  startedAt: string | null;
  error: string;
};

type FormState = {
  config: QQBotConfig;
  path: string;
  source: string;
  exists: boolean;
  allowedUsersText: string;
  allowedGroupsText: string;
};

const DEFAULT_AGENT: QQBotAgentConfig = {
  userId: "default",
  appId: "ai-chat",
  model: "kimi-k2.5",
  providerId: "moonshot",
  compatType: "openai",
  apiKey: "",
  apiBase: "",
  enableMemory: true,
  systemPrompt: "你是 AI-Web OS 的智能助手，请简洁、友好地回答用户问题。",
  hasApiKey: false,
};

const DEFAULT_CONFIG: QQBotConfig = {
  version: 1,
  enabled: false,
  appId: "",
  appSecret: "",
  botUserId: "",
  accountId: "default",
  allowPrivate: true,
  allowGroup: false,
  allowUnlisted: false,
  allowedUsers: [],
  allowedGroups: [],
  agent: DEFAULT_AGENT,
  hasAppSecret: false,
};

const INPUT_CLASS =
  "w-full rounded-lg px-3 py-2 text-[13px] outline-none transition-colors";
const INPUT_STYLE = {
  background: "var(--panel-bg-soft)",
  border: "0.5px solid var(--border)",
  color: "var(--t1)",
};

function toFormState(payload: QQBotConfigResponse): FormState {
  return {
    config: {
      ...DEFAULT_CONFIG,
      ...payload.config,
      agent: { ...DEFAULT_AGENT, ...payload.config.agent },
    },
    path: payload.path,
    source: payload.source,
    exists: payload.exists,
    allowedUsersText: (payload.config.allowedUsers ?? []).join("\n"),
    allowedGroupsText: (payload.config.allowedGroups ?? []).join("\n"),
  };
}

function listFromText(value: string) {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(buildApiUrl(path), init);
  if (!res.ok) {
    let message = "请求失败";
    try {
      const payload = await res.json();
      message = payload.detail || message;
    } catch {
      message = await res.text();
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export function ChannelSettings() {
  const { providers, defaultModel } = useSettingsStore();
  const [form, setForm] = useState<FormState | null>(null);
  const [status, setStatus] = useState<QQBotStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const modelOptions = useMemo(
    () => buildChannelModelOptions(providers),
    [providers],
  );

  const load = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const [configPayload, statusPayload] = await Promise.all([
        apiFetch<QQBotConfigResponse>("/channels/qqbot/config"),
        apiFetch<QQBotStatus>("/channels/qqbot/status"),
      ]);
      setForm(toFormState(configPayload));
      setStatus(statusPayload);
    } catch (error) {
      setMessage({ ok: false, text: (error as Error).message || "加载失败" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const updateConfig = (patch: Partial<QQBotConfig>) => {
    setForm((current) => {
      if (!current) return current;
      return { ...current, config: { ...current.config, ...patch } };
    });
  };

  const updateAgent = (patch: Partial<QQBotAgentConfig>) => {
    setForm((current) => {
      if (!current) return current;
      return {
        ...current,
        config: {
          ...current.config,
          agent: { ...current.config.agent, ...patch },
        },
      };
    });
  };

  const selectChannelModel = (value: string) => {
    const option = findChannelModelOption(modelOptions, value);
    if (!option) return;
    updateAgent({
      providerId: option.providerId,
      model: option.modelId,
      compatType: option.compatType,
      apiBase: option.apiBase,
      apiKey: option.apiKey,
      hasApiKey: Boolean(option.apiKey),
    });
  };

  const save = async ({ restart }: { restart: boolean }) => {
    if (!form) return;
    setSaving(true);
    setRestarting(restart);
    setMessage(null);
    try {
      const payload: QQBotConfig = {
        ...form.config,
        allowedUsers: listFromText(form.allowedUsersText),
        allowedGroups: listFromText(form.allowedGroupsText),
      };
      const saved = await fetchJson<QQBotConfigResponse>("/channels/qqbot/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setForm(toFormState(saved));
      if (restart) {
        const nextStatus = await apiFetch<QQBotStatus>("/channels/qqbot/restart", {
          method: "POST",
        });
        setStatus(nextStatus);
      }
      setMessage({ ok: true, text: restart ? "配置已保存并已请求重连。" : "配置已保存。" });
    } catch (error) {
      setMessage({ ok: false, text: (error as Error).message || "保存失败" });
    } finally {
      setSaving(false);
      setRestarting(false);
    }
  };

  if (loading || !form) {
    return (
      <div className="flex h-48 items-center justify-center gap-2 text-[13px]" style={{ color: "var(--t2)" }}>
        <Loader2 size={16} className="animate-spin" />
        正在读取渠道配置...
      </div>
    );
  }

  const cfg = form.config;
  const agent = cfg.agent;
  const selectedModelValue =
    agent.providerId && agent.model ? encodeModel(agent.providerId, agent.model) : "";
  const selectedModel = findChannelModelOption(modelOptions, selectedModelValue);
  const defaultModelOption = defaultModel
    ? findChannelModelOption(modelOptions, defaultModel)
    : undefined;
  const ready = Boolean(cfg.appId && cfg.hasAppSecret && (agent.hasApiKey || agent.apiKey));

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <SectionTitle>渠道接入</SectionTitle>
          <p className="text-[13px] leading-relaxed" style={{ color: "var(--t2)" }}>
            QQ Bot 配置会写入本地文件，后端运行时优先读取这里，文件不存在时才回退到 `.env`。
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-medium"
          style={{
            background: "var(--panel-bg)",
            border: "0.5px solid var(--border)",
            color: "var(--t1)",
          }}
        >
          <RefreshCw size={14} />
          刷新
        </button>
      </div>

      <section
        className="overflow-hidden rounded-2xl"
        style={{
          border: "0.5px solid var(--border)",
          background:
            "linear-gradient(135deg, color-mix(in srgb, var(--accent) 9%, transparent), var(--panel-bg) 52%, color-mix(in srgb, #34c759 7%, transparent))",
        }}
      >
        <div className="flex items-start justify-between gap-4 p-5">
          <div className="flex gap-3">
            <div
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl"
              style={{
                background: "color-mix(in srgb, var(--accent) 14%, transparent)",
                color: "var(--accent)",
              }}
            >
              <Bot size={22} />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-[16px] font-semibold" style={{ color: "var(--t1)" }}>
                  QQ 官方 Bot
                </h3>
                <StatusPill status={status} ready={ready} />
              </div>
              <p className="mt-1 text-[13px]" style={{ color: "var(--t2)" }}>
                支持私聊文本和群聊 @ 机器人；回复只发送最终答案，不暴露思考过程和工具日志。
              </p>
              <div className="mt-2 flex flex-wrap gap-2 text-[12px]" style={{ color: "var(--t3)" }}>
                <span className="rounded-full px-2 py-1" style={{ background: "var(--panel-bg-soft)" }}>
                  来源：{form.source === "file" ? "配置文件" : form.source === "env" ? ".env" : "默认值"}
                </span>
                <span className="rounded-full px-2 py-1" style={{ background: "var(--panel-bg-soft)" }}>
                  {form.path}
                </span>
              </div>
            </div>
          </div>
          <Toggle
            checked={cfg.enabled}
            onChange={(enabled) => updateConfig({ enabled })}
            label={cfg.enabled ? "已启用" : "未启用"}
          />
        </div>

        <div className="grid gap-4 border-t p-5 md:grid-cols-2" style={{ borderColor: "var(--border)" }}>
          <Field label="App ID">
            <input
              value={cfg.appId}
              onChange={(event) => updateConfig({ appId: event.target.value })}
              placeholder="QQ Bot App ID"
              className={INPUT_CLASS}
              style={INPUT_STYLE}
            />
          </Field>
          <SecretField
            label="App Secret"
            configured={cfg.hasAppSecret}
            value={cfg.appSecret}
            placeholder={cfg.hasAppSecret ? "留空表示保留已配置 Secret" : "QQ Bot App Secret"}
            onChange={(value) => updateConfig({ appSecret: value })}
          />
          <Field label="Bot User ID">
            <input
              value={cfg.botUserId}
              onChange={(event) => updateConfig({ botUserId: event.target.value })}
              placeholder="可选，用于清理 @ 文本"
              className={INPUT_CLASS}
              style={INPUT_STYLE}
            />
          </Field>
          <Field label="Account ID">
            <input
              value={cfg.accountId}
              onChange={(event) => updateConfig({ accountId: event.target.value })}
              placeholder="default"
              className={INPUT_CLASS}
              style={INPUT_STYLE}
            />
          </Field>
        </div>

        <div className="grid gap-4 border-t p-5 md:grid-cols-3" style={{ borderColor: "var(--border)" }}>
          <ToggleCard
            title="允许私聊"
            description="QQ 用户直接私聊机器人时进入 AI 助手。"
            checked={cfg.allowPrivate}
            onChange={(allowPrivate) => updateConfig({ allowPrivate })}
          />
          <ToggleCard
            title="允许群聊"
            description="只有群聊里 @ 机器人时才会触发。"
            checked={cfg.allowGroup}
            onChange={(allowGroup) => updateConfig({ allowGroup })}
          />
          <ToggleCard
            title="允许非白名单"
            description="调试期可开启，正式使用建议关闭。"
            checked={cfg.allowUnlisted}
            onChange={(allowUnlisted) => updateConfig({ allowUnlisted })}
            danger
          />
        </div>

        <div className="grid gap-4 border-t p-5 md:grid-cols-2" style={{ borderColor: "var(--border)" }}>
          <Field label="用户白名单">
            <textarea
              value={form.allowedUsersText}
              onChange={(event) =>
                setForm((current) => current && { ...current, allowedUsersText: event.target.value })
              }
              placeholder="每行一个 user_openid"
              rows={4}
              className={`${INPUT_CLASS} resize-none`}
              style={INPUT_STYLE}
            />
          </Field>
          <Field label="群白名单">
            <textarea
              value={form.allowedGroupsText}
              onChange={(event) =>
                setForm((current) => current && { ...current, allowedGroupsText: event.target.value })
              }
              placeholder="每行一个 group_openid"
              rows={4}
              className={`${INPUT_CLASS} resize-none`}
              style={INPUT_STYLE}
            />
          </Field>
        </div>
      </section>

      <section
        className="rounded-2xl p-5"
        style={{ border: "0.5px solid var(--border)", background: "var(--panel-bg)" }}
      >
        <div className="mb-4 flex items-center gap-2">
          <KeyRound size={16} color="var(--accent)" />
          <h3 className="text-[15px] font-semibold" style={{ color: "var(--t1)" }}>
            QQ 渠道使用的模型
          </h3>
        </div>
        <div className="space-y-4">
          <Field label="已配置模型">
            <select
              value={selectedModel?.value ?? ""}
              onChange={(event) => selectChannelModel(event.target.value)}
              className={INPUT_CLASS}
              style={INPUT_STYLE}
            >
              <option value="" disabled>
                {modelOptions.length
                  ? selectedModelValue
                    ? "当前模型不在已配置列表中，请重新选择"
                    : "请选择用于 QQ 渠道的模型"
                  : "还没有可用模型，请先在「模型与密钥」中配置"}
              </option>
              {modelOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.providerLabel} / {option.modelId}
                  {option.value === defaultModelOption?.value ? "（主助手默认）" : ""}
                </option>
              ))}
            </select>
          </Field>

          {selectedModel ? (
            <div className="grid gap-3 md:grid-cols-3">
              <ModelSummaryItem label="Provider" value={selectedModel.providerLabel} />
              <ModelSummaryItem label="Model" value={selectedModel.modelId} mono />
              <ModelSummaryItem
                label="接口"
                value={selectedModel.apiBase || "使用默认接口"}
                mono
              />
            </div>
          ) : (
            <div
              className="rounded-xl px-4 py-3 text-[13px] leading-relaxed"
              style={{
                background: "color-mix(in srgb, #ff9f0a 10%, transparent)",
                border: "0.5px solid #ff9f0a55",
                color: "var(--t2)",
              }}
            >
              {modelOptions.length
                ? "当前 QQ 渠道配置的模型没有出现在已配置模型列表里。请选择一个已配置模型，系统会自动同步 Provider、Model、Base URL 和 API Key。"
                : "当前还没有可用于渠道的模型。请先到「模型与密钥」里配置 Provider、API Key，并启用至少一个模型。"}
            </div>
          )}

          <div
            className="rounded-xl px-4 py-3 text-[12px] leading-relaxed"
            style={{
              background: "var(--panel-bg-soft)",
              border: "0.5px solid var(--border)",
              color: "var(--t3)",
            }}
          >
            QQ 渠道会复用「模型与密钥」里保存的模型配置；保存时只把运行所需的
            Provider、Model、Base URL 和密钥写入本地渠道配置文件，不需要重复手填。
          </div>
        </div>
        <div className="mt-4">
          <ToggleCard
            title="启用记忆"
            description="QQ 对话会复用当前项目的本地 Markdown 记忆。"
            checked={agent.enableMemory}
            onChange={(enableMemory) => updateAgent({ enableMemory })}
          />
        </div>
      </section>

      {message && (
        <div
          className="rounded-xl px-4 py-3 text-[13px]"
          style={{
            background: message.ok
              ? "color-mix(in srgb, #34c759 12%, transparent)"
              : "color-mix(in srgb, #ff453a 12%, transparent)",
            color: message.ok ? "#168a43" : "#ff453a",
            border: `0.5px solid ${message.ok ? "#34c75955" : "#ff453a55"}`,
          }}
        >
          {message.text}
        </div>
      )}

      <div className="flex flex-wrap justify-end gap-3">
        <button
          type="button"
          disabled={saving}
          onClick={() => void save({ restart: false })}
          className="flex items-center gap-2 rounded-lg px-4 py-2 text-[13px] font-semibold disabled:opacity-60"
          style={{
            background: "var(--panel-bg)",
            border: "0.5px solid var(--border)",
            color: "var(--t1)",
          }}
        >
          {saving && !restarting ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
          保存配置
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => void save({ restart: true })}
          className="flex items-center gap-2 rounded-lg px-4 py-2 text-[13px] font-semibold disabled:opacity-60"
          style={{ background: "var(--accent)", color: "#fff" }}
        >
          {restarting ? <Loader2 size={15} className="animate-spin" /> : <RotateCw size={15} />}
          保存并重连
        </button>
      </div>
    </div>
  );
}

function StatusPill({ status, ready }: { status: QQBotStatus | null; ready: boolean }) {
  const running = Boolean(status?.running);
  const color = running ? "#34c759" : ready ? "#ff9f0a" : "#8e8e93";
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[12px] font-medium"
      style={{ background: "color-mix(in srgb, currentColor 12%, transparent)", color }}
    >
      {running ? <Wifi size={13} /> : <WifiOff size={13} />}
      {running ? "运行中" : status?.message || "未运行"}
    </span>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12px] font-medium" style={{ color: "var(--t3)" }}>
        {label}
      </span>
      {children}
    </label>
  );
}

function ModelSummaryItem({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div
      className="min-w-0 rounded-xl px-3 py-2"
      style={{
        background: "var(--panel-bg-soft)",
        border: "0.5px solid var(--border)",
      }}
    >
      <div className="text-[11px] font-medium" style={{ color: "var(--t3)" }}>
        {label}
      </div>
      <div
        className="mt-1 truncate text-[13px]"
        style={{
          color: "var(--t1)",
          fontFamily: mono ? "var(--font-mono)" : undefined,
        }}
        title={value}
      >
        {value}
      </div>
    </div>
  );
}

function SecretField({
  label,
  configured,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  configured: boolean;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field label={label}>
      <div className="relative">
        <input
          type="password"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className={`${INPUT_CLASS} pr-24`}
          style={INPUT_STYLE}
        />
        {configured && (
          <span
            className="pointer-events-none absolute right-2 top-1/2 inline-flex -translate-y-1/2 items-center gap-1 rounded-full px-2 py-0.5 text-[11px]"
            style={{
              background: "color-mix(in srgb, #34c759 12%, transparent)",
              color: "#168a43",
            }}
          >
            <CheckCircle2 size={12} />
            已配置
          </span>
        )}
      </div>
    </Field>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex items-center gap-2 rounded-full px-2.5 py-1.5 text-[12px] font-semibold"
      style={{
        background: checked
          ? "color-mix(in srgb, #34c759 16%, transparent)"
          : "var(--panel-bg-soft)",
        color: checked ? "#168a43" : "var(--t3)",
      }}
    >
      <span
        className="h-2.5 w-2.5 rounded-full"
        style={{ background: checked ? "#34c759" : "var(--t3)" }}
      />
      {label}
    </button>
  );
}

function ToggleCard({
  title,
  description,
  checked,
  onChange,
  danger = false,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="rounded-xl p-3 text-left transition-transform hover:-translate-y-0.5"
      style={{
        border: `0.5px solid ${
          checked ? (danger ? "#ff9f0a66" : "#34c75966") : "var(--border)"
        }`,
        background: checked
          ? danger
            ? "color-mix(in srgb, #ff9f0a 10%, var(--panel-bg))"
            : "color-mix(in srgb, #34c759 10%, var(--panel-bg))"
          : "var(--panel-bg-soft)",
      }}
    >
      <div className="flex items-center gap-2">
        <ShieldCheck size={15} color={checked ? (danger ? "#ff9f0a" : "#34c759") : "var(--t3)"} />
        <span className="text-[13px] font-semibold" style={{ color: "var(--t1)" }}>
          {title}
        </span>
      </div>
      <p className="mt-1 text-[12px] leading-relaxed" style={{ color: "var(--t2)" }}>
        {description}
      </p>
    </button>
  );
}
