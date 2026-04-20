"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  FilePlus2,
  Loader2,
  NotebookPen,
  Search,
  Sparkles,
  Wand2,
} from "lucide-react";

import { apiFetch, completeOnce } from "@/lib/backend";
import { useWindowStore } from "@/stores/windowStore";

interface NoteEntry {
  id: string;
  name: string;
  path: string;
  kind: "file" | "dir";
}

interface VisibleNoteEntry extends NoteEntry {
  isDraft?: boolean;
}

interface NotesProps {
  windowId: string;
}

type SaveState = "idle" | "saving" | "saved" | "error";

const NOTES_ROOT = "/Notes";
const NOTE_EXTENSION = ".md";

function sanitizeNoteTitle(value: string) {
  return (
    value
      .trim()
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "新笔记"
  );
}

function defaultNoteContent() {
  return "";
}

function inferPreview(markdown: string) {
  const plain = markdown
    .replace(/^#+\s+/gm, "")
    .replace(/\*\*|__|`|>|- /g, "")
    .replace(/\n+/g, " ")
    .trim();
  return plain || "还没有内容";
}

function buildUntitledName(notes: NoteEntry[]) {
  const existing = new Set(notes.map((item) => item.name.replace(/\.md$/, "")));
  if (!existing.has("新笔记")) return "新笔记";
  let index = 2;
  while (existing.has(`新笔记 ${index}`)) {
    index += 1;
  }
  return `新笔记 ${index}`;
}

function formatSavedTime(savedAt: Date | null) {
  if (!savedAt) {
    return "尚未保存";
  }

  const now = new Date();
  const isSameDay =
    now.getFullYear() === savedAt.getFullYear() &&
    now.getMonth() === savedAt.getMonth() &&
    now.getDate() === savedAt.getDate();

  const timeText = savedAt.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  return isSameDay ? `今天 ${timeText}` : savedAt.toLocaleString();
}

function cleanAssistantResult(result: string) {
  let next = result.trim();
  if (!next) {
    return "";
  }

  const promptPrefixPatterns = [
    /^标题：.*?\n+---\s*\n*/i,
    /^标题：.*?\n+/i,
    /^---\s*\n*/i,
  ];

  for (const pattern of promptPrefixPatterns) {
    next = next.replace(pattern, "").trimStart();
  }

  return next.trim();
}

export function Notes({ windowId }: NotesProps) {
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isHydratingRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const registerCloseGuard = useWindowStore((state) => state.registerCloseGuard);
  const unregisterCloseGuard = useWindowStore((state) => state.unregisterCloseGuard);

  const [notes, setNotes] = useState<NoteEntry[]>([]);
  const [noteSnippets, setNoteSnippets] = useState<Record<string, string>>({});
  const [noteActivity, setNoteActivity] = useState<Record<string, number>>({});
  const [activePath, setActivePath] = useState("");
  const [titleInput, setTitleInput] = useState("");
  const [content, setContent] = useState("");
  const [savedTitle, setSavedTitle] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [assistantMode, setAssistantMode] = useState<"rewrite" | "expand" | "summarize" | null>(
    null,
  );
  const [assistantError, setAssistantError] = useState("");
  const [assistantNotice, setAssistantNotice] = useState("");
  const [suggestion, setSuggestion] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);

  const activeEntry = useMemo(
    () => notes.find((note) => note.path === activePath) || null,
    [activePath, notes],
  );

  const currentTitle = titleInput.trim() || "新笔记";
  const currentPreview = useMemo(() => inferPreview(content), [content]);

  const isDirty = useMemo(
    () => titleInput !== savedTitle || content !== savedContent,
    [content, savedContent, savedTitle, titleInput],
  );

  const fetchNoteEntries = useCallback(async () => {
    const data = await apiFetch<{ entries: NoteEntry[] }>(
      `/files?path=${encodeURIComponent(NOTES_ROOT)}`,
    );
    return data.entries
      .filter((entry) => entry.kind === "file" && entry.name.endsWith(NOTE_EXTENSION))
      .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
  }, []);

  const persistCurrentNote = useCallback(
    async ({
      nextTitle = titleInput,
      nextContent = content,
      refreshList = true,
    }: {
      nextTitle?: string;
      nextContent?: string;
      refreshList?: boolean;
    } = {}) => {
      const trimmedTitle = nextTitle.trim() || buildUntitledName(notes);
      const safeFileName = `${sanitizeNoteTitle(trimmedTitle)}${NOTE_EXTENSION}`;

      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }

      setSaveState("saving");

      try {
        let nextPath = activePath || `${NOTES_ROOT}/${safeFileName}`;
        let nextEntry = activeEntry;
        const previousPath = activePath;

        if (nextEntry && nextEntry.name !== safeFileName) {
          nextEntry = await apiFetch<NoteEntry>(`/files/${nextEntry.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: safeFileName }),
          });
          nextPath = nextEntry.path;
        } else if (!nextEntry) {
          nextPath = `${NOTES_ROOT}/${safeFileName}`;
        }

        const nextBody = nextContent;

        await apiFetch("/files/content", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            path: nextPath,
            content: nextBody,
            mime_type: "text/markdown",
          }),
        });

        setActivePath(nextPath);
        setTitleInput(trimmedTitle);
        setContent(nextBody);
        setSavedTitle(trimmedTitle);
        setSavedContent(nextBody);
        setSaveState("saved");
        setLastSavedAt(new Date());
        setNoteActivity((prev) => {
          const timestamp = Date.now();
          const nextMap = { ...prev, [nextPath]: timestamp };
          if (previousPath && previousPath !== nextPath) {
            delete nextMap[previousPath];
          }
          return nextMap;
        });
        setNoteSnippets((prev) => {
          const nextMap = { ...prev, [nextPath]: inferPreview(nextBody) };
          if (previousPath && previousPath !== nextPath) {
            delete nextMap[previousPath];
          }
          return nextMap;
        });

        if (refreshList) {
          const markdownNotes = await fetchNoteEntries();
          setNotes(markdownNotes);
          setNoteSnippets((prev) => {
            const validPaths = new Set(markdownNotes.map((entry) => entry.path));
            return Object.fromEntries(
              Object.entries(prev).filter(([path]) => validPaths.has(path)),
            );
          });
        }

        return nextPath;
      } catch {
        setSaveState("error");
        return null;
      }
    },
    [activeEntry, activePath, content, fetchNoteEntries, notes, titleInput],
  );

  const openNote = useCallback(
    async (
      path: string,
      options?: {
        skipPersist?: boolean;
      },
    ) => {
      if (!options?.skipPersist && isDirty) {
        const persisted = await persistCurrentNote({ refreshList: false });
        if (!persisted) {
          return;
        }
      }

      setLoading(true);
      try {
        const data = await apiFetch<{ content: string }>(
          `/files/content?path=${encodeURIComponent(path)}`,
        );
        const nextTitle = path.split("/").pop()?.replace(/\.md$/, "") || "新笔记";
        const nextContent = data.content || defaultNoteContent();

        isHydratingRef.current = true;
        setActivePath(path);
        setTitleInput(nextTitle);
        setContent(nextContent);
        setSavedTitle(nextTitle);
        setSavedContent(nextContent);
        setSuggestion("");
        setSaveState("saved");
        setLastSavedAt(new Date());
        setNoteSnippets((prev) => ({
          ...prev,
          [path]: inferPreview(nextContent),
        }));
        isHydratingRef.current = false;
      } finally {
        setLoading(false);
      }
    },
    [isDirty, persistCurrentNote],
  );

  const loadNotes = useCallback(
    async (preferredPath?: string) => {
      const markdownNotes = await fetchNoteEntries();

      setNotes(markdownNotes);
      setNoteSnippets((prev) => {
        const validPaths = new Set(markdownNotes.map((entry) => entry.path));
        return Object.fromEntries(
          Object.entries(prev).filter(([path]) => validPaths.has(path)),
        );
      });

      const nextPath =
        preferredPath && markdownNotes.some((entry) => entry.path === preferredPath)
          ? preferredPath
          : markdownNotes[0]?.path;

      if (nextPath && nextPath !== activePath) {
        await openNote(nextPath, { skipPersist: true });
        return;
      }

      if (!nextPath && !activePath) {
        const untitled = buildUntitledName(markdownNotes);
        isHydratingRef.current = true;
        setTitleInput(untitled);
        setContent(defaultNoteContent());
        setSavedTitle("");
        setSavedContent("");
        setSaveState("idle");
        setLastSavedAt(null);
        isHydratingRef.current = false;
      }
    },
    [activePath, fetchNoteEntries, openNote],
  );

  const ensurePersistedBeforeClose = useCallback(async () => {
    if (!isDirty && saveState !== "saving") {
      return true;
    }
    const persisted = await persistCurrentNote({ refreshList: false });
    return Boolean(persisted || activePath);
  }, [activePath, isDirty, persistCurrentNote, saveState]);

  useEffect(() => {
    void loadNotes().catch(() => {
      setLoading(false);
      setSaveState("error");
    });
    // 这里只做首屏初始化，不能跟随编辑态回调反复重跑，否则切换笔记会被重新加载打断。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (loading || isHydratingRef.current) {
      return;
    }

    if (!isDirty) {
      if (saveState === "saving") {
        setSaveState("saved");
      }
      return;
    }

    setSaveState("idle");

    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
    }

    autosaveTimerRef.current = setTimeout(() => {
      void persistCurrentNote();
    }, 900);

    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
      }
    };
  }, [content, isDirty, loading, persistCurrentNote, saveState, titleInput]);

  useEffect(() => {
    registerCloseGuard(windowId, ensurePersistedBeforeClose);
    return () => unregisterCloseGuard(windowId);
  }, [ensurePersistedBeforeClose, registerCloseGuard, unregisterCloseGuard, windowId]);

  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (!isDirty) {
        return;
      }
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void persistCurrentNote();
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [persistCurrentNote]);

  useEffect(() => {
    if (!assistantNotice) {
      return;
    }

    const timer = window.setTimeout(() => {
      setAssistantNotice("");
      setAssistantMode(null);
    }, 2400);

    return () => {
      window.clearTimeout(timer);
    };
  }, [assistantNotice]);

  const createNote = async () => {
    if (isDirty) {
      const persisted = await persistCurrentNote({ refreshList: false });
      if (!persisted) {
        return;
      }
    }

    const nextTitle = buildUntitledName(notes);
    isHydratingRef.current = true;
    setActivePath("");
    setTitleInput(nextTitle);
    setContent(defaultNoteContent());
    setSavedTitle("");
    setSavedContent("");
    setSuggestion("");
    setSaveState("idle");
    setLastSavedAt(null);
    isHydratingRef.current = false;
  };

  const runAssist = async (mode: "rewrite" | "expand" | "summarize") => {
    setAssistantBusy(true);
    setAssistantMode(mode);
    setAssistantError("");
    setAssistantNotice("");
    setSuggestion("");
    try {
      const textarea = textareaRef.current;
      const selectionStart = textarea?.selectionStart ?? 0;
      const selectionEnd = textarea?.selectionEnd ?? 0;
      const selectedText =
        selectionEnd > selectionStart ? content.slice(selectionStart, selectionEnd) : "";

        let prompt = "";
        let systemPrompt = "你是一个专业的中文写作助手，只输出最终 Markdown，不要附加解释。";

        if (mode === "expand") {
          const expansionBase = selectedText || content;
          prompt = `请基于下面这段 Markdown 内容继续扩写，只输出新增的续写内容，不要重复原文，不要加解释，也不要补充标题、分隔线或说明。\n\n${expansionBase || "（当前正文为空）"}`;
          systemPrompt =
            "你是一个专业的中文写作助手。你只返回新增的扩写内容，不要重复用户原文，不要加入标题、前言、说明或代码块。";
        } else if (mode === "rewrite") {
          const rewriteBase = selectedText || content;
          prompt = `请在不改变原意的前提下润色下面这段 Markdown 内容，保持语气自然、结构清晰，只输出润色后的最终文本，不要附加解释，也不要补充标题、分隔线或说明。\n\n${rewriteBase || "（当前正文为空）"}`;
          systemPrompt =
            "你是一个专业的中文写作助手。你只返回润色后的最终 Markdown 文本，不要加入标题、说明、前言或代码块。";
        } else {
          const prompts = {
            summarize:
              "请总结下面的 Markdown，输出一版精炼但保留结构的 Markdown，不要补充标题、分隔线或说明。",
          };
          const summarizeBase = selectedText || content;
          prompt = `${prompts[mode]}\n\n${summarizeBase || "（当前正文为空）"}`;
          systemPrompt =
            "你是一个专业的中文写作助手。你只返回总结后的最终 Markdown 文本，不要加入标题、说明、前言或代码块。";
        }

        const data = await completeOnce(prompt, systemPrompt);
        const nextSuggestion = cleanAssistantResult(data.content?.trim() || "");
      if (!nextSuggestion) {
        setAssistantError("这次没有生成可用内容，请稍后再试。");
        return;
      }

        if (mode === "expand") {
          const insertAt = selectedText ? selectionEnd : content.length;
          const prefix = content.slice(0, insertAt);
          const suffix = content.slice(insertAt);
          const expansionText = selectedText ? nextSuggestion.replace(/^\s+/, "") : nextSuggestion;
          const spacer = selectedText ? "" : prefix.trimEnd() ? "\n\n" : "";
          const merged = `${prefix}${spacer}${expansionText}${suffix}`;
          setContent(merged);
          setAssistantNotice(selectedText ? "已将扩写内容插入到所选文本后面。" : "已将扩写内容追加到正文末尾。");
          requestAnimationFrame(() => {
            if (!textareaRef.current) {
              return;
            }
            const nextCursor = (prefix + spacer + expansionText).length;
            textareaRef.current.focus();
            textareaRef.current.setSelectionRange(nextCursor, nextCursor);
          });
          return;
        }

      if (mode === "rewrite") {
        const replaceStart = selectedText ? selectionStart : 0;
        const replaceEnd = selectedText ? selectionEnd : content.length;
        const prefix = content.slice(0, replaceStart);
        const suffix = content.slice(replaceEnd);
        const merged = `${prefix}${nextSuggestion}${suffix}`;
        setContent(merged);
        setAssistantNotice(selectedText ? "已将润色结果替换到所选文本。" : "已将润色结果替换正文。");
        requestAnimationFrame(() => {
          if (!textareaRef.current) {
            return;
          }
          const nextCursor = (prefix + nextSuggestion).length;
          textareaRef.current.focus();
          textareaRef.current.setSelectionRange(nextCursor, nextCursor);
        });
        return;
      }

      if (mode === "summarize") {
        const replaceStart = selectedText ? selectionStart : 0;
        const replaceEnd = selectedText ? selectionEnd : content.length;
        const prefix = content.slice(0, replaceStart);
        const suffix = content.slice(replaceEnd);
        const merged = `${prefix}${nextSuggestion}${suffix}`;
        setContent(merged);
        setAssistantNotice(selectedText ? "已将总结结果替换到所选文本。" : "已将总结结果替换正文。");
        requestAnimationFrame(() => {
          if (!textareaRef.current) {
            return;
          }
          const nextCursor = (prefix + nextSuggestion).length;
          textareaRef.current.focus();
          textareaRef.current.setSelectionRange(nextCursor, nextCursor);
        });
        return;
      }

      setSuggestion(nextSuggestion);
    } catch {
      setAssistantError("生成失败，请稍后重试。");
    } finally {
      setAssistantBusy(false);
    }
  };

  const filteredNotes = useMemo(() => {
    const keyword = searchQuery.trim().toLowerCase();
    const list = notes
      .filter((note) => {
        if (!keyword) return true;
        const title = note.name.replace(/\.md$/, "").toLowerCase();
        const preview = (noteSnippets[note.path] || "").toLowerCase();
        return title.includes(keyword) || preview.includes(keyword);
      })
      .sort((left, right) => {
        const rightActivity = noteActivity[right.path] || 0;
        const leftActivity = noteActivity[left.path] || 0;
        if (rightActivity !== leftActivity) {
          return rightActivity - leftActivity;
        }
        return left.name.localeCompare(right.name, "zh-CN");
      });

    const visible: VisibleNoteEntry[] = [...list];
    const draftMatches =
      !keyword ||
      currentTitle.toLowerCase().includes(keyword) ||
      currentPreview.toLowerCase().includes(keyword);

    if (!activePath && draftMatches) {
      visible.unshift({
        id: "draft-note",
        name: `${currentTitle}${NOTE_EXTENSION}`,
        path: "__draft__",
        kind: "file",
        isDraft: true,
      });
    }

    return visible;
  }, [currentPreview, currentTitle, noteActivity, noteSnippets, notes, searchQuery]);

  const saveHint =
    saveState === "saving"
      ? "正在自动保存"
      : saveState === "error"
        ? "自动保存失败"
        : isDirty
          ? "等待保存"
          : "已自动保存";

  const saveTone =
    saveState === "error"
      ? { color: "#b42318", bg: "rgba(254,242,242,0.92)", dot: "#ef4444" }
      : isDirty
        ? { color: "#b45309", bg: "rgba(255,251,235,0.95)", dot: "#f59e0b" }
        : { color: "#166534", bg: "rgba(240,253,244,0.96)", dot: "#22c55e" };

  const assistantTitle =
    assistantMode === "rewrite"
      ? "润色结果"
      : assistantMode === "expand"
        ? "扩写结果"
        : assistantMode === "summarize"
          ? "总结结果"
          : "智能建议";
  const shouldShowAssistantPanel = assistantBusy || suggestion || assistantError || assistantNotice;

  return (
    <div
      className="flex h-full min-w-0 overflow-hidden rounded-[30px]"
      style={{
        fontFamily:
          '"SF Pro Display","SF Pro Text","PingFang SC","Hiragino Sans GB","Microsoft YaHei","Segoe UI",sans-serif',
        color: "#1f2937",
        background:
          "linear-gradient(180deg, rgba(246,247,249,0.98), rgba(238,240,244,0.98))",
      }}
    >
      <aside
        className="flex w-[220px] shrink-0 flex-col border-r px-4 py-5"
        style={{
          borderColor: "rgba(15,23,42,0.08)",
          background:
            "linear-gradient(180deg, rgba(244,246,248,0.96), rgba(236,238,242,0.98))",
        }}
      >
        <div>
          <div className="text-[12px] font-medium tracking-[0.02em]" style={{ color: "#6b7280" }}>
            备忘录
          </div>
          <div className="mt-2 text-[28px] font-semibold tracking-[-0.03em]">笔记</div>
        </div>

        <div
          className="mt-6 rounded-[24px] border px-4 py-4"
          style={{
            borderColor: "rgba(15,23,42,0.08)",
            background: "rgba(255,255,255,0.78)",
          }}
        >
          <div className="flex items-center gap-3">
            <div
              className="flex h-10 w-10 items-center justify-center rounded-[14px]"
              style={{
                background: "rgba(245,158,11,0.14)",
                color: "#d97706",
              }}
            >
              <NotebookPen size={16} />
            </div>
            <div className="min-w-0">
              <div className="text-[14px] font-medium">全部笔记</div>
              <div className="mt-0.5 text-[12px]" style={{ color: "#6b7280" }}>
                {notes.length} 篇内容
              </div>
            </div>
          </div>

          <div
            className="mt-4 inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[12px] font-medium"
            style={{
              background: saveTone.bg,
              color: saveTone.color,
            }}
          >
            <span
              className="h-2 w-2 rounded-full"
              style={{ background: saveTone.dot }}
            />
            {saveHint}
          </div>
        </div>

        <div className="mt-auto px-1 text-[12px]" style={{ color: "#9ca3af" }}>
          笔记会自动保存到本地。
        </div>
      </aside>

      <section className="flex min-w-0 flex-1">
        <aside
          className="flex w-[320px] shrink-0 flex-col border-r"
          style={{
            borderColor: "rgba(15,23,42,0.08)",
            background: "rgba(252,252,253,0.88)",
          }}
        >
          <div className="border-b px-4 py-4" style={{ borderColor: "rgba(15,23,42,0.06)" }}>
            <div className="flex items-center gap-3">
              <div
                className="flex min-w-0 flex-1 items-center gap-2 rounded-[16px] border px-3 py-2.5"
                style={{
                  borderColor: "rgba(15,23,42,0.08)",
                  background: "rgba(255,255,255,0.96)",
                }}
              >
                <Search size={14} style={{ color: "#94a3b8" }} />
                <input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  className="min-w-0 flex-1 border-none bg-transparent text-[14px] outline-none"
                  placeholder="搜索笔记"
                />
              </div>

              <button
                onClick={() => void createNote()}
                className="inline-flex h-11 w-11 items-center justify-center rounded-[16px] transition"
                style={{
                  background:
                    "linear-gradient(180deg, rgba(250,204,21,0.96), rgba(245,158,11,0.96))",
                  color: "#111827",
                  boxShadow: "0 12px 28px rgba(245,158,11,0.22)",
                }}
                title="新建笔记"
              >
                <FilePlus2 size={17} />
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
            {filteredNotes.length === 0 ? (
              <div
                className="rounded-[24px] border border-dashed px-4 py-6 text-[13px] leading-6"
                style={{
                  borderColor: "rgba(15,23,42,0.1)",
                  color: "#6b7280",
                }}
              >
                没有匹配到笔记。可以尝试换个关键词，或者直接新建一篇。
              </div>
            ) : (
              <div className="space-y-2">
                {filteredNotes.map((note) => {
                  const isActive = note.isDraft ? !activePath : note.path === activePath;
                  const noteTitle = note.name.replace(/\.md$/, "");
                  const preview = note.isDraft
                    ? currentPreview
                    : noteSnippets[note.path] || "还没有内容";

                  return (
                    <button
                      key={note.id}
                      onClick={() => {
                        if (note.isDraft) {
                          return;
                        }
                        void openNote(note.path);
                      }}
                      className="w-full rounded-[22px] border px-4 py-3 text-left transition"
                      style={{
                        borderColor: isActive ? "rgba(59,130,246,0.18)" : "rgba(15,23,42,0.06)",
                        background: isActive
                          ? "linear-gradient(180deg, rgba(239,246,255,0.98), rgba(255,255,255,0.96))"
                          : "rgba(255,255,255,0.82)",
                        boxShadow: isActive ? "0 16px 34px rgba(59,130,246,0.11)" : "none",
                      }}
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{
                            background: isActive ? "#3b82f6" : note.isDraft ? "#f59e0b" : "#d1d5db",
                          }}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[15px] font-medium">{noteTitle}</div>
                          <div
                            className="mt-1 overflow-hidden text-[12px] leading-5"
                            style={{
                              color: "#6b7280",
                              display: "-webkit-box",
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: "vertical",
                            }}
                          >
                            {preview}
                          </div>
                          <div className="mt-2 text-[11px]" style={{ color: "#94a3b8" }}>
                            {note.isDraft
                              ? "草稿 · 等待自动保存"
                              : isActive
                                ? `当前打开 · ${formatSavedTime(lastSavedAt)}`
                                : "本地 Markdown 笔记"}
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <div
            className="flex items-center gap-3 border-b px-6 py-4"
            style={{
              borderColor: "rgba(15,23,42,0.08)",
              background: "rgba(255,255,255,0.72)",
            }}
          >
            <div
              className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[12px] font-medium"
              style={{
                background: saveTone.bg,
                color: saveTone.color,
              }}
            >
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ background: saveTone.dot }}
              />
              {saveHint}
            </div>

            <div className="text-[12px]" style={{ color: "#94a3b8" }}>
              {lastSavedAt ? `最近保存于 ${formatSavedTime(lastSavedAt)}` : "这篇笔记还没有落盘"}
            </div>

            <div className="ml-auto flex items-center gap-2">
              <AssistButton label="润色" busy={assistantBusy} onClick={() => void runAssist("rewrite")} />
              <AssistButton label="扩写" busy={assistantBusy} onClick={() => void runAssist("expand")} />
              <AssistButton label="总结" busy={assistantBusy} onClick={() => void runAssist("summarize")} />
            </div>
          </div>

          <div className="relative min-h-0 flex-1 overflow-y-auto px-8 py-8">
            {shouldShowAssistantPanel && (
              <div className="pointer-events-none absolute inset-x-0 top-5 z-20 flex justify-center px-8">
                <div
                  className={`pointer-events-auto w-full max-w-[720px] rounded-[24px] border px-5 shadow-[0_22px_56px_rgba(15,23,42,0.14)] backdrop-blur-xl ${assistantNotice && !assistantBusy && !suggestion && !assistantError ? "py-3" : "py-4"}`}
                  style={{
                    borderColor: assistantError
                      ? "rgba(248,113,113,0.22)"
                      : "rgba(255,255,255,0.72)",
                    background: assistantError
                      ? "linear-gradient(180deg, rgba(254,242,242,0.96), rgba(255,255,255,0.94))"
                      : "linear-gradient(180deg, rgba(255,251,235,0.95), rgba(255,255,255,0.96))",
                  }}
                >
                  <div className="flex items-center gap-2 text-[13px] font-medium">
                    <Sparkles size={15} />
                    {assistantBusy ? `正在生成${assistantTitle}` : assistantTitle}
                  </div>

                  {assistantBusy ? (
                    <div className="mt-2.5 flex items-center gap-2 text-[12px]" style={{ color: "#6b7280" }}>
                      <Loader2 size={14} className="animate-spin" />
                      正在处理当前笔记内容，请稍候。
                    </div>
                  ) : assistantNotice ? (
                    <div className="mt-2 text-[12px]" style={{ color: "#166534" }}>
                      {assistantNotice}
                    </div>
                  ) : assistantError ? (
                    <div className="mt-2.5 text-[12px]" style={{ color: "#b42318" }}>
                      {assistantError}
                    </div>
                  ) : (
                    <>
                      <div
                        className="mt-3 max-h-[220px] overflow-y-auto rounded-[18px] border px-4 py-3 text-[14px] leading-7"
                        style={{
                          borderColor: "rgba(15,23,42,0.08)",
                          background: "rgba(255,255,255,0.88)",
                        }}
                      >
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{suggestion}</ReactMarkdown>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          onClick={() => {
                            setContent(suggestion);
                            setSuggestion("");
                          }}
                          className="rounded-full px-4 py-2 text-[13px] font-medium"
                          style={{
                            background:
                              "linear-gradient(180deg, rgba(59,130,246,0.96), rgba(37,99,235,0.96))",
                            color: "#ffffff",
                          }}
                        >
                          替换正文
                        </button>
                        <button
                          onClick={() => {
                            setContent((prev) => `${prev}${prev.trim() ? "\n\n" : ""}${suggestion}`);
                            setSuggestion("");
                          }}
                          className="rounded-full border px-4 py-2 text-[13px] font-medium"
                          style={{
                            borderColor: "rgba(15,23,42,0.08)",
                            background: "rgba(255,255,255,0.9)",
                            color: "#334155",
                          }}
                        >
                          追加到末尾
                        </button>
                        <button
                          onClick={() => {
                            setSuggestion("");
                            setAssistantError("");
                            setAssistantNotice("");
                            setAssistantMode(null);
                          }}
                          className="rounded-full border px-4 py-2 text-[13px] font-medium"
                          style={{
                            borderColor: "rgba(15,23,42,0.08)",
                            background: "rgba(255,255,255,0.76)",
                            color: "#64748b",
                          }}
                        >
                          收起结果
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {loading ? (
              <div
                className="flex h-full items-center justify-center gap-3 text-[14px]"
                style={{ color: "#6b7280" }}
              >
                <Loader2 size={18} className="animate-spin" />
                正在载入笔记...
              </div>
            ) : (
              <div className="mx-auto flex h-full w-full max-w-[920px]">
                <div
                  className="flex min-h-0 flex-1 flex-col rounded-[34px] border px-10 py-9"
                  style={{
                    borderColor: "rgba(15,23,42,0.08)",
                    background: "rgba(255,255,255,0.96)",
                    boxShadow: "0 28px 90px rgba(15,23,42,0.08)",
                  }}
                >
                  <div className="flex items-start gap-4">
                    <div className="min-w-0 flex-1">
                      <input
                        value={titleInput}
                        onChange={(event) => setTitleInput(event.target.value)}
                        className="w-full border-none bg-transparent text-[34px] font-semibold tracking-[-0.04em] outline-none"
                        placeholder="新笔记"
                      />
                      <div className="mt-2 text-[12px]" style={{ color: "#9ca3af" }}>
                        文件名会随着标题自动更新，不需要额外执行保存。
                      </div>
                    </div>
                  </div>

                  <textarea
                    ref={textareaRef}
                    value={content}
                    onChange={(event) => setContent(event.target.value)}
                    className="mt-7 min-h-0 flex-1 w-full resize-none overflow-y-auto border-none bg-transparent text-[16px] leading-8 outline-none"
                    placeholder="开始记录想法..."
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
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
      className="rounded-full border px-3 py-2 text-[13px] font-medium transition"
      style={{
        borderColor: "rgba(15,23,42,0.08)",
        background: "rgba(255,255,255,0.9)",
        color: "#334155",
        opacity: busy ? 0.6 : 1,
      }}
    >
      <span className="inline-flex items-center gap-1.5">
        <Wand2 size={14} /> {label}
      </span>
    </button>
  );
}
