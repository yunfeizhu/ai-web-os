"use client";

import { useEffect, useState } from "react";
import { Trash2, RefreshCw, Search, Brain, Database } from "lucide-react";
import { SectionTitle } from "./Settings";
import { API_BASE } from "@/lib/backend";
import { useSettingsStore } from "@/stores/settingsStore";

const API = API_BASE;

interface Memory {
  id: string;
  memory: string;
  created_at?: string;
  score?: number;
}

interface MemoryListResponse {
  memories?: Memory[];
  initialized?: boolean;
  collection?: string | null;
  embedder_model?: string | null;
  embedder_base_url?: string | null;
  embedder_dims?: number | null;
}

// 与后端 _collection_name() 逻辑对齐
function collectionName(model: string, dims?: number): string {
  const slug = model.toLowerCase().split("/").pop() ?? model.toLowerCase();
  const safe = slug.replace(/[^a-z0-9]/g, "_").replace(/^_+|_+$/g, "");
  return `ai_os_mem_${safe}${dims ? `_${dims}` : ""}`;
}

export function MemoryManager() {
  const { embeddingConfig: activeProvider, providers, defaultModel } = useSettingsStore();

  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(false);
  const [initialized, setInitialized] = useState<boolean | null>(null);
  const [activeCollection, setActiveCollection] = useState<string | null>(null);
  const [searchQ, setSearchQ] = useState("");
  const [searchResults, setSearchResults] = useState<Memory[] | null>(null);

  const reinit = async (cfg: NonNullable<typeof activeProvider>) => {
    const { decodeModel, PROVIDERS } = await import("./providers");
    let llmModel = "";
    let llmApiKey: string | null = null;
    let llmApiBase: string | null = null;
    if (defaultModel) {
      const { providerId, modelId } = decodeModel(defaultModel);
      const pcfg = providers[providerId];
      const pdef = PROVIDERS.find(p => p.id === providerId);
      if (pcfg?.apiKey) {
        llmModel = modelId;
        llmApiKey = pcfg.apiKey;
        llmApiBase = pcfg.baseUrl ?? pdef?.defaultBaseUrl ?? null;
      }
    }
    if (!llmModel) return;
    const res = await fetch(`${API}/memory/init`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        llm_provider: "litellm",
        llm_model: llmModel,
        llm_api_key: llmApiKey,
        llm_api_base: llmApiBase,
        embedder_provider: "openai",
        embedder_model: cfg.model,
        embedder_api_key: cfg.apiKey,
        embedder_base_url: cfg.baseUrl,
        embedder_dims: cfg.dims,
      }),
    });
    if (!res.ok) {
      throw new Error(`初始化记忆失败：HTTP ${res.status}`);
    }
    return await res.json() as MemoryListResponse;
  };

  const isExpectedMemoryBackend = (data: MemoryListResponse) => {
    if (!activeProvider) return true;
    const expectedCollection = collectionName(activeProvider.model, activeProvider.dims);
    return (
      data.collection === expectedCollection &&
      data.embedder_model === activeProvider.model &&
      data.embedder_base_url === activeProvider.baseUrl &&
      Number(data.embedder_dims ?? 0) === Number(activeProvider.dims ?? 0)
    );
  };

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/memory`);
      if (res.ok) {
        let data = await res.json() as MemoryListResponse;
        if (activeProvider && (!data.initialized || !isExpectedMemoryBackend(data))) {
          await reinit(activeProvider);
          const res2 = await fetch(`${API}/memory`);
          if (res2.ok) {
            data = await res2.json() as MemoryListResponse;
          }
        }
        setInitialized(Boolean(data.initialized));
        setActiveCollection(data.collection ?? null);
        setMemories(data.memories ?? []);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [activeProvider?.model, activeProvider?.baseUrl, activeProvider?.dims]);

  const deleteOne = async (id: string) => {
    await fetch(`${API}/memory/${id}`, { method: "DELETE" });
    setMemories((prev) => prev.filter((m) => m.id !== id));
    setSearchResults((prev) => prev ? prev.filter((m) => m.id !== id) : null);
  };

  const clearAll = async () => {
    if (!confirm("确定清空当前模型的所有记忆？")) return;
    await fetch(`${API}/memory`, { method: "DELETE" });
    setMemories([]);
    setSearchResults(null);
  };

  const doSearch = async () => {
    if (!searchQ.trim()) { setSearchResults(null); return; }
    const res = await fetch(`${API}/memory/search?q=${encodeURIComponent(searchQ)}`);
    if (res.ok) {
      const data = await res.json();
      setSearchResults(data.memories ?? []);
    }
  };

  const displayList = searchResults ?? memories;

  return (
    <div className="space-y-5">
      <SectionTitle>记忆管理</SectionTitle>

      {/* 当前模型标识 */}
      {activeProvider && (
        <div
          className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl"
          style={{ background: "rgba(0,0,0,0.03)", border: "0.5px solid rgba(0,0,0,0.07)" }}
        >
          <Database size={14} style={{ color: "var(--t3)", flexShrink: 0 }} />
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            <span className="text-[13px]" style={{ color: "var(--t3)" }}>当前模型</span>
            <span
              className="text-[13px] font-medium px-1.5 py-0.5 rounded-md truncate"
              style={{ background: "rgba(0,0,0,0.05)", color: "var(--t1)", fontFamily: "var(--font-mono)" }}
            >
              {activeProvider.model}
            </span>
          </div>
          <span className="text-[12px] shrink-0" style={{ color: "var(--t3)" }}>
            collection: {activeCollection ?? collectionName(activeProvider.model, activeProvider.dims)}
          </span>
        </div>
      )}

      {/* 未初始化提示 */}
      {initialized === false && (
        <div
          className="rounded-xl p-4 text-[14px]"
          style={{ background: "rgba(255,149,0,0.08)", border: "0.5px solid rgba(255,149,0,0.2)" }}
        >
          <div className="flex items-start gap-2">
            <Brain size={16} style={{ color: "#f59e0b", marginTop: 1, flexShrink: 0 }} />
            <div>
              <p className="font-medium mb-1" style={{ color: "var(--t1)" }}>记忆系统未初始化</p>
              {!activeProvider ? (
                <p style={{ color: "var(--t2)" }}>
                  请先在 <strong>API Keys → Embedding 模型</strong> 中配置并激活一个 Embedding 接口。
                </p>
              ) : (
                <p style={{ color: "var(--t2)" }}>
                  Embedding 已配置（{activeProvider.model}），请确保 Qdrant 已启动：
                  <code className="ml-1 px-1 rounded" style={{ background: "rgba(0,0,0,0.06)" }}>
                    docker compose -f docker/docker-compose.yml up -d qdrant
                  </code>
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 搜索栏 */}
      <div className="flex gap-2">
        <div
          className="flex-1 flex items-center gap-2 px-3 rounded-xl"
          style={{ background: "rgba(0,0,0,0.04)", border: "0.5px solid rgba(0,0,0,0.08)", height: 36 }}
        >
          <Search size={14} style={{ color: "var(--t3)", flexShrink: 0 }} />
          <input
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && doSearch()}
            placeholder="搜索记忆…"
            className="flex-1 bg-transparent outline-none text-[14px]"
            style={{ color: "var(--t1)" }}
          />
        </div>
        <button
          onClick={doSearch}
          className="px-3 rounded-xl text-[14px] font-medium"
          style={{ background: "var(--accent)", color: "#fff", height: 36 }}
        >
          搜索
        </button>
        {searchResults && (
          <button
            onClick={() => { setSearchResults(null); setSearchQ(""); }}
            className="px-3 rounded-xl text-[14px]"
            style={{ background: "rgba(0,0,0,0.06)", color: "var(--t2)", height: 36 }}
          >
            清除
          </button>
        )}
      </div>

      {/* 操作栏 */}
      <div className="flex items-center justify-between">
        <span className="text-[14px]" style={{ color: "var(--t3)" }}>
          {searchResults ? `搜索到 ${searchResults.length} 条` : `共 ${memories.length} 条记忆`}
        </span>
        <div className="flex gap-2">
          <button
            onClick={load}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[14px]"
            style={{ background: "rgba(0,0,0,0.04)", color: "var(--t2)", border: "0.5px solid rgba(0,0,0,0.08)" }}
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> 刷新
          </button>
          {memories.length > 0 && (
            <button
              onClick={clearAll}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[14px]"
              style={{ background: "rgba(255,59,48,0.08)", color: "var(--red, #ef4444)", border: "0.5px solid rgba(255,59,48,0.15)" }}
            >
              <Trash2 size={13} /> 清空全部
            </button>
          )}
        </div>
      </div>

      {/* 记忆列表 */}
      {displayList.length === 0 ? (
        <div
          className="rounded-xl p-8 text-center"
          style={{ background: "rgba(0,0,0,0.02)", border: "0.5px solid rgba(0,0,0,0.07)" }}
        >
          <Brain size={32} style={{ color: "var(--t3)", margin: "0 auto 12px" }} />
          <p className="text-[14px]" style={{ color: "var(--t3)" }}>
            {searchResults ? "没有匹配的记忆" : "暂无记忆，开始对话后会自动记录"}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {displayList.map((m) => (
            <div
              key={m.id}
              className="group flex items-start gap-3 px-4 py-3 rounded-xl"
              style={{ background: "rgba(0,0,0,0.02)", border: "0.5px solid rgba(0,0,0,0.07)" }}
            >
              <div className="flex-1 min-w-0">
                <p className="text-[14px] leading-relaxed" style={{ color: "var(--t1)" }}>
                  {m.memory}
                </p>
                {m.score !== undefined && (
                  <p className="text-[12px] mt-1" style={{ color: "var(--t3)" }}>
                    相关度: {(m.score * 100).toFixed(0)}%
                  </p>
                )}
                {m.created_at && (
                  <p className="text-[12px] mt-0.5" style={{ color: "var(--t3)" }}>
                    {new Date(m.created_at).toLocaleString("zh-CN")}
                  </p>
                )}
              </div>
              <button
                onClick={() => deleteOne(m.id)}
                className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 p-1 rounded-lg"
                style={{ color: "var(--t3)" }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.background = "rgba(255,59,48,0.1)";
                  (e.currentTarget as HTMLElement).style.color = "var(--red, #ef4444)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.background = "transparent";
                  (e.currentTarget as HTMLElement).style.color = "var(--t3)";
                }}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
