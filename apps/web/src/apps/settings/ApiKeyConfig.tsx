"use client";

import { useState } from "react";
import {
  Eye, EyeOff, Check, Trash2, ChevronDown, ChevronUp,
  RefreshCw, Plus, X, ExternalLink, Wifi, WifiOff, Loader, PencilLine,
} from "lucide-react";
import { useSettingsStore, type EmbeddingConfig } from "@/stores/settingsStore";
import { PROVIDERS, type ProviderDef, generateCustomProviderId, decodeModel } from "./providers";
import { SectionTitle } from "./Settings";
import { API_BASE } from "@/lib/backend";

// ── 工具函数 ──────────────────────────────────────────

async function fetchModels(providerId: string, apiKey: string, baseUrl: string | null) {
  const res = await fetch(`${API_BASE}/agents/models/fetch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: providerId, api_key: apiKey, base_url: baseUrl }),
  });
  if (!res.ok) throw new Error("获取失败，请检查 API Key 和 Base URL");
  const data = await res.json();
  return (data.models ?? []) as string[];
}

async function testConnection(payload: Record<string, unknown>) {
  const res = await fetch(`${API_BASE}/test/connection`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.json() as Promise<{ ok: boolean; message: string }>;
}


// ── 内置 Provider 卡片 ────────────────────────────────

function ProviderCard({ def }: { def: ProviderDef }) {
  const { providers, setProvider, removeProvider } = useSettingsStore();
  const saved = providers[def.id];
  const isConfigured = !!saved?.apiKey;

  const [expanded, setExpanded] = useState(false);
  const [apiKey, setApiKey] = useState(saved?.apiKey ?? "");
  const [baseUrl, setBaseUrl] = useState(saved?.baseUrl ?? "");
  const [showKey, setShowKey] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [fetchedModels, setFetchedModels] = useState<string[]>([]);
  const [fetchError, setFetchError] = useState("");
  const [customInput, setCustomInput] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const enabledModels = saved?.enabledModels ?? [];

  const handleExpand = () => {
    if (!expanded) {
      setApiKey(saved?.apiKey ?? "");
      setBaseUrl(saved?.baseUrl ?? "");
      setFetchedModels([]);
      setFetchError("");
    }
    setExpanded((v) => !v);
  };

  const handleSave = () => {
    if (!apiKey.trim()) return;
    setProvider(def.id, { apiKey: apiKey.trim(), baseUrl: baseUrl.trim() || undefined, enabledModels: saved?.enabledModels ?? [] });
    setExpanded(false);
  };

  const handleDelete = () => {
    removeProvider(def.id);
    setApiKey(""); setBaseUrl(""); setFetchedModels([]); setExpanded(false);
  };

  const handleTest = async () => {
    const key = apiKey.trim() || saved?.apiKey;
    if (!key) return;
    setTesting(true); setTestResult(null);
    try {
      const result = await testConnection({ type: "llm", provider: def.id, api_key: key, base_url: (baseUrl.trim() || saved?.baseUrl) ?? null, model: enabledModels[0] ?? "" });
      setTestResult(result);
    } catch { setTestResult({ ok: false, message: "无法连接后端服务" }); }
    finally { setTesting(false); }
  };

  const handleFetch = async () => {
    const key = apiKey.trim();
    if (!key) { setFetchError("请先填写 API Key"); return; }
    setFetching(true); setFetchError(""); setFetchedModels([]);
    try {
      const models = await fetchModels(def.id, key, baseUrl.trim() || def.defaultBaseUrl || null);
      setFetchedModels(models);
    } catch (e) { setFetchError((e as Error).message); }
    finally { setFetching(false); }
  };

  const toggleModel = (id: string) => {
    const next = enabledModels.includes(id) ? enabledModels.filter((m) => m !== id) : [...enabledModels, id];
    setProvider(def.id, { ...(saved ?? { apiKey: apiKey.trim() }), enabledModels: next });
  };

  const addCustom = () => {
    const id = customInput.trim();
    if (!id || enabledModels.includes(id)) return;
    setProvider(def.id, { ...(saved ?? { apiKey: apiKey.trim() }), enabledModels: [...enabledModels, id] });
    setCustomInput("");
  };

  return (
    <div className="settings-provider-row overflow-hidden" style={{ border: `0.5px solid ${isConfigured ? def.color + "50" : "var(--border)"}`, background: "var(--panel-bg-soft)" }}>
      <button
        className="settings-provider-trigger w-full flex items-center gap-3 px-4 py-3 text-left"
        onClick={handleExpand}
        aria-expanded={expanded}
        aria-label={`${expanded ? "收起" : "展开"} ${def.name} 配置`}
      >
        <div className="settings-provider-icon w-8 h-8 rounded-lg shrink-0 flex items-center justify-center text-[13px] font-bold text-white" style={{ background: isConfigured ? def.color : "rgba(0,0,0,0.1)" }}>
          {def.name.slice(0, 2).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-semibold" style={{ color: "var(--t1)" }}>{def.name}</span>
            {def.nameCn !== def.name && <span className="text-[13px]" style={{ color: "var(--t3)" }}>{def.nameCn}</span>}
          </div>
          {isConfigured
            ? <div className="flex items-center gap-1.5 mt-0.5"><div className="w-1.5 h-1.5 rounded-full" style={{ background: "#22C55E" }} /><span className="text-[13px]" style={{ color: "#22C55E" }}>已配置 · {enabledModels.length} 个模型</span></div>
            : <span className="text-[13px]" style={{ color: "var(--t3)" }}>未配置</span>}
        </div>
        {expanded ? <ChevronUp size={14} color="var(--t3)" /> : <ChevronDown size={14} color="var(--t3)" />}
      </button>

      {expanded && (
        <div className="settings-provider-details px-4 pb-4 flex flex-col gap-3" style={{ borderTop: "0.5px solid var(--border-faint)" }}>
          <ProviderForm
            baseUrl={baseUrl} setBaseUrl={setBaseUrl}
            defaultBaseUrl={def.defaultBaseUrl}
            apiKey={apiKey} setApiKey={(v) => { setApiKey(v); setTestResult(null); }}
            showKey={showKey} setShowKey={setShowKey}
            apiKeyUrl={def.apiKeyUrl} color={def.color}
          />
          <ModelSelector
            fetchedModels={fetchedModels} enabledModels={enabledModels}
            color={def.color} customInput={customInput}
            setCustomInput={setCustomInput}
            onToggle={toggleModel} onAddCustom={addCustom}
          />
          <ProviderActions
            color={def.color} apiKey={apiKey} savedApiKey={saved?.apiKey}
            testResult={testResult} testing={testing} fetching={fetching}
            onSave={handleSave} onTest={handleTest} onFetch={handleFetch}
            onDelete={isConfigured ? handleDelete : undefined}
            fetchError={fetchError}
            hasModels={enabledModels.length > 0}
          />
        </div>
      )}
    </div>
  );
}


// ── 自定义 Provider 卡片 ──────────────────────────────

function CustomProviderCard({ id }: { id: string }) {
  const { providers, setProvider, removeProvider } = useSettingsStore();
  const cfg = providers[id] ?? { apiKey: "", enabledModels: [], isCustom: true as const };
  const CUSTOM_COLOR = "#8B5CF6";

  const [expanded, setExpanded] = useState(false);
  const [name, setName] = useState(cfg.name ?? "");
  const [apiKey, setApiKey] = useState(cfg.apiKey ?? "");
  const [baseUrl, setBaseUrl] = useState(cfg.baseUrl ?? "");
  const [showKey, setShowKey] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [fetchedModels, setFetchedModels] = useState<string[]>([]);
  const [fetchError, setFetchError] = useState("");
  const [customInput, setCustomInput] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const enabledModels = cfg.enabledModels ?? [];

  const handleExpand = () => {
    if (!expanded) { setName(cfg.name ?? ""); setApiKey(cfg.apiKey ?? ""); setBaseUrl(cfg.baseUrl ?? ""); setFetchedModels([]); setFetchError(""); }
    setExpanded((v) => !v);
  };

  const handleSave = () => {
    if (!apiKey.trim()) return;
    setProvider(id, { ...cfg, name: name.trim() || cfg.name, apiKey: apiKey.trim(), baseUrl: baseUrl.trim() || undefined });
    setExpanded(false);
  };

  const handleTest = async () => {
    const key = apiKey.trim() || cfg.apiKey;
    if (!key) return;
    setTesting(true); setTestResult(null);
    try {
      const testProvider = cfg.compatType === "anthropic" ? "anthropic-compatible" : "openai-compatible";
      const result = await testConnection({ type: "llm", provider: testProvider, api_key: key, base_url: (baseUrl.trim() || cfg.baseUrl) ?? null, model: enabledModels[0] ?? "" });
      setTestResult(result);
    } catch { setTestResult({ ok: false, message: "无法连接后端服务" }); }
    finally { setTesting(false); }
  };

  const handleFetch = async () => {
    const key = apiKey.trim();
    const url = baseUrl.trim();
    if (!key) { setFetchError("请先填写 API Key"); return; }
    if (!url) { setFetchError("请先填写 Base URL"); return; }
    setFetching(true); setFetchError(""); setFetchedModels([]);
    try {
      const models = await fetchModels("openai-compatible", key, url);
      setFetchedModels(models);
    } catch (e) { setFetchError((e as Error).message); }
    finally { setFetching(false); }
  };

  const toggleModel = (modelId: string) => {
    const next = enabledModels.includes(modelId) ? enabledModels.filter((m) => m !== modelId) : [...enabledModels, modelId];
    setProvider(id, { ...cfg, enabledModels: next });
  };

  const addCustom = () => {
    const modelId = customInput.trim();
    if (!modelId || enabledModels.includes(modelId)) return;
    setProvider(id, { ...cfg, enabledModels: [...enabledModels, modelId] });
    setCustomInput("");
  };

  return (
    <div className="settings-provider-row overflow-hidden" style={{ border: `0.5px solid ${cfg.apiKey ? CUSTOM_COLOR + "50" : "var(--border)"}`, background: "var(--panel-bg-soft)" }}>
      <button
        className="settings-provider-trigger w-full flex items-center gap-3 px-4 py-3 text-left"
        onClick={handleExpand}
        aria-expanded={expanded}
        aria-label={`${expanded ? "收起" : "展开"} ${cfg.name ?? "自定义 Provider"} 配置`}
      >
        <div className="settings-provider-icon w-8 h-8 rounded-lg shrink-0 flex items-center justify-center text-[13px] font-bold text-white" style={{ background: cfg.apiKey ? CUSTOM_COLOR : "rgba(0,0,0,0.1)" }}>
          {(cfg.name ?? "?").slice(0, 2).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-[14px] font-semibold block" style={{ color: "var(--t1)" }}>{cfg.name ?? "未命名"}</span>
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            <span className="text-[11px] px-1.5 py-0.5 rounded-md" style={{ background: "rgba(139,92,246,0.1)", color: "#8B5CF6" }}>
              {cfg.compatType === "anthropic" ? "Anthropic 兼容" : "OpenAI 兼容"}
            </span>
            {cfg.apiKey
              ? <><div className="w-1.5 h-1.5 rounded-full" style={{ background: "#22C55E" }} /><span className="text-[13px]" style={{ color: "#22C55E" }}>已配置 · {enabledModels.length} 个模型</span></>
              : <span className="text-[13px]" style={{ color: "var(--t3)" }}>{cfg.baseUrl || "未配置"}</span>}
          </div>
        </div>
        {expanded ? <ChevronUp size={14} color="var(--t3)" /> : <ChevronDown size={14} color="var(--t3)" />}
      </button>

      {expanded && (
        <div className="settings-provider-details px-4 pb-4 flex flex-col gap-3" style={{ borderTop: "0.5px solid var(--border-faint)" }}>
          {/* 名称 */}
          <div className="pt-3">
            <label className="text-[13px] font-medium mb-1 block" style={{ color: "var(--t3)" }}>名称</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)}
              placeholder="如：SiliconFlow、Groq、本地 Ollama"
              className="w-full px-3 py-1.5 rounded-lg text-[13px] outline-none"
              style={{ background: "var(--input-bg)", border: "0.5px solid var(--border)", color: "var(--t1)" }}
            />
          </div>
          <ProviderForm
            baseUrl={baseUrl} setBaseUrl={setBaseUrl}
            defaultBaseUrl="" placeholder="https://api.siliconflow.cn/v1"
            apiKey={apiKey} setApiKey={(v) => { setApiKey(v); setTestResult(null); }}
            showKey={showKey} setShowKey={setShowKey}
          />
          <ModelSelector
            fetchedModels={fetchedModels} enabledModels={enabledModels}
            color={CUSTOM_COLOR} customInput={customInput}
            setCustomInput={setCustomInput}
            onToggle={toggleModel} onAddCustom={addCustom}
          />
          <ProviderActions
            color={CUSTOM_COLOR} apiKey={apiKey} savedApiKey={cfg.apiKey}
            testResult={testResult} testing={testing} fetching={fetching}
            onSave={handleSave} onTest={handleTest} onFetch={handleFetch}
            onDelete={() => removeProvider(id)}
            fetchError={fetchError}
            hasModels={enabledModels.length > 0}
          />
        </div>
      )}
    </div>
  );
}


// ── 添加自定义 Provider 表单 ──────────────────────────

function AddCustomProviderForm({ onAdd }: { onAdd: () => void }) {
  const { setProvider } = useSettingsStore();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [compatType, setCompatType] = useState<"openai" | "anthropic">("openai");

  const handleAdd = () => {
    const n = name.trim();
    if (!n) return;
    const id = generateCustomProviderId();
    setProvider(id, { apiKey: "", enabledModels: [], name: n, isCustom: true, compatType });
    setName("");
    setCompatType("openai");
    setOpen(false);
    onAdd();
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="settings-add-row flex w-full items-center gap-1.5 px-3 py-2 text-[13px] transition-colors"
        style={{ border: "0.5px dashed rgba(0,0,0,0.15)", color: "var(--t3)" }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(0,0,0,0.03)")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
      >
        <Plus size={13} /> 添加自定义 Provider
      </button>
    );
  }

  return (
    <div className="settings-provider-row px-4 py-3 flex flex-col gap-2" style={{ border: "0.5px solid #8B5CF650", background: "#8B5CF606" }}>
      <p className="text-[13px] font-medium" style={{ color: "var(--t1)" }}>新建自定义 Provider</p>
      <div className="flex gap-2">
        <input
          type="text" value={name} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          placeholder="名称，如：SiliconFlow、Groq、本地 Ollama"
          autoFocus
          className="flex-1 px-3 py-1.5 rounded-lg text-[13px] outline-none"
          style={{ background: "var(--input-bg)", border: "0.5px solid var(--border)", color: "var(--t1)" }}
        />
        <button onClick={handleAdd} disabled={!name.trim()}
          className="px-3 py-1.5 rounded-lg text-[13px] font-medium"
          style={{ background: name.trim() ? "#8B5CF6" : "rgba(0,0,0,0.06)", color: name.trim() ? "#fff" : "var(--t3)" }}
        >
          创建
        </button>
        <button onClick={() => { setOpen(false); setName(""); }}
          className="px-2 py-1.5 rounded-lg text-[13px]" style={{ color: "var(--t3)" }}>
          <X size={13} />
        </button>
      </div>
      <div className="flex gap-2">
        {(["openai", "anthropic"] as const).map((t) => (
          <button key={t} onClick={() => setCompatType(t)}
            className="flex-1 py-1 rounded-lg text-[13px] font-medium transition-colors"
            style={compatType === t
              ? { background: "#8B5CF6", color: "#fff" }
              : { background: "rgba(0,0,0,0.05)", color: "var(--t2)" }}>
            {t === "openai" ? "OpenAI 兼容" : "Anthropic 兼容"}
          </button>
        ))}
      </div>
      <p className="text-[12px]" style={{ color: "var(--t3)" }}>
        {compatType === "openai"
          ? "支持所有 OpenAI 兼容接口（硅基流动、Groq、Together、本地 Ollama 等）"
          : "支持 Anthropic 兼容接口（如自建代理、AWS Bedrock 等）"}
      </p>
    </div>
  );
}


// ── Embedding 配置（单一激活配置）────────────────────

const EMBEDDING_PRESETS = [
  { label: "Qwen3-Embedding-8B（阿里）", model: "text-embedding-v3", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", dims: 4096 },
  { label: "bge-large-zh-v1.5（硅基流动）", model: "BAAI/bge-large-zh-v1.5", baseUrl: "https://api.siliconflow.cn/v1", dims: 1024 },
  { label: "bge-m3（硅基流动）", model: "BAAI/bge-m3", baseUrl: "https://api.siliconflow.cn/v1", dims: 1024 },
  { label: "text-embedding-3-small（OpenAI）", model: "text-embedding-3-small", baseUrl: "https://api.openai.com/v1", dims: 1536 },
  { label: "text-embedding-3-large（OpenAI）", model: "text-embedding-3-large", baseUrl: "https://api.openai.com/v1", dims: 3072 },
];

function EmbeddingSection() {
  const { embeddingConfig, setEmbeddingConfig, providers, defaultModel } = useSettingsStore();
  const [editing, setEditing] = useState(!embeddingConfig);
  const [model, setModel] = useState(embeddingConfig?.model ?? "");
  const [baseUrl, setBaseUrl] = useState(embeddingConfig?.baseUrl ?? "");
  const [apiKey, setApiKey] = useState(embeddingConfig?.apiKey ?? "");
  const [dims, setDims] = useState(String(embeddingConfig?.dims ?? ""));
  const [name, setName] = useState(embeddingConfig?.name ?? "");
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [saveMsgType, setSaveMsgType] = useState<"success" | "error">("success");
  const [showPresets, setShowPresets] = useState(false);

  const applyPreset = (preset: typeof EMBEDDING_PRESETS[0]) => {
    setModel(preset.model);
    setBaseUrl(preset.baseUrl);
    setDims(String(preset.dims));
    setName(preset.label);
    setShowPresets(false);
    setTestResult(null);
  };

  const handleTest = async () => {
    if (!apiKey.trim() || !baseUrl.trim() || !model.trim()) return;
    setTesting(true); setTestResult(null);
    try {
      const result = await testConnection({ type: "embedding", api_key: apiKey.trim(), base_url: baseUrl.trim(), embedding_model: model.trim() });
      setTestResult(result);
    } catch { setTestResult({ ok: false, message: "无法连接后端服务" }); }
    finally { setTesting(false); }
  };

  const handleSave = async () => {
    if (!apiKey.trim() || !model.trim() || !baseUrl.trim() || !dims) return;
    const parsedDims = Number.parseInt(dims, 10);
    if (!Number.isFinite(parsedDims) || parsedDims <= 0) {
      setSaveMsgType("error");
      setSaveMsg("请填写正确的 Embedding 维度，例如 1024、1536、3072 或 4096");
      return;
    }
    const cfg: EmbeddingConfig = {
      name: name.trim() || model.trim(),
      provider: "openai",
      model: model.trim(),
      apiKey: apiKey.trim(),
      baseUrl: baseUrl.trim(),
      dims: parsedDims,
    };
    setEmbeddingConfig(cfg);
    setSaving(true);
    try {
      // 查找当前 LLM 配置
      let llmModel = ""; let llmApiKey = ""; let llmApiBase = "";
      if (defaultModel) {
        const { decodeModel: dm, PROVIDERS: PS } = await import("./providers");
        const { providerId, modelId } = dm(defaultModel);
        const pcfg = providers[providerId];
        if (pcfg?.apiKey) {
          llmModel = modelId; llmApiKey = pcfg.apiKey;
          llmApiBase = pcfg.baseUrl ?? PS.find(p => p.id === providerId)?.defaultBaseUrl ?? "";
        }
      }
      if (!llmModel) {
        // 没有 defaultModel，找第一个配置好的
        for (const [pid, pcfg] of Object.entries(providers)) {
          if (pcfg.apiKey && pcfg.enabledModels?.length) {
            const { PROVIDERS: PS } = await import("./providers");
            llmModel = pcfg.enabledModels[0]; llmApiKey = pcfg.apiKey;
            llmApiBase = pcfg.baseUrl ?? PS.find(p => p.id === pid)?.defaultBaseUrl ?? "";
            break;
          }
        }
      }
      if (!llmModel) {
        setSaveMsgType("error"); setSaveMsg("请先配置一个 LLM 提供商（用于记忆提取）");
        setSaving(false); return;
      }
      const res = await fetch(`${API_BASE}/memory/init`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          llm_provider: "litellm", llm_model: llmModel,
          llm_api_key: llmApiKey, llm_api_base: llmApiBase || null,
          embedder_provider: "openai", embedder_model: cfg.model,
          embedder_api_key: cfg.apiKey, embedder_base_url: cfg.baseUrl, embedder_dims: cfg.dims,
        }),
      });
      if (res.ok) {
        setSaveMsgType("success"); setSaveMsg("已保存并激活");
        setTimeout(() => { setSaveMsg(""); setEditing(false); }, 1500);
      } else {
        const data = await res.json().catch(() => ({}));
        setSaveMsgType("error"); setSaveMsg(`初始化失败：${data.detail ?? `HTTP ${res.status}`}`);
      }
    } catch (e) {
      setSaveMsgType("error"); setSaveMsg(`无法连接后端：${(e as Error).message}`);
    } finally { setSaving(false); }
  };

  if (!editing && embeddingConfig) {
    return (
    <div className="settings-provider-row px-4 py-3 flex items-center gap-3" style={{ border: "0.5px solid var(--border)", background: "var(--panel-bg-soft)" }}>
        <div className="settings-provider-icon w-8 h-8 rounded-lg shrink-0 flex items-center justify-center text-[13px] font-bold text-white" style={{ background: "#0EA5E9" }}>
          EM
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full" style={{ background: "#22C55E" }} />
            <span className="text-[14px] font-semibold" style={{ color: "var(--t1)" }}>{embeddingConfig.name || embeddingConfig.model}</span>
          </div>
          <span className="text-[13px]" style={{ color: "var(--t3)", fontFamily: "var(--font-mono)" }}>
            {embeddingConfig.model} · {embeddingConfig.dims}d
          </span>
        </div>
        <button
          onClick={() => {
          setModel(embeddingConfig.model); setBaseUrl(embeddingConfig.baseUrl);
          setApiKey(embeddingConfig.apiKey); setDims(String(embeddingConfig.dims));
          setName(embeddingConfig.name ?? ""); setTestResult(null); setEditing(true);
        }}
          className="settings-icon-button settings-edit-button flex shrink-0 items-center justify-center rounded-full"
          style={{ color: "var(--t2)", background: "var(--control-bg)" }}
          aria-label="修改 Embedding 模型配置"
          title="修改"
        >
          <PencilLine size={14} />
        </button>
        <button
          onClick={() => setEmbeddingConfig(null)}
          className="settings-icon-button settings-danger-icon-button flex shrink-0 items-center justify-center rounded-full"
          style={{ color: "var(--red)" }}
          aria-label="删除 Embedding 模型配置"
          title="删除"
        >
          <Trash2 size={13} />
        </button>
      </div>
    );
  }

  return (
    <div className="settings-provider-row px-4 pb-4 flex flex-col gap-3" style={{ border: "0.5px solid var(--border)", background: "var(--panel-bg-soft)" }}>
      <div className="pt-3 flex items-center justify-between">
        <p className="text-[13px] font-medium" style={{ color: "var(--t2)" }}>配置 Embedding 模型</p>
        <div className="relative">
          <button onClick={() => setShowPresets((v) => !v)}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[13px]"
            style={{ background: "var(--control-bg)", color: "var(--t3)" }}>
            常用预设 <ChevronDown size={11} className={showPresets ? "rotate-180" : ""} />
          </button>
          {showPresets && (
            <div className="absolute right-0 top-full mt-1 z-10 rounded-xl overflow-hidden" style={{ minWidth: 280, background: "var(--surface-solid)", border: "0.5px solid var(--border)", boxShadow: "var(--shadow-menu)" }}>
              {EMBEDDING_PRESETS.map((p) => (
                <button key={p.model} onClick={() => applyPreset(p)}
                  className="w-full flex flex-col px-3 py-2 text-left hover:bg-black/5 text-[13px]"
                  style={{ color: "var(--t1)" }}>
                  <span>{p.label}</span>
                  <span className="text-[12px]" style={{ color: "var(--t3)", fontFamily: "var(--font-mono)" }}>{p.model} · {p.dims}d</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[13px] font-medium mb-1 block" style={{ color: "var(--t3)" }}>模型 ID</label>
          <input type="text" value={model} onChange={(e) => { setModel(e.target.value); setTestResult(null); }}
            placeholder="text-embedding-3-small"
            className="w-full px-3 py-1.5 rounded-lg text-[13px] outline-none"
            style={{ background: "var(--input-bg)", border: "0.5px solid var(--border)", color: "var(--t1)", fontFamily: "var(--font-mono)" }}
          />
        </div>
        <div>
          <label className="text-[13px] font-medium mb-1 block" style={{ color: "var(--t3)" }}>向量维度</label>
          <input type="number" value={dims} onChange={(e) => setDims(e.target.value)}
            placeholder="1024"
            className="w-full px-3 py-1.5 rounded-lg text-[13px] outline-none"
            style={{ background: "var(--input-bg)", border: "0.5px solid var(--border)", color: "var(--t1)" }}
          />
        </div>
      </div>

      <div>
        <label className="text-[13px] font-medium mb-1 block" style={{ color: "var(--t3)" }}>Base URL</label>
        <input type="text" value={baseUrl} onChange={(e) => { setBaseUrl(e.target.value); setTestResult(null); }}
          placeholder="https://api.siliconflow.cn/v1"
          className="w-full px-3 py-1.5 rounded-lg text-[13px] outline-none"
          style={{ background: "var(--input-bg)", border: "0.5px solid var(--border)", color: "var(--t1)", fontFamily: "var(--font-mono)" }}
        />
      </div>

      <div>
        <label className="text-[13px] font-medium mb-1 block" style={{ color: "var(--t3)" }}>API Key</label>
        <div className="relative">
          <input type={showKey ? "text" : "password"} value={apiKey}
            onChange={(e) => { setApiKey(e.target.value); setTestResult(null); }}
            placeholder="sk-..."
            className="w-full pr-8 pl-3 py-1.5 rounded-lg text-[13px] outline-none"
            style={{ background: "var(--input-bg)", border: "0.5px solid var(--border)", color: "var(--t1)", fontFamily: "var(--font-mono)" }}
          />
          <button className="absolute right-2 top-1/2 -translate-y-1/2" onClick={() => setShowKey((v) => !v)}>
            {showKey ? <EyeOff size={13} color="rgba(0,0,0,0.3)" /> : <Eye size={13} color="rgba(0,0,0,0.3)" />}
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={handleSave}
          disabled={!apiKey.trim() || !model.trim() || !baseUrl.trim() || !dims || saving || !testResult?.ok}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[13px] font-medium"
          style={apiKey.trim() && model.trim() && baseUrl.trim() && dims && testResult?.ok && !saving
            ? { background: "#0EA5E9", color: "#fff" }
            : { background: "var(--disabled-bg)", color: "var(--disabled-text)", cursor: "not-allowed", opacity: 0.5, border: "0.5px dashed var(--border-strong)" }}>
          <Check size={12} /> {saving ? "保存中…" : "保存并激活"}
        </button>
        <button onClick={handleTest}
          disabled={testing || !apiKey.trim() || !model.trim() || !baseUrl.trim()}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[13px] font-medium"
          style={{ background: "var(--control-bg)", color: "var(--t2)" }}>
          {testing ? <Loader size={12} className="animate-spin" /> : <Wifi size={12} />}
          {testing ? "测试中…" : "测试连接"}
        </button>
        {embeddingConfig && (
          <button onClick={() => setEditing(false)} className="px-3 py-1.5 rounded-lg text-[13px]" style={{ color: "var(--t3)" }}>取消</button>
        )}
      </div>

      {testResult && (
        <p className="text-[13px] px-3 py-2 rounded-lg flex items-center gap-1.5"
          style={testResult.ok ? { background: "rgba(34,197,94,0.08)", color: "#22C55E" } : { background: "rgba(255,59,48,0.08)", color: "var(--red, #ef4444)" }}>
          {testResult.ok ? <Wifi size={12} /> : <WifiOff size={12} />} {testResult.message}
        </p>
      )}
      {saveMsg && (
        <p className="text-[13px] px-3 py-2 rounded-lg"
          style={saveMsgType === "success" ? { background: "rgba(34,197,94,0.08)", color: "#22C55E" } : { background: "rgba(255,59,48,0.08)", color: "var(--red, #ef4444)" }}>
          {saveMsg}
        </p>
      )}
    </div>
  );
}


// ── 共用子组件 ────────────────────────────────────────

function ProviderForm({ baseUrl, setBaseUrl, defaultBaseUrl, placeholder, apiKey, setApiKey, showKey, setShowKey, apiKeyUrl, color }: {
  baseUrl: string; setBaseUrl: (v: string) => void;
  defaultBaseUrl?: string; placeholder?: string;
  apiKey: string; setApiKey: (v: string) => void;
  showKey: boolean; setShowKey: (v: boolean) => void;
  apiKeyUrl?: string; color?: string;
}) {
  return (
    <>
      <div className="pt-3">
        <label className="text-[13px] font-medium mb-1 block" style={{ color: "var(--t3)" }}>
          Base URL {defaultBaseUrl && <span className="font-normal">（默认 {defaultBaseUrl}）</span>}
        </label>
        <input type="text" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)}
          placeholder={placeholder ?? defaultBaseUrl ?? "https://your-endpoint/v1"}
          className="w-full px-3 py-1.5 rounded-lg text-[13px] outline-none"
          style={{ background: "var(--input-bg)", border: "0.5px solid var(--border)", color: "var(--t1)", fontFamily: "var(--font-mono)" }}
        />
      </div>
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-[13px] font-medium" style={{ color: "var(--t3)" }}>API Key</label>
          {apiKeyUrl && color && (
            <a href={apiKeyUrl} target="_blank" rel="noreferrer" className="flex items-center gap-0.5 text-[13px]" style={{ color }}>
              获取 Key <ExternalLink size={10} />
            </a>
          )}
        </div>
        <div className="relative">
          <input type={showKey ? "text" : "password"} value={apiKey} onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-..."
            className="w-full pr-8 pl-3 py-1.5 rounded-lg text-[13px] outline-none"
            style={{ background: "var(--input-bg)", border: "0.5px solid var(--border)", color: "var(--t1)", fontFamily: "var(--font-mono)" }}
          />
          <button className="absolute right-2 top-1/2 -translate-y-1/2" onClick={() => setShowKey(!showKey)}>
            {showKey ? <EyeOff size={13} color="rgba(0,0,0,0.3)" /> : <Eye size={13} color="rgba(0,0,0,0.3)" />}
          </button>
        </div>
      </div>
    </>
  );
}

function ProviderActions({ color, apiKey, savedApiKey, testResult, testing, fetching, onSave, onTest, onFetch, onDelete, fetchError, hasModels }: {
  color: string; apiKey: string; savedApiKey?: string;
  testResult: { ok: boolean; message: string } | null;
  testing: boolean; fetching: boolean;
  onSave: () => void; onTest: () => void; onFetch: () => void;
  onDelete?: () => void; fetchError: string;
  hasModels?: boolean;
}) {
  const canTest = (apiKey.trim() || !!savedApiKey) && (hasModels !== false);
  const canSave = !!(apiKey.trim() && testResult?.ok && hasModels !== false);
  return (
    <>
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={onSave} disabled={!canSave}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[13px] font-medium"
          style={canSave
            ? { background: color, color: "#fff" }
            : { background: "var(--disabled-bg)", color: "var(--disabled-text)", cursor: "not-allowed", opacity: 0.5, border: "0.5px dashed var(--border-strong)" }}>
          <Check size={12} /> 保存
        </button>
        <button onClick={onTest} disabled={testing || !canTest}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[13px] font-medium"
          style={{ background: "var(--control-bg)", color: "var(--t2)" }}>
          {testing ? <Loader size={12} className="animate-spin" /> : <Wifi size={12} />}
          {testing ? "测试中…" : "测试连接"}
        </button>
        <button onClick={onFetch} disabled={fetching}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[13px] font-medium"
          style={{ background: "var(--control-bg)", color: "var(--t2)" }}>
          <RefreshCw size={12} className={fetching ? "animate-spin" : ""} />
          {fetching ? "获取中…" : "获取模型列表"}
        </button>
        {onDelete && (
          <button onClick={onDelete} className="ml-auto flex items-center gap-1 px-2 py-1.5 rounded-lg text-[13px]" style={{ color: "var(--red)" }}>
            <Trash2 size={12} /> 删除
          </button>
        )}
      </div>
      {testResult && (
        <p className="text-[13px] px-3 py-2 rounded-lg flex items-center gap-1.5"
          style={testResult.ok ? { background: "rgba(34,197,94,0.08)", color: "#22C55E" } : { background: "rgba(255,59,48,0.08)", color: "var(--red, #ef4444)" }}>
          {testResult.ok ? <Wifi size={12} /> : <WifiOff size={12} />} {testResult.message}
        </p>
      )}
      {fetchError && (
        <p className="text-[13px] px-3 py-2 rounded-lg" style={{ background: "rgba(255,59,48,0.08)", color: "var(--red)" }}>{fetchError}</p>
      )}
    </>
  );
}

function ModelSelector({ fetchedModels, enabledModels, color, customInput, setCustomInput, onToggle, onAddCustom }: {
  fetchedModels: string[]; enabledModels: string[];
  color: string; customInput: string;
  setCustomInput: (v: string) => void;
  onToggle: (id: string) => void; onAddCustom: () => void;
}) {
  const displayModels = fetchedModels.length > 0 ? fetchedModels : enabledModels;
  return (
    <>
      {displayModels.length > 0 && (
        <div>
          <p className="text-[13px] font-medium mb-2" style={{ color: "var(--t3)" }}>
            {fetchedModels.length > 0 ? `选择启用的模型（已选 ${enabledModels.length}）` : `已启用 ${enabledModels.length} 个模型`}
          </p>
          <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
            {displayModels.map((m) => {
              const checked = enabledModels.includes(m);
              return (
                <button key={m} onClick={() => onToggle(m)}
                  className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left text-[13px]"
                  style={{ background: checked ? color + "12" : "transparent", border: `0.5px solid ${checked ? color + "40" : "rgba(0,0,0,0.06)"}`, color: "var(--t1)", fontFamily: "var(--font-mono)" }}>
                  <div className="w-3.5 h-3.5 rounded flex items-center justify-center shrink-0" style={{ background: checked ? color : "rgba(0,0,0,0.08)" }}>
                    {checked && <Check size={9} color="#fff" strokeWidth={3} />}
                  </div>
                  {m}
                </button>
              );
            })}
          </div>
        </div>
      )}
      <div>
        <p className="text-[13px] font-medium mb-1.5" style={{ color: "var(--t3)" }}>手动添加模型 ID</p>
        <div className="flex gap-2">
          <input type="text" value={customInput} onChange={(e) => setCustomInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onAddCustom()}
            placeholder="输入模型 ID，如 gpt-4o"
            className="flex-1 px-3 py-1.5 rounded-lg text-[13px] outline-none"
            style={{ background: "var(--input-bg)", border: "0.5px solid var(--border)", color: "var(--t1)", fontFamily: "var(--font-mono)" }}
          />
          <button onClick={onAddCustom} className="px-3 py-1.5 rounded-lg text-[13px] flex items-center gap-1" style={{ background: "var(--control-bg)", color: "var(--t2)" }}>
            <Plus size={12} /> 添加
          </button>
        </div>
        {enabledModels.filter((m) => !fetchedModels.includes(m)).length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {enabledModels.filter((m) => !fetchedModels.includes(m)).map((m) => (
              <span key={m} className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[13px]"
                style={{ background: color + "15", color, fontFamily: "var(--font-mono)" }}>
                {m}
                <button onClick={() => onToggle(m)}><X size={10} /></button>
              </span>
            ))}
          </div>
        )}
      </div>
    </>
  );
}


// ── 分组折叠面板 ──────────────────────────────────────

function GroupPanel({ title, description, defaultOpen = false, testId, variant, children }: {
  title: string; description: string; defaultOpen?: boolean; testId?: string; variant?: string; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div
      className="settings-group-panel overflow-hidden"
      data-testid={testId}
      data-variant={variant}
      style={{ border: "0.5px solid var(--border)", background: "var(--panel-bg-soft)" }}
    >
      <button
        className="w-full flex items-center justify-between px-5 py-4 text-left"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <div>
          <p className="text-[15px] font-semibold" style={{ color: "var(--t1)" }}>{title}</p>
          <p className="text-[13px] mt-0.5" style={{ color: "var(--t3)" }}>{description}</p>
        </div>
        {open ? <ChevronUp size={15} color="var(--t3)" /> : <ChevronDown size={15} color="var(--t3)" />}
      </button>
      {open && (
        <div className="settings-group-body px-4 pb-4 flex flex-col gap-2" style={{ borderTop: "0.5px solid var(--border-faint)" }}>
          <div className="pt-2" />
          {children}
        </div>
      )}
    </div>
  );
}


// ── 主组件 ────────────────────────────────────────────

export function ApiKeyConfig() {
  const { providers } = useSettingsStore();
  const [, forceUpdate] = useState(0);

  // 自定义 Provider 列表
  const customProviders = Object.entries(providers).filter(([, cfg]) => cfg.isCustom);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[13px] mb-1" style={{ color: "var(--t3)" }}>
        所有 API Key 仅保存在本地浏览器中，不会上传到服务器。
      </p>

      <GroupPanel
        title="LLM 模型提供商"
        description="配置大语言模型的 API Key 与可用模型"
        defaultOpen
        testId="llm-provider-group"
        variant="macos-grouped-list"
      >
        {PROVIDERS.map((p) => <ProviderCard key={p.id} def={p} />)}

        {/* 自定义 Provider */}
        {customProviders.length > 0 && (
          <div className="flex flex-col gap-2 mt-1 pt-2" style={{ borderTop: "0.5px dashed rgba(0,0,0,0.08)" }}>
            <p className="text-[12px] px-1" style={{ color: "var(--t3)" }}>自定义 Provider（OpenAI 兼容）</p>
            {customProviders.map(([id]) => <CustomProviderCard key={id} id={id} />)}
          </div>
        )}
        <AddCustomProviderForm onAdd={() => forceUpdate((n) => n + 1)} />
      </GroupPanel>

      <GroupPanel title="Embedding 模型" description="用于记忆系统和知识库向量化，配置一个即可">
        <EmbeddingSection />
      </GroupPanel>

    </div>
  );
}
