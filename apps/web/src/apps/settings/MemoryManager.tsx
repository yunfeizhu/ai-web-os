"use client";

import { useEffect, useState } from "react";
import { Trash2, RefreshCw, Search, Brain, FileText, Sparkles } from "lucide-react";
import { SectionTitle } from "./Settings";
import { API_BASE } from "@/lib/backend";

const API = API_BASE;

interface Memory {
  id: string;
  memory: string;
  kind?: string;
  sourcePath?: string;
  line?: number;
  status?: string;
  created_at?: string;
  score?: number;
}

interface MemoryListResponse {
  memories?: Memory[];
  candidates?: Memory[];
  initialized?: boolean;
  backend?: string | null;
  collection?: string | null;
  memory_file?: string | null;
  daily_dir?: string | null;
}

interface DreamingStatusResponse {
  short_term_entries?: number;
  pending_candidates?: number;
  runtime?: {
    enabled?: boolean;
    interval_seconds?: number;
    scheduler?: {
      lastRunAt?: string;
      lastResult?: {
        promoted?: number;
        skipped?: number;
        duplicate?: number;
      };
    };
  };
  phase_signals?: {
    light?: { candidates?: number };
    deep?: { promoted?: number; skipped?: number; duplicate?: number };
  };
}

function formatDateTime(value?: string) {
  if (!value) return "尚未运行";
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) return "尚未运行";
  return time.toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function MemoryManager() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [pendingNotes, setPendingNotes] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(false);
  const [consolidating, setConsolidating] = useState(false);
  const [initialized, setInitialized] = useState<boolean | null>(null);
  const [memoryFile, setMemoryFile] = useState<string | null>(null);
  const [dailyDir, setDailyDir] = useState<string | null>(null);
  const [searchQ, setSearchQ] = useState("");
  const [searchResults, setSearchResults] = useState<Memory[] | null>(null);
  const [dreaming, setDreaming] = useState<DreamingStatusResponse | null>(null);
  const [dreamingBusy, setDreamingBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [res, notesRes, dreamingRes] = await Promise.all([
        fetch(`${API}/memory`),
        fetch(`${API}/memory/candidates`),
        fetch(`${API}/memory/dreaming/status`),
      ]);
      if (res.ok) {
        const data = await res.json() as MemoryListResponse;
        setInitialized(Boolean(data.initialized));
        setMemoryFile(data.memory_file ?? null);
        setDailyDir(data.daily_dir ?? null);
        setMemories(data.memories ?? []);
      }
      if (notesRes.ok) {
        const data = await notesRes.json() as MemoryListResponse;
        setPendingNotes(data.candidates ?? []);
      }
      if (dreamingRes.ok) {
        const data = await dreamingRes.json() as DreamingStatusResponse;
        setDreaming(data);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const deleteOne = async (id: string) => {
    await fetch(`${API}/memory/${id}`, { method: "DELETE" });
    setMemories((prev) => prev.filter((m) => m.id !== id));
    setSearchResults((prev) => prev ? prev.filter((m) => m.id !== id) : null);
  };

  const clearAll = async () => {
    if (!confirm("确定清空所有长期记忆？待整理笔记不会被删除。")) return;
    await fetch(`${API}/memory`, { method: "DELETE" });
    setMemories([]);
    setSearchResults(null);
  };

  const consolidate = async () => {
    setConsolidating(true);
    try {
      await fetch(`${API}/memory/consolidate`, { method: "POST" });
      await load();
      setSearchResults(null);
    } finally {
      setConsolidating(false);
    }
  };

  const runDreamingAction = async (path: string) => {
    setDreamingBusy(true);
    try {
      await fetch(`${API}${path}`, { method: "POST" });
      await load();
      setSearchResults(null);
    } finally {
      setDreamingBusy(false);
    }
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

      <div
        className="rounded-2xl p-4"
        style={{
          background: "linear-gradient(135deg, rgba(255,255,255,0.72), rgba(245,241,235,0.52))",
          border: "0.5px solid var(--border)",
        }}
      >
        <div className="flex items-start gap-3">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: "rgba(0,122,255,0.1)", color: "var(--accent)" }}
          >
            <FileText size={17} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[14px] font-semibold" style={{ color: "var(--t1)" }}>
                本地 Markdown 记忆
              </span>
            </div>
            <p className="text-[13px] mt-1 leading-relaxed" style={{ color: "var(--t2)" }}>
              这里只长期保留稳定的偏好、事实和项目决定。新信息会先进入待整理笔记，确认稳定后再写入长期记忆。
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-3">
              <div
                className="rounded-xl px-3 py-2"
                style={{ background: "rgba(0,122,255,0.06)", border: "0.5px solid rgba(0,122,255,0.12)" }}
              >
                <p className="text-[12px] font-medium" style={{ color: "var(--accent)" }}>近期上下文</p>
                <p className="text-[12px] mt-1 leading-relaxed" style={{ color: "var(--t3)" }}>
                  今日/昨日会自动参与新对话，适合“最近在玩/正在做”这类短期状态。
                </p>
              </div>
              <div
                className="rounded-xl px-3 py-2"
                style={{ background: "rgba(255,149,0,0.07)", border: "0.5px solid rgba(255,149,0,0.14)" }}
              >
                <p className="text-[12px] font-medium" style={{ color: "#b45309" }}>待整理候选 {pendingNotes.length}</p>
                <p className="text-[12px] mt-1 leading-relaxed" style={{ color: "var(--t3)" }}>
                  已发现但还没长期化；运行整理后会判断是否写入长期记忆。
                </p>
              </div>
              <div
                className="rounded-xl px-3 py-2"
                style={{ background: "rgba(52,199,89,0.07)", border: "0.5px solid rgba(52,199,89,0.14)" }}
              >
                <p className="text-[12px] font-medium" style={{ color: "#15803d" }}>长期记忆 {memories.length}</p>
                <p className="text-[12px] mt-1 leading-relaxed" style={{ color: "var(--t3)" }}>
                  已写入 MEMORY.md，通常是稳定事实、偏好和项目决定。
                </p>
              </div>
            </div>
            <div className="flex gap-2 mt-3 flex-wrap">
              <span className="text-[12px] px-2.5 py-1 rounded-lg" style={{ background: "rgba(0,122,255,0.08)", color: "var(--accent)" }}>
                今日/昨日自动参与召回
              </span>
              {memoryFile && (
                <span className="text-[12px] px-2.5 py-1 rounded-lg truncate max-w-full" style={{ background: "var(--control-bg)", color: "var(--t3)" }}>
                  {memoryFile}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div
        className="rounded-2xl p-4"
        style={{
          background: "linear-gradient(135deg, rgba(0,122,255,0.07), rgba(255,255,255,0.58))",
          border: "0.5px solid var(--border)",
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[14px] font-semibold" style={{ color: "var(--t1)" }}>
              记忆整理
            </p>
            <p className="text-[12px] mt-1 leading-relaxed" style={{ color: "var(--t2)" }}>
              把待整理笔记合并成长期记忆。默认手动运行；如果开启自动整理，系统会按设定间隔在后台处理。
            </p>
            <p className="text-[12px] mt-2 leading-relaxed" style={{ color: "var(--t3)" }}>
              回放历史只会把旧候选重新放入整理队列，不会直接写入长期记忆；撤回回放只移除这批回放候选。
            </p>
            <div className="flex gap-2 mt-3 flex-wrap">
              <span className="text-[12px] px-2.5 py-1 rounded-lg" style={{ background: "var(--control-bg)", color: "var(--t2)" }}>
                {dreaming?.runtime?.enabled ? "自动整理：开启" : "自动整理：关闭"}
              </span>
              <span className="text-[12px] px-2.5 py-1 rounded-lg" style={{ background: "var(--control-bg)", color: "var(--t2)" }}>
                短期候选 {dreaming?.short_term_entries ?? 0}
              </span>
              <span className="text-[12px] px-2.5 py-1 rounded-lg" style={{ background: "var(--control-bg)", color: "var(--t2)" }}>
                待确认 {dreaming?.pending_candidates ?? pendingNotes.length}
              </span>
              <span className="text-[12px] px-2.5 py-1 rounded-lg" style={{ background: "var(--control-bg)", color: "var(--t2)" }}>
                上次写入 {dreaming?.runtime?.scheduler?.lastResult?.promoted ?? dreaming?.phase_signals?.deep?.promoted ?? 0}
              </span>
              <span className="text-[12px] px-2.5 py-1 rounded-lg" style={{ background: "var(--control-bg)", color: "var(--t3)" }}>
                上次运行 {formatDateTime(dreaming?.runtime?.scheduler?.lastRunAt)}
              </span>
            </div>
          </div>
          <div className="flex gap-2 shrink-0 flex-wrap justify-end">
            <button
              onClick={() => runDreamingAction("/memory/dreaming/sweep")}
              className="px-3 py-1.5 rounded-xl text-[13px] font-medium"
              style={{ background: "var(--accent)", color: "#fff" }}
              disabled={dreamingBusy}
            >
              运行整理
            </button>
            <button
              onClick={() => runDreamingAction("/memory/backfill/stage")}
              className="px-3 py-1.5 rounded-xl text-[13px]"
              style={{ background: "var(--control-bg)", color: "var(--t2)", border: "0.5px solid var(--border)" }}
              disabled={dreamingBusy}
            >
              回放历史
            </button>
            <button
              onClick={() => runDreamingAction("/memory/backfill/rollback")}
              className="px-3 py-1.5 rounded-xl text-[13px]"
              style={{ background: "rgba(255,59,48,0.08)", color: "var(--red, #ef4444)", border: "0.5px solid rgba(255,59,48,0.16)" }}
              disabled={dreamingBusy}
            >
              撤回回放
            </button>
          </div>
        </div>
      </div>

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
              <p style={{ color: "var(--t2)" }}>
                本地 Markdown 记忆会自动初始化；如果一直未初始化，请刷新页面或重启后端服务。
              </p>
            </div>
          </div>
        </div>
      )}

      {/* 搜索栏 */}
      <div className="flex gap-2">
        <div
          className="flex-1 flex items-center gap-2 px-3 rounded-xl"
          style={{
            background: "var(--search-field-bg)",
            border: "0.5px solid var(--search-field-border)",
            height: 36,
          }}
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
            style={{ background: "var(--control-bg)", color: "var(--t2)", height: 36 }}
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
            style={{
              background: "var(--control-bg)",
              color: "var(--t2)",
              border: "0.5px solid var(--border)",
            }}
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
          {pendingNotes.length > 0 && (
            <button
              onClick={consolidate}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[14px]"
              style={{
                background: "rgba(0,122,255,0.08)",
                color: "var(--accent)",
                border: "0.5px solid rgba(0,122,255,0.16)",
              }}
            >
              <Sparkles size={13} className={consolidating ? "animate-spin" : ""} /> 整理笔记
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
            {searchResults
              ? "没有匹配的记忆"
              : pendingNotes.length > 0
                ? `暂无长期记忆，有 ${pendingNotes.length} 条待整理笔记`
                : "暂无长期记忆；明确要求记住的内容会先进入待整理笔记"}
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

      {pendingNotes.length > 0 && (
        <div
          className="rounded-2xl p-4"
          style={{ background: "rgba(255,149,0,0.06)", border: "0.5px solid rgba(255,149,0,0.18)" }}
        >
          <div className="flex items-center justify-between gap-3 mb-3">
            <div>
              <p className="text-[14px] font-medium" style={{ color: "var(--t1)" }}>待整理笔记</p>
              <p className="text-[12px] mt-0.5" style={{ color: "var(--t3)" }}>
                只收集明确要求长期保存的偏好、事实和项目决定。整理后才会进入长期记忆。{dailyDir ? `目录：${dailyDir}` : ""}
              </p>
            </div>
            <button
              onClick={consolidate}
              className="px-3 py-1.5 rounded-xl text-[13px] font-medium shrink-0"
              style={{ background: "var(--accent)", color: "#fff" }}
            >
              整理笔记
            </button>
          </div>
          <div className="space-y-2">
            {pendingNotes.slice(0, 5).map((candidate) => (
              <div
                key={candidate.id}
                className="px-3 py-2 rounded-xl text-[13px] leading-relaxed"
                style={{ background: "rgba(255,255,255,0.55)", color: "var(--t2)" }}
              >
                {candidate.memory}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
