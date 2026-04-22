"use client";

import { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  Database,
  FileText,
  Search,
  Trash2,
  Upload,
  Plus,
  X,
  RefreshCw,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { SectionTitle } from "./Settings";
import { useSettingsStore } from "@/stores/settingsStore";
import { API_BASE } from "@/lib/backend";

const API = `${API_BASE}/knowledge`;

interface KBDocument {
  id: string;
  title: string;
  source_type: "text" | "file";
  source_url: string | null;
  chunk_count: number;
  status: "pending" | "processing" | "done" | "error";
  error_msg: string | null;
  created_at: string;
}

interface SearchResult {
  content: string;
  title: string;
  doc_id: string;
  score: number;
}

export function KnowledgeBase() {
  const { embeddingConfig: activeProvider } = useSettingsStore();

  const [initialized, setInitialized] = useState<boolean | null>(null);
  const [documents, setDocuments] = useState<KBDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [initing, setIniting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const showError = (msg: string) => {
    setErrorMsg(msg);
    setTimeout(() => setErrorMsg(null), 4000);
  };

  // 粘贴文本 modal
  const [showPasteModal, setShowPasteModal] = useState(false);
  const [pasteTitle, setPasteTitle] = useState("");
  const [pasteContent, setPasteContent] = useState("");
  const [pasting, setPasting] = useState(false);

  // 搜索
  const [searchQ, setSearchQ] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(
    null,
  );
  const [searching, setSearching] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── 加载状态与文档 ────────────────────────────────────────────────────────

  const loadStatus = async () => {
    try {
      const res = await fetch(`${API}/status`);
      if (res.ok) {
        const data = await res.json();
        setInitialized(data.initialized);
      }
    } catch {}
  };

  const loadDocuments = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/documents`);
      if (res.ok) setDocuments(await res.json());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStatus().then(() => loadDocuments());
  }, []);

  // 有 pending/processing 文档时每 15s 轮询
  useEffect(() => {
    const hasPending = documents.some(
      (d) => d.status === "pending" || d.status === "processing",
    );
    if (!hasPending) return;
    const timer = setInterval(() => loadDocuments(), 15000);
    return () => clearInterval(timer);
  }, [documents]);

  // ── 初始化知识库 ──────────────────────────────────────────────────────────

  const initKB = async () => {
    if (!activeProvider) return;
    setIniting(true);
    try {
      await fetch(`${API}/init`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          embedder_model: activeProvider.model,
          embedder_api_key: activeProvider.apiKey,
          embedder_base_url: activeProvider.baseUrl,
        }),
      });
      await loadStatus();
    } finally {
      setIniting(false);
    }
  };

  // ── 文件上传 ──────────────────────────────────────────────────────────────

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`${API}/documents/upload`, {
        method: "POST",
        body: form,
      });
      if (res.ok) await loadDocuments();
      else {
        const err = await res.json().catch(() => ({ detail: "上传失败" }));
        showError(err.detail ?? "上传失败");
      }
    } finally {
      setUploading(false);
    }
  };

  // ── 粘贴文本 ──────────────────────────────────────────────────────────────

  const handlePasteSubmit = async () => {
    if (!pasteTitle.trim() || !pasteContent.trim()) return;
    setPasting(true);
    try {
      const res = await fetch(`${API}/documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: pasteTitle.trim(),
          content: pasteContent.trim(),
        }),
      });
      if (res.ok) {
        setShowPasteModal(false);
        setPasteTitle("");
        setPasteContent("");
        await loadDocuments();
      } else {
        const err = await res.json().catch(() => ({ detail: "添加失败" }));
        showError(err.detail ?? "添加失败");
      }
    } finally {
      setPasting(false);
    }
  };

  // ── 删除文档 ──────────────────────────────────────────────────────────────

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const deleteDocument = async (id: string) => {
    await fetch(`${API}/documents/${id}`, { method: "DELETE" });
    setDocuments((prev) => prev.filter((d) => d.id !== id));
    setSearchResults((prev) =>
      prev ? prev.filter((r) => r.doc_id !== id) : null,
    );
    setConfirmDeleteId(null);
  };

  // ── 搜索 ──────────────────────────────────────────────────────────────────

  const doSearch = async () => {
    if (!searchQ.trim()) {
      setSearchResults(null);
      return;
    }
    setSearching(true);
    try {
      const res = await fetch(
        `${API}/search?q=${encodeURIComponent(searchQ)}&limit=5`,
      );
      if (res.ok) {
        const data = await res.json();
        setSearchResults(data.results ?? []);
      }
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="space-y-5">
      <SectionTitle>知识库</SectionTitle>

      {/* 当前 Embedding 模型 */}
      {activeProvider && (
        <div
          className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl"
          style={{
            background: "var(--panel-bg)",
            border: "0.5px solid var(--border)",
          }}
        >
          <Database size={14} style={{ color: "var(--t3)", flexShrink: 0 }} />
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            <span className="text-[13px]" style={{ color: "var(--t3)" }}>
              Embedding
            </span>
            <span
              className="text-[13px] font-medium px-1.5 py-0.5 rounded-md truncate"
              style={{
                background: "var(--control-bg)",
                color: "var(--t1)",
                fontFamily: "var(--font-mono)",
              }}
            >
              {activeProvider.model}
            </span>
          </div>
          <span className="text-[12px] shrink-0" style={{ color: "var(--t3)" }}>
            collection: ai_os_kb_default
          </span>
        </div>
      )}

      {/* 未初始化提示 */}
      {initialized === false && (
        <div
          className="rounded-xl p-4"
          style={{
            background: "rgba(255,149,0,0.08)",
            border: "0.5px solid rgba(255,149,0,0.2)",
          }}
        >
          <div className="flex items-start gap-2">
            <BookOpen
              size={16}
              style={{ color: "#f59e0b", marginTop: 1, flexShrink: 0 }}
            />
            <div className="flex-1">
              <p
                className="text-[14px] font-medium mb-1"
                style={{ color: "var(--t1)" }}
              >
                知识库未初始化
              </p>
              {!activeProvider ? (
                <p className="text-[14px]" style={{ color: "var(--t2)" }}>
                  请先在 <strong>API Keys → Embedding 模型</strong>{" "}
                  中配置并激活一个 Embedding 接口。
                </p>
              ) : (
                <div className="flex items-center gap-3 mt-2">
                  <p className="text-[14px]" style={{ color: "var(--t2)" }}>
                    已配置 Embedding（{activeProvider.model}
                    ），点击初始化知识库。
                  </p>
                  <button
                    onClick={initKB}
                    disabled={initing}
                    className="shrink-0 px-3 py-1.5 rounded-lg text-[13px] font-medium"
                    style={{
                      background: "var(--accent)",
                      color: "#fff",
                      opacity: initing ? 0.6 : 1,
                    }}
                  >
                    {initing ? "初始化中…" : "初始化知识库"}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 操作栏（已初始化时才显示） */}
      {initialized && (
        <div className="flex gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.md,.pdf,.docx"
            className="hidden"
            onChange={handleFileUpload}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[14px] font-medium"
            style={{
              background: "rgba(0,0,0,0.04)",
              color: "var(--t1)",
              border: "0.5px solid rgba(0,0,0,0.08)",
              opacity: uploading ? 0.6 : 1,
            }}
          >
            {uploading ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Upload size={13} />
            )}
            {uploading ? "上传中…" : "上传文件"}
          </button>
          <button
            onClick={() => setShowPasteModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[14px] font-medium"
            style={{
              background: "rgba(0,0,0,0.04)",
              color: "var(--t1)",
              border: "0.5px solid rgba(0,0,0,0.08)",
            }}
          >
            <Plus size={13} /> 粘贴文本
          </button>
          <div className="flex-1" />
          <button
            onClick={loadDocuments}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[14px]"
            style={{
              background: "rgba(0,0,0,0.04)",
              color: "var(--t2)",
              border: "0.5px solid rgba(0,0,0,0.08)",
            }}
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      )}

      {/* 错误提示 */}
      {errorMsg && (
        <div
          className="px-4 py-2.5 rounded-xl text-[13px]"
          style={{
            background: "rgba(255,59,48,0.08)",
            border: "0.5px solid rgba(255,59,48,0.2)",
            color: "#FF3B30",
          }}
        >
          {errorMsg}
        </div>
      )}

      {/* 搜索栏 */}
      {initialized && (
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
              onKeyDown={(e) => e.key === "Enter" && !searching && doSearch()}
              placeholder="测试知识库检索…"
              className="flex-1 bg-transparent outline-none text-[14px]"
              style={{ color: "var(--t1)" }}
            />
          </div>
          <button
            onClick={doSearch}
            disabled={searching}
            className="flex items-center gap-1.5 px-3 rounded-xl text-[14px] font-medium"
            style={{
              background: "var(--accent)",
              color: "#fff",
              height: 36,
              opacity: searching ? 0.7 : 1,
            }}
          >
            {searching && <Loader2 size={13} className="animate-spin" />}
            {searching ? "检索中…" : "检索"}
          </button>
          {searchResults && (
            <button
              onClick={() => {
                setSearchResults(null);
                setSearchQ("");
              }}
              className="px-3 rounded-xl text-[14px]"
              style={{
                background: "var(--control-bg)",
                color: "var(--t2)",
                height: 36,
              }}
            >
              清除
            </button>
          )}
        </div>
      )}

      {/* 检索结果 */}
      {searchResults && (
        <div className="space-y-2">
          <p className="text-[13px]" style={{ color: "var(--t3)" }}>
            检索到 {searchResults.length} 个片段
          </p>
          {searchResults.length === 0 ? (
            <div
              className="rounded-xl p-4 text-center text-[14px]"
              style={{
                background: "rgba(0,0,0,0.02)",
                border: "0.5px solid rgba(0,0,0,0.07)",
                color: "var(--t3)",
              }}
            >
              未找到相关内容
            </div>
          ) : (
            searchResults.map((r, i) => (
              <div
                key={i}
                className="rounded-xl px-4 py-3 space-y-1"
                style={{
                  background: "rgba(0,122,255,0.04)",
                  border: "0.5px solid rgba(0,122,255,0.12)",
                }}
              >
                <div className="flex items-center justify-between">
                  <span
                    className="text-[13px] font-medium"
                    style={{ color: "var(--accent)" }}
                  >
                    {r.title}
                  </span>
                  <span className="text-[12px]" style={{ color: "var(--t3)" }}>
                    相关度 {(r.score * 100).toFixed(0)}%
                  </span>
                </div>
                <p
                  className="text-[13px] leading-relaxed"
                  style={{ color: "var(--t2)" }}
                >
                  {r.content}
                </p>
              </div>
            ))
          )}
        </div>
      )}

      {/* 文档列表 */}
      {!searchResults && (
        <>
          <div className="flex items-center justify-between">
            <span className="text-[14px]" style={{ color: "var(--t3)" }}>
              共 {documents.length} 个文档
            </span>
          </div>

          {documents.length === 0 ? (
            <div
              className="rounded-xl p-8 text-center"
              style={{
                background: "rgba(0,0,0,0.02)",
                border: "0.5px solid rgba(0,0,0,0.07)",
              }}
            >
              <BookOpen
                size={32}
                style={{ color: "var(--t3)", margin: "0 auto 12px" }}
              />
              <p className="text-[14px]" style={{ color: "var(--t3)" }}>
                {initialized
                  ? "暂无文档，上传文件或粘贴文本开始构建知识库"
                  : "初始化知识库后可添加文档"}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {documents.map((doc) => (
                <div
                  key={doc.id}
                  className="group flex items-center gap-3 px-4 py-3 rounded-xl"
                  style={{
                    background: "rgba(0,0,0,0.02)",
                    border: "0.5px solid rgba(0,0,0,0.07)",
                  }}
                >
                  <FileText
                    size={16}
                    style={{ color: "var(--t3)", flexShrink: 0 }}
                  />
                  <div className="flex-1 min-w-0">
                    <p
                      className="text-[14px] font-medium truncate"
                      style={{ color: "var(--t1)" }}
                    >
                      {doc.title}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span
                        className="text-[11px] px-1.5 py-0.5 rounded-md"
                        style={{
                          background:
                            doc.source_type === "file"
                              ? "rgba(0,122,255,0.08)"
                              : "rgba(52,199,89,0.08)",
                          color:
                            doc.source_type === "file" ? "#007AFF" : "#34C759",
                        }}
                      >
                        {doc.source_type === "file" ? "文件" : "文本"}
                      </span>
                      {doc.status === "pending" ||
                      doc.status === "processing" ? (
                        <span
                          className="flex items-center gap-1 text-[12px]"
                          style={{ color: "#FF9F0A" }}
                        >
                          <Loader2 size={11} className="animate-spin" />
                          {doc.status === "pending" ? "等待处理" : "向量化中…"}
                        </span>
                      ) : doc.status === "error" ? (
                        <span
                          className="flex items-center gap-1 text-[12px]"
                          style={{ color: "#FF3B30" }}
                          title={doc.error_msg ?? ""}
                        >
                          <AlertCircle size={11} />
                          处理失败
                        </span>
                      ) : (
                        <span
                          className="text-[12px]"
                          style={{ color: "var(--t3)" }}
                        >
                          {doc.chunk_count} 个片段
                        </span>
                      )}
                      <span
                        className="text-[12px]"
                        style={{ color: "var(--t3)" }}
                      >
                        {new Date(doc.created_at).toLocaleDateString("zh-CN")}
                      </span>
                    </div>
                  </div>
                  {confirmDeleteId === doc.id ? (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => deleteDocument(doc.id)}
                        className="px-2 py-0.5 rounded-lg text-[12px] font-medium"
                        style={{
                          background: "rgba(255,59,48,0.12)",
                          color: "#FF3B30",
                        }}
                      >
                        删除
                      </button>
                      <button
                        onClick={() => setConfirmDeleteId(null)}
                        className="px-2 py-0.5 rounded-lg text-[12px]"
                        style={{
                          background: "rgba(0,0,0,0.06)",
                          color: "var(--t2)",
                        }}
                      >
                        取消
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmDeleteId(doc.id)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 p-1 rounded-lg"
                      style={{ color: "var(--t3)" }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLElement).style.background =
                          "rgba(255,59,48,0.1)";
                        (e.currentTarget as HTMLElement).style.color =
                          "var(--red, #ef4444)";
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLElement).style.background =
                          "transparent";
                        (e.currentTarget as HTMLElement).style.color =
                          "var(--t3)";
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* 粘贴文本 Modal */}
      {showPasteModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.3)" }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowPasteModal(false);
          }}
        >
          <div
            className="w-full max-w-lg rounded-2xl p-5 space-y-4"
            style={{
              background: "var(--bg, #fff)",
              boxShadow: "0 20px 60px rgba(0,0,0,0.15)",
            }}
          >
            <div className="flex items-center justify-between">
              <h3
                className="text-[16px] font-semibold"
                style={{ color: "var(--t1)" }}
              >
                粘贴文本
              </h3>
              <button
                onClick={() => setShowPasteModal(false)}
                className="p-1 rounded-lg"
                style={{ color: "var(--t3)" }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = "rgba(0,0,0,0.06)")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background = "transparent")
                }
              >
                <X size={16} />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label
                  className="text-[13px] font-medium block mb-1"
                  style={{ color: "var(--t2)" }}
                >
                  标题
                </label>
                <input
                  value={pasteTitle}
                  onChange={(e) => setPasteTitle(e.target.value)}
                  placeholder="文档标题"
                  className="w-full px-3 py-2 rounded-xl text-[14px] outline-none"
                  style={{
                    background: "rgba(0,0,0,0.04)",
                    border: "0.5px solid rgba(0,0,0,0.1)",
                    color: "var(--t1)",
                  }}
                />
              </div>
              <div>
                <label
                  className="text-[13px] font-medium block mb-1"
                  style={{ color: "var(--t2)" }}
                >
                  内容
                </label>
                <textarea
                  value={pasteContent}
                  onChange={(e) => setPasteContent(e.target.value)}
                  placeholder="粘贴文本内容…"
                  rows={8}
                  className="w-full px-3 py-2 rounded-xl text-[14px] outline-none resize-none"
                  style={{
                    background: "rgba(0,0,0,0.04)",
                    border: "0.5px solid rgba(0,0,0,0.1)",
                    color: "var(--t1)",
                  }}
                />
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowPasteModal(false)}
                className="px-4 py-2 rounded-xl text-[14px]"
                style={{ background: "rgba(0,0,0,0.06)", color: "var(--t2)" }}
              >
                取消
              </button>
              <button
                onClick={handlePasteSubmit}
                disabled={!pasteTitle.trim() || !pasteContent.trim() || pasting}
                className="px-4 py-2 rounded-xl text-[14px] font-medium"
                style={{
                  background:
                    pasteTitle.trim() && pasteContent.trim() && !pasting
                      ? "var(--accent)"
                      : "rgba(0,0,0,0.06)",
                  color:
                    pasteTitle.trim() && pasteContent.trim() && !pasting
                      ? "#fff"
                      : "var(--t3)",
                }}
              >
                {pasting ? "添加中…" : "添加到知识库"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
