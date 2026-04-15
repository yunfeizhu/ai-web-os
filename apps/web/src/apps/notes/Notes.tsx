"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { FilePlus2, Save, Sparkles, Wand2 } from "lucide-react";

import { apiFetch, completeOnce } from "@/lib/backend";

interface NoteEntry {
  id: string;
  name: string;
  path: string;
  kind: "file" | "dir";
}

export function Notes() {
  const [notes, setNotes] = useState<NoteEntry[]>([]);
  const [activePath, setActivePath] = useState<string>("/Notes/Untitled.md");
  const [titleInput, setTitleInput] = useState("Untitled");
  const [content, setContent] = useState("");
  const [draftDirty, setDraftDirty] = useState(false);
  const [loading, setLoading] = useState(false);
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [suggestion, setSuggestion] = useState("");

  const loadNotes = async () => {
    const data = await apiFetch<{ entries: NoteEntry[] }>(
      "/files?path=/Notes",
    );
    const markdownNotes = data.entries.filter(
      (entry) => entry.kind === "file" && entry.name.endsWith(".md"),
    );
    setNotes(markdownNotes);
    if (!markdownNotes.some((entry) => entry.path === activePath) && markdownNotes[0]) {
      await openNote(markdownNotes[0].path);
    }
  };

  const openNote = async (path: string) => {
    const data = await apiFetch<{ content: string }>(
      `/files/content?path=${encodeURIComponent(path)}`,
    );
    setActivePath(path);
    setTitleInput(path.split("/").pop()?.replace(/\.md$/, "") || "Untitled");
    setContent(data.content);
    setSuggestion("");
    setDraftDirty(false);
  };

  useEffect(() => {
    loadNotes().catch(() => undefined);
  }, []);

  const createNote = async () => {
    const safeTitle = `${(titleInput || "Untitled").replace(/\.md$/, "")}.md`;
    const path = `/Notes/${safeTitle}`;
    await apiFetch("/files/content", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path,
        content: content || `# ${safeTitle.replace(/\.md$/, "")}\n`,
        mime_type: "text/markdown",
      }),
    });
    await loadNotes();
    await openNote(path);
  };

  const saveNote = async () => {
    setLoading(true);
    try {
      const safeTitle = `${(titleInput || "Untitled").replace(/\.md$/, "")}.md`;
      const nextPath = `/Notes/${safeTitle}`;
      await apiFetch("/files/content", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: nextPath,
          content,
          mime_type: "text/markdown",
        }),
      });
      setActivePath(nextPath);
      setDraftDirty(false);
      await loadNotes();
    } finally {
      setLoading(false);
    }
  };

  const runAssist = async (mode: "rewrite" | "expand" | "summarize") => {
    setAssistantBusy(true);
    try {
      const prompts = {
        rewrite: "请在不改变原意的前提下润色下面的 Markdown，保持结构与标题层级清晰。",
        expand: "请扩写下面的 Markdown 内容，补充必要细节，保持 Markdown 格式。",
        summarize: "请总结下面的 Markdown，输出一版精炼但保留结构的 Markdown。",
      };
      const data = await completeOnce(
        `${prompts[mode]}\n\n---\n\n${content}`,
        "你是一个专业的写作助手，只输出最终 Markdown，不要附加解释。",
      );
      setSuggestion(data.content);
    } finally {
      setAssistantBusy(false);
    }
  };

  return (
    <div className="flex h-full" style={{ color: "var(--t1)" }}>
      <aside
        className="flex w-[220px] shrink-0 flex-col border-r p-3"
        style={{ borderColor: "rgba(0,0,0,0.08)", background: "rgba(0,0,0,0.02)" }}
      >
        <div className="mb-3 flex items-center justify-between">
          <span className="text-[13px] font-medium" style={{ color: "var(--t2)" }}>
            Notes
          </span>
          <button
            onClick={createNote}
            className="rounded-lg px-2 py-1 text-[12px]"
            style={{ background: "rgba(0,0,0,0.05)" }}
          >
            <span className="inline-flex items-center gap-1">
              <FilePlus2 size={12} /> 新建
            </span>
          </button>
        </div>
        <div className="space-y-1 overflow-y-auto">
          {notes.map((note) => (
            <button
              key={note.id}
              onClick={() => openNote(note.path)}
              className="w-full rounded-lg px-2.5 py-2 text-left text-[13px]"
              style={{
                background: activePath === note.path ? "rgba(0,122,255,0.08)" : "transparent",
              }}
            >
              {note.name}
            </button>
          ))}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div
          className="flex items-center gap-2 border-b px-4 py-2"
          style={{ borderColor: "rgba(0,0,0,0.08)" }}
        >
          <input
            value={titleInput}
            onChange={(event) => setTitleInput(event.target.value)}
            className="w-[220px] rounded-lg px-3 py-1.5 text-[13px] outline-none"
            style={{ background: "rgba(0,0,0,0.04)" }}
          />
          <button
            onClick={saveNote}
            className="rounded-lg px-2.5 py-1.5 text-[13px]"
            style={{ background: "rgba(0,0,0,0.05)" }}
          >
            <span className="inline-flex items-center gap-1.5">
              <Save size={13} /> {loading ? "保存中…" : "保存"}
            </span>
          </button>
          <div className="ml-auto flex items-center gap-2">
            <AssistButton
              label="润色"
              busy={assistantBusy}
              onClick={() => runAssist("rewrite")}
            />
            <AssistButton
              label="扩写"
              busy={assistantBusy}
              onClick={() => runAssist("expand")}
            />
            <AssistButton
              label="总结"
              busy={assistantBusy}
              onClick={() => runAssist("summarize")}
            />
          </div>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-2">
          <div className="flex min-h-0 flex-col border-r" style={{ borderColor: "rgba(0,0,0,0.08)" }}>
            <textarea
              value={content}
              onChange={(event) => {
                setContent(event.target.value);
                setDraftDirty(true);
              }}
              className="min-h-0 flex-1 resize-none px-4 py-4 text-[14px] leading-relaxed outline-none"
              style={{ background: "transparent" }}
            />
            <div
              className="border-t px-4 py-2 text-[12px]"
              style={{ borderColor: "rgba(0,0,0,0.08)", color: "var(--t3)" }}
            >
              {draftDirty ? "未保存更改" : "已保存"}
            </div>
          </div>

          <div className="grid min-h-0 grid-rows-[1fr_auto]">
            <div className="min-h-0 overflow-y-auto px-5 py-4">
              <div className="prose prose-sm max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
              </div>
            </div>

            {suggestion && (
              <div
                className="border-t px-4 py-3"
                style={{ borderColor: "rgba(0,0,0,0.08)", background: "rgba(0,122,255,0.04)" }}
              >
                <div className="mb-2 flex items-center gap-2 text-[13px] font-medium">
                  <Sparkles size={14} /> AI 建议
                </div>
                <div className="max-h-[180px] overflow-y-auto rounded-xl bg-white/80 p-3 text-[13px] leading-relaxed">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{suggestion}</ReactMarkdown>
                </div>
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => {
                      setContent(suggestion);
                      setDraftDirty(true);
                    }}
                    className="rounded-lg px-2.5 py-1.5 text-[13px]"
                    style={{ background: "rgba(0,0,0,0.05)" }}
                  >
                    替换正文
                  </button>
                  <button
                    onClick={() => {
                      setContent((prev) => `${prev}\n\n${suggestion}`);
                      setDraftDirty(true);
                    }}
                    className="rounded-lg px-2.5 py-1.5 text-[13px]"
                    style={{ background: "rgba(0,0,0,0.05)" }}
                  >
                    追加到末尾
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function AssistButton({
  label,
  busy,
  onClick,
}: {
  label: string;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="rounded-lg px-2.5 py-1.5 text-[13px]"
      style={{
        background: "rgba(0,0,0,0.05)",
        opacity: busy ? 0.6 : 1,
      }}
    >
      <span className="inline-flex items-center gap-1.5">
        <Wand2 size={13} /> {label}
      </span>
    </button>
  );
}
