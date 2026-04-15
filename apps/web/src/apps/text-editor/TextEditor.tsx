"use client";

import { useEffect, useMemo, useState } from "react";
import { Save } from "lucide-react";

import { apiFetch } from "@/lib/backend";
import { invalidateFileTextCache, loadFileText } from "@/lib/file-text-cache";

interface TextEditorProps {
  appState?: Record<string, unknown>;
  windowId: string;
}

export function TextEditor({ appState }: TextEditorProps) {
  const filePath = typeof appState?.filePath === "string" ? appState.filePath : "";
  const fileName = useMemo(() => filePath.split("/").filter(Boolean).at(-1) ?? "Untitled.txt", [filePath]);

  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draftDirty, setDraftDirty] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");

  useEffect(() => {
    if (!filePath) {
      setContent("");
      setDraftDirty(false);
      setStatusMessage("未指定要打开的文本文件");
      return;
    }

    let cancelled = false;

    setLoading(true);
    setStatusMessage("");

    loadFileText(filePath)
      .then((nextContent) => {
        if (cancelled) return;
        setContent(nextContent);
        setDraftDirty(false);
      })
      .catch(() => {
        if (cancelled) return;
        setContent("");
        setStatusMessage("文件加载失败");
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [filePath]);

  const saveFile = async () => {
    if (!filePath) return;
    setSaving(true);
    setStatusMessage("");
    try {
      await apiFetch("/files/content", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: filePath,
          content,
          mime_type: "text/plain",
        }),
      });
      invalidateFileTextCache(filePath);
      setDraftDirty(false);
      setStatusMessage("已保存");
    } catch {
      setStatusMessage("保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-full min-w-0 flex-col" style={{ color: "var(--t1)" }}>
      <div
        className="flex items-center gap-3 border-b px-4 py-2"
        style={{ borderColor: "rgba(0,0,0,0.08)" }}
      >
        <div className="min-w-0">
          <div className="truncate text-[14px] font-medium">{fileName}</div>
          <div className="truncate text-[12px]" style={{ color: "var(--t3)" }}>
            {filePath || "未指定文件路径"}
          </div>
        </div>

        <div className="ml-auto flex items-center gap-3">
          <span className="text-[12px]" style={{ color: "var(--t3)" }}>
            {!filePath ? "未打开文件" : loading ? "加载中…" : saving ? "保存中…" : draftDirty ? "未保存更改" : "已保存"}
          </span>
          <button
            onClick={() => {
              void saveFile();
            }}
            disabled={!filePath || saving || loading || !draftDirty}
            className="rounded-lg px-2.5 py-1.5 text-[13px]"
            style={{
              background: "rgba(0,0,0,0.05)",
              opacity: !filePath || saving || loading || !draftDirty ? 0.5 : 1,
            }}
          >
            <span className="inline-flex items-center gap-1.5">
              <Save size={13} /> {saving ? "保存中…" : "保存"}
            </span>
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <textarea
          value={content}
          disabled={!filePath || loading}
          onChange={(event) => {
            setContent(event.target.value);
            setDraftDirty(true);
            setStatusMessage("");
          }}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
              event.preventDefault();
              void saveFile();
            }
          }}
          spellCheck={false}
          className="min-h-0 flex-1 resize-none px-5 py-4 text-[14px] leading-relaxed outline-none"
          style={{
            background: "linear-gradient(180deg, rgba(255,255,255,0.94), rgba(248,250,252,0.98))",
            color: "#0f172a",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace",
          }}
        />

        <div
          className="flex items-center justify-between border-t px-4 py-2 text-[12px]"
          style={{ borderColor: "rgba(0,0,0,0.08)", color: "var(--t3)" }}
        >
          <span>{statusMessage || "支持 Ctrl/Cmd + S 快捷保存"}</span>
          <span>{content.length} 字符</span>
        </div>
      </div>
    </div>
  );
}
