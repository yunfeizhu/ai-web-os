"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import Placeholder from "@tiptap/extension-placeholder";
import StarterKit from "@tiptap/starter-kit";
import UnderlineExtension from "@tiptap/extension-underline";
import {
  Bold,
  FileDown,
  FilePlus2,
  Pencil,
  Heading1,
  Heading2,
  Italic,
  Languages,
  List,
  ListOrdered,
  Loader2,
  PenTool,
  Printer,
  Quote,
  Save,
  Sparkles,
  Trash2,
  Underline,
  Wand2,
} from "lucide-react";

import { apiFetch, buildApiUrl, completeOnce } from "@/lib/backend";
import { useWindowStore } from "@/stores/windowStore";

interface FileEntry {
  id: string;
  name: string;
  path: string;
  kind: "file" | "dir";
}

type SelectionAction = "rewrite" | "translate" | "expand";
type DocumentAction = "outline" | "retone" | "continue";

const DOCS_PATH = "/Documents";
const DOC_EXTENSION = ".aosdoc.html";

function sanitizeName(value: string) {
  return (
    value
      .trim()
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "未命名文档"
  );
}

function createStarterHtml(title: string) {
  return `<h1>${title}</h1><p>从这里开始写作。选中文本后可以直接进行智能改写、翻译或扩写。</p>`;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noreferrer";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function htmlToMarkdown(html: string) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html || "", "text/html");

  const walk = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) {
      return (node.textContent || "").replace(/\s+/g, " ");
    }
    if (!(node instanceof HTMLElement)) return "";

    const children = Array.from(node.childNodes).map(walk).join("");
    switch (node.tagName.toLowerCase()) {
      case "h1":
        return `# ${children.trim()}\n\n`;
      case "h2":
        return `## ${children.trim()}\n\n`;
      case "h3":
        return `### ${children.trim()}\n\n`;
      case "strong":
      case "b":
        return `**${children.trim()}**`;
      case "em":
      case "i":
        return `*${children.trim()}*`;
      case "u":
        return `<u>${children.trim()}</u>`;
      case "blockquote":
        return `> ${children.trim()}\n\n`;
      case "ul":
        return `${Array.from(node.children)
          .map((item) => `- ${walk(item).trim()}`)
          .join("\n")}\n\n`;
      case "ol":
        return `${Array.from(node.children)
          .map((item, index) => `${index + 1}. ${walk(item).trim()}`)
          .join("\n")}\n\n`;
      case "li":
        return children.trim();
      case "br":
        return "\n";
      case "p":
      case "div":
        return `${children.trim()}\n\n`;
      default:
        return children;
    }
  };

  return Array.from(doc.body.childNodes)
    .map(walk)
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function htmlToPlainText(html: string) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html || "", "text/html");
  return (doc.body.textContent || "").replace(/\s+/g, " ").trim();
}

function normalizeContinuationHtml(html: string) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html || "", "text/html");
  const bodyHtml = doc.body.innerHTML.trim();

  if (!bodyHtml) {
    return "";
  }

  if (
    doc.body.children.length === 1 &&
    ["p", "div"].includes(doc.body.children[0]?.tagName.toLowerCase() || "")
  ) {
    return (doc.body.children[0] as HTMLElement).innerHTML.trim();
  }

  return bodyHtml;
}

function appendContinuationToLastBlock(currentHtml: string, continuationHtml: string) {
  const normalizedContinuation = normalizeContinuationHtml(continuationHtml);
  if (!normalizedContinuation) {
    return currentHtml;
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(currentHtml || "", "text/html");
  const lastElement = doc.body.lastElementChild as HTMLElement | null;

  if (lastElement && ["p", "div", "blockquote", "li"].includes(lastElement.tagName.toLowerCase())) {
    lastElement.insertAdjacentHTML("beforeend", normalizedContinuation);
    return doc.body.innerHTML;
  }

  doc.body.insertAdjacentHTML("beforeend", normalizedContinuation);
  return doc.body.innerHTML;
}

function normalizeTextForContinuation(value: string) {
  return value.replace(/\s+/g, "").trim();
}

function stripRepeatedPrefix(baseText: string, continuationHtml: string) {
  const normalizedContinuation = normalizeContinuationHtml(continuationHtml);
  if (!normalizedContinuation) {
    return "";
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(normalizedContinuation, "text/html");
  const fullText = normalizeTextForContinuation(doc.body.textContent || "");
  const baseNormalized = normalizeTextForContinuation(baseText);

  if (!baseNormalized || !fullText.startsWith(baseNormalized)) {
    return normalizedContinuation;
  }

  const trimTextPrefix = (node: Node, remaining: { value: string }) => {
    if (!remaining.value) {
      return;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      const textContent = node.textContent || "";
      const normalizedNodeText = normalizeTextForContinuation(textContent);
      if (!normalizedNodeText) {
        return;
      }

      if (remaining.value.startsWith(normalizedNodeText)) {
        node.textContent = "";
        remaining.value = remaining.value.slice(normalizedNodeText.length);
        return;
      }

      let matchedCount = 0;
      let normalizedIndex = 0;
      for (let i = 0; i < textContent.length && normalizedIndex < remaining.value.length; i += 1) {
        const char = textContent[i];
        if (/\s/.test(char)) {
          matchedCount = i + 1;
          continue;
        }
        if (char === remaining.value[normalizedIndex]) {
          matchedCount = i + 1;
          normalizedIndex += 1;
        } else {
          break;
        }
      }

      if (normalizedIndex > 0) {
        node.textContent = textContent.slice(matchedCount);
        remaining.value = remaining.value.slice(normalizedIndex);
      }
      return;
    }

    Array.from(node.childNodes).forEach((child) => trimTextPrefix(child, remaining));
  };

  const remaining = { value: baseNormalized };
  trimTextPrefix(doc.body, remaining);

  return doc.body.innerHTML.trim();
}

interface DocumentEditorProps {
  appState?: Record<string, unknown>;
  windowId: string;
}

export function DocumentEditor({ appState, windowId }: DocumentEditorProps) {
  const closeResolverRef = useRef<((value: boolean) => void) | null>(null);
  const selectionRangeRef = useRef<{ from: number; to: number } | null>(null);
  const continuationPositionRef = useRef<number | null>(null);
  const requestedFilePath = typeof appState?.filePath === "string" ? appState.filePath : "";
  const registerCloseGuard = useWindowStore((state) => state.registerCloseGuard);
  const unregisterCloseGuard = useWindowStore((state) => state.unregisterCloseGuard);

  const [documents, setDocuments] = useState<FileEntry[]>([]);
  const [activePath, setActivePath] = useState("");
  const [createTitleInput, setCreateTitleInput] = useState("");
  const [html, setHtml] = useState("");
  const [savedHtml, setSavedHtml] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [selectionText, setSelectionText] = useState("");
  const [renamingEntryId, setRenamingEntryId] = useState("");
  const [renameDraft, setRenameDraft] = useState("");
  const [deleteCandidateId, setDeleteCandidateId] = useState("");
  const [closePromptOpen, setClosePromptOpen] = useState(false);

  const activeName = useMemo(() => {
    if (!activePath) return "未命名文档";
    return activePath.split("/").pop()?.replace(DOC_EXTENSION, "") || "未命名文档";
  }, [activePath]);
  const activeDocumentTitle = activePath ? activeName : "未命名文档";

  const characterCount = useMemo(() => htmlToPlainText(html).length, [html]);
  const isDirty = useMemo(() => html !== savedHtml, [html, savedHtml]);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2],
        },
      }),
      UnderlineExtension,
      Placeholder.configure({
        placeholder: "从这里开始写作。选中文本后可以直接进行智能改写、翻译或扩写。",
      }),
    ],
    content: "",
    editorProps: {
      attributes: {
        class:
          "document-editor-prosemirror min-h-[920px] rounded-[32px] border px-12 py-12 text-[16px] leading-8 outline-none",
      },
    },
    onUpdate: ({ editor: currentEditor }) => {
      setHtml(currentEditor.getHTML());
    },
    onSelectionUpdate: ({ editor: currentEditor }) => {
      const { from, to } = currentEditor.state.selection;
      selectionRangeRef.current = { from, to };
      continuationPositionRef.current = to;
      setSelectionText(from === to ? "" : currentEditor.state.doc.textBetween(from, to, " ").trim());
    },
  });

  const syncEditorHtml = (nextHtml: string) => {
    setHtml(nextHtml);
    if (editor && editor.getHTML() !== nextHtml) {
      editor.commands.setContent(nextHtml, { emitUpdate: false });
    }
  };

  const loadDocuments = async (targetPath?: string) => {
    setLoading(true);
    try {
      const response = await apiFetch<{ entries: FileEntry[] }>(
        `/files?path=${encodeURIComponent(DOCS_PATH)}`,
      );
      const nextDocuments = response.entries.filter(
        (entry) => entry.kind === "file" && entry.name.endsWith(DOC_EXTENSION),
      );
      setDocuments(nextDocuments);

      const nextTarget =
        targetPath && nextDocuments.some((entry) => entry.path === targetPath)
          ? targetPath
          : nextDocuments[0]?.path;

      if (!activePath && nextTarget) {
        await openDocument(nextTarget);
        return;
      }

      if (!nextTarget) {
        setActivePath("");
        const starterHtml = createStarterHtml("未命名文档");
        syncEditorHtml(starterHtml);
        setSavedHtml(starterHtml);
      }
    } finally {
      setLoading(false);
    }
  };

  const openDocument = async (path: string) => {
    setLoading(true);
    try {
      const data = await apiFetch<{ content: string }>(
        `/files/content?path=${encodeURIComponent(path)}`,
      );
      setActivePath(path);
      const nextHtml = data.content || createStarterHtml("未命名文档");
      syncEditorHtml(nextHtml);
      setSavedHtml(nextHtml);
      setStatusText("");
    } catch {
      setStatusText("文档加载失败。");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDocuments(requestedFilePath || undefined).catch(() => {
      setStatusText("文档目录读取失败。");
    });
  }, [requestedFilePath]);

  useEffect(() => {
    if (!requestedFilePath || requestedFilePath === activePath) return;
    void openDocument(requestedFilePath).catch(() => {
      setStatusText("指定文档打开失败。");
    });
  }, [activePath, requestedFilePath]);

  useEffect(() => {
    if (!loading && editor && editor.getHTML() !== html) {
      editor.commands.setContent(html, { emitUpdate: false });
    }
  }, [editor, html, loading]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!isDirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  useEffect(() => {
    registerCloseGuard(windowId, () => {
      if (!isDirty) {
        return true;
      }
      setClosePromptOpen(true);
      return new Promise<boolean>((resolve) => {
        closeResolverRef.current = resolve;
      });
    });
    return () => {
      unregisterCloseGuard(windowId);
    };
  }, [isDirty, registerCloseGuard, unregisterCloseGuard, windowId]);

  const focusEditor = () => {
    editor?.commands.focus();
  };

  const applyCommand = (command: string) => {
    if (!editor) return;
    const chain = editor.chain().focus();

    switch (command) {
      case "bold":
        chain.toggleBold().run();
        break;
      case "italic":
        chain.toggleItalic().run();
        break;
      case "underline":
        chain.toggleUnderline().run();
        break;
      case "heading1":
        chain.toggleHeading({ level: 1 }).run();
        break;
      case "heading2":
        chain.toggleHeading({ level: 2 }).run();
        break;
      case "bulletList":
        chain.toggleBulletList().run();
        break;
      case "orderedList":
        chain.toggleOrderedList().run();
        break;
      case "blockquote":
        chain.toggleBlockquote().run();
        break;
      default:
        break;
    }
  };

  const createDocument = async () => {
    const baseName = sanitizeName(createTitleInput || "未命名文档");
    const path = `${DOCS_PATH}/${baseName}${DOC_EXTENSION}`;
    const content = createStarterHtml(createTitleInput || "未命名文档");

    setSaving(true);
    try {
      await apiFetch("/files/content", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path,
          content,
          mime_type: "text/html",
        }),
      });
      await loadDocuments(path);
      await openDocument(path);
      setCreateTitleInput("");
      setStatusText("已创建新文档。");
    } catch {
      setStatusText("创建文档失败。");
    } finally {
      setSaving(false);
    }
  };

  const renameDocument = async (entry: FileEntry, nextName: string) => {
    const trimmedName = nextName.trim() || entry.name.replace(DOC_EXTENSION, "") || "未命名文档";
    const nextFileName = `${sanitizeName(trimmedName)}${DOC_EXTENSION}`;

    setSaving(true);
    try {
      const renamedEntry =
        nextFileName === entry.name
          ? entry
          : await apiFetch<FileEntry>(`/files/${entry.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name: nextFileName }),
            });

      if (entry.path === activePath) {
        setActivePath(renamedEntry.path);
      }

      setRenamingEntryId("");
      setRenameDraft("");
      await loadDocuments(renamedEntry.path);
      setStatusText("文档已重命名。");
    } catch {
      setStatusText("文档重命名失败。");
    } finally {
      setSaving(false);
    }
  };

  const deleteDocument = async (entry: FileEntry) => {
    setSaving(true);
    try {
      await apiFetch<{ status: string }>(`/files/${entry.id}`, { method: "DELETE" });

      const remainingDocuments = documents.filter((item) => item.id !== entry.id);
      const nextEntry = remainingDocuments[0] || null;

      setDocuments(remainingDocuments);
      setDeleteCandidateId("");

      if (entry.path === activePath) {
        if (nextEntry) {
          await openDocument(nextEntry.path);
          await loadDocuments(nextEntry.path);
        } else {
          setActivePath("");
          syncEditorHtml(createStarterHtml("未命名文档"));
        }
      } else {
        await loadDocuments(activePath || undefined);
      }

      setStatusText("文档已删除。");
    } catch {
      setStatusText("文档删除失败。");
    } finally {
      setSaving(false);
    }
  };

  const startRenameDocument = (entry: FileEntry) => {
    setDeleteCandidateId("");
    setRenamingEntryId(entry.id);
    setRenameDraft(entry.name.replace(DOC_EXTENSION, ""));
  };

  const cancelRenameDocument = () => {
    setRenamingEntryId("");
    setRenameDraft("");
  };

  const requestDeleteDocument = (entry: FileEntry) => {
    setRenamingEntryId("");
    setRenameDraft("");
    setDeleteCandidateId(entry.id);
  };

  const cancelDeleteDocument = () => {
    setDeleteCandidateId("");
  };

  const saveDocument = async () => {
    const path = activePath || `${DOCS_PATH}/${sanitizeName(createTitleInput || "未命名文档")}${DOC_EXTENSION}`;
    setSaving(true);
    try {
      const nextHtml = editor?.getHTML() || html;
      await apiFetch("/files/content", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path,
          content: nextHtml,
          mime_type: "text/html",
        }),
      });
      setActivePath(path);
      setHtml(nextHtml);
      setSavedHtml(nextHtml);
      await loadDocuments(path);
      setCreateTitleInput("");
      setStatusText("文档已保存。");
      return true;
    } catch {
      setStatusText("保存失败。");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const resolveClosePrompt = (value: boolean) => {
    closeResolverRef.current?.(value);
    closeResolverRef.current = null;
    setClosePromptOpen(false);
  };

  const saveAndClose = async () => {
    const saved = await saveDocument();
    if (saved) {
      resolveClosePrompt(true);
    }
  };

  const replaceSelectionHtml = (fragmentHtml: string) => {
    if (!editor || !selectionRangeRef.current) return false;
    const { from, to } = selectionRangeRef.current;
    editor.chain().focus().insertContentAt({ from, to }, fragmentHtml).run();
    syncEditorHtml(editor.getHTML());
    return true;
  };

  const runSelectionAssist = async (mode: SelectionAction) => {
    if (!selectionText) {
      setStatusText("请先选中一段文本。");
      return;
    }
    setAiBusy(true);
    setStatusText("");
    try {
      const prompts: Record<SelectionAction, string> = {
        rewrite: "请改写下面这段文档内容，保留原意但提升表达质量。",
        translate: "请把下面这段文档内容翻译成更自然的中文商务表达。",
        expand: "请扩写下面这段文档内容，补足必要细节。",
      };
      const result = await completeOnce(
        `${prompts[mode]}\n\n请只输出 HTML 片段，不要输出 markdown 或解释。\n\n${selectionText}`,
        "你是专业文档编辑助手，只返回简洁可插入正文的 HTML 片段。",
      );
      replaceSelectionHtml(result.content);
      setStatusText("智能助手已处理选中文本。");
    } catch {
      setStatusText("智能处理失败。");
    } finally {
      setAiBusy(false);
    }
  };

  const runDocumentAssist = async (mode: DocumentAction) => {
    const currentHtml = editor?.getHTML() || html;
    setAiBusy(true);
    setStatusText("");
    try {
      const prompts: Record<DocumentAction, string> = {
        outline: "请基于下面全文，整理成更清晰的大纲结构。",
        retone: "请把下面全文调整成更专业、克制、适合正式汇报的语气。",
        continue: "请基于下面全文，从当前位置继续续写一段自然衔接的正文。",
      };
      const result = await completeOnce(
        `${prompts[mode]}\n\n请直接输出 HTML 正文，不要解释。\n\n${currentHtml}`,
        "你是专业文档写作助手，只输出可直接替换或插入的 HTML 正文。",
      );
      if (mode === "continue") {
        const continuationBaseText = selectionText || htmlToPlainText(currentHtml).slice(-80);
        const normalizedContinuation = stripRepeatedPrefix(continuationBaseText, result.content);

        if (editor && normalizedContinuation) {
          const insertionPos = continuationPositionRef.current ?? editor.state.selection.to;
          editor.chain().focus().insertContentAt(insertionPos, normalizedContinuation).run();
          syncEditorHtml(editor.getHTML());
        } else {
          const nextHtml = appendContinuationToLastBlock(currentHtml, result.content);
          syncEditorHtml(nextHtml);
        }
      } else {
        syncEditorHtml(result.content);
      }
      setStatusText("智能助手已更新全文。");
    } catch {
      setStatusText("智能生成失败。");
    } finally {
      setAiBusy(false);
    }
  };

  const exportMarkdown = () => {
    const markdown = htmlToMarkdown(editor?.getHTML() || html);
    downloadBlob(
      new Blob([markdown], { type: "text/markdown;charset=utf-8" }),
      `${activeName}.md`,
    );
  };

  const exportDocx = async () => {
    try {
      const response = await fetch(buildApiUrl("/office/document/export-docx"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: activeDocumentTitle,
          html: editor?.getHTML() || html,
        }),
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      const blob = await response.blob();
      downloadBlob(blob, `${activeName}.docx`);
    } catch {
      setStatusText("排版文稿导出失败。");
    }
  };

  const exportPdf = () => {
    const content = editor?.getHTML() || html;
    const popup = window.open("", "_blank", "noopener,noreferrer,width=960,height=720");
    if (!popup) {
      setStatusText("浏览器拦截了打印窗口。");
      return;
    }
    popup.document.write(`
      <html>
        <head>
          <title>${activeDocumentTitle}</title>
          <style>
            body { font-family: Georgia, "Times New Roman", serif; padding: 48px; line-height: 1.7; color: #111827; }
            h1,h2,h3 { line-height: 1.2; }
            blockquote { border-left: 3px solid #cbd5e1; margin: 1.2rem 0; padding-left: 1rem; color: #475569; }
          </style>
        </head>
        <body>${content}</body>
      </html>
    `);
    popup.document.close();
    popup.focus();
    popup.print();
  };

  return (
    <div
      data-desktop-blocker="true"
      className="flex h-full min-w-0 overflow-hidden rounded-[28px]"
      style={{
        color: "var(--t1)",
        background:
          "radial-gradient(circle at top left, rgba(251,113,133,0.14), transparent 28%), linear-gradient(180deg, rgba(255,255,255,0.96), rgba(249,250,251,0.98))",
      }}
    >
      <aside
        className="flex w-[260px] shrink-0 flex-col border-r px-4 py-4"
        style={{ borderColor: "rgba(15,23,42,0.08)", background: "rgba(255,255,255,0.82)" }}
      >
        <div className="mb-4">
          <div className="text-[12px] font-medium" style={{ color: "#e11d48" }}>
            写作空间
          </div>
          <div className="mt-1 text-[22px] font-semibold">文档工作台</div>
          <p className="mt-2 text-[12px] leading-5" style={{ color: "var(--t3)" }}>
            这里是富文本写作区。支持选中内容后直接智能改写、翻译、扩写，也支持全文大纲整理和导出。
          </p>
        </div>

        <div className="flex items-center gap-2">
          <input
            value={createTitleInput}
            onChange={(event) => setCreateTitleInput(event.target.value)}
            className="min-w-0 flex-1 rounded-2xl border px-3 py-2 text-[13px] outline-none"
            style={{
              borderColor: "rgba(15,23,42,0.08)",
              background: "rgba(248,250,252,0.88)",
            }}
            placeholder="新文档标题"
          />
          <button
            onClick={() => void createDocument()}
            disabled={saving}
            className="inline-flex h-10 w-10 items-center justify-center rounded-2xl"
            style={{ background: "linear-gradient(135deg, #fb7185, #e11d48)", color: "#fff" }}
            title="新建文档"
          >
            <FilePlus2 size={16} />
          </button>
        </div>

        <div className="mt-5 text-[12px] font-medium" style={{ color: "var(--t3)" }}>
          文档列表
        </div>
        <div className="mt-3 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
          {documents.length === 0 ? (
            <div
              className="rounded-3xl border border-dashed px-4 py-6 text-[13px] leading-6"
              style={{ borderColor: "rgba(15,23,42,0.1)", color: "var(--t3)" }}
            >
              还没有文档。直接输入标题后点击右上角加号，就会在文档目录中创建一份新文档。
            </div>
          ) : (
            documents.map((doc) => (
              <div
                key={doc.id}
                className="rounded-[22px] border px-4 py-3"
                style={{
                  borderColor:
                    doc.path === activePath ? "rgba(225,29,72,0.32)" : "rgba(15,23,42,0.06)",
                  background:
                    doc.path === activePath
                      ? "linear-gradient(135deg, rgba(251,113,133,0.12), rgba(255,255,255,0.92))"
                      : "rgba(255,255,255,0.72)",
                }}
              >
                <button
                  onClick={() => void openDocument(doc.path)}
                  className="w-full text-left"
                >
                  <div className="truncate text-[14px] font-medium">
                    {doc.name.replace(DOC_EXTENSION, "")}
                  </div>
                  <div className="mt-1 truncate text-[12px]" style={{ color: "var(--t3)" }}>
                    文档目录 / {doc.name.replace(DOC_EXTENSION, "")}
                  </div>
                </button>

                {renamingEntryId === doc.id ? (
                  <div className="mt-3 grid gap-2">
                    <input
                      value={renameDraft}
                      onChange={(event) => setRenameDraft(event.target.value)}
                      autoFocus
                      className="w-full rounded-2xl border px-3 py-2 text-[12px] outline-none"
                      style={{ borderColor: "rgba(225,29,72,0.18)", background: "rgba(255,255,255,0.92)" }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void renameDocument(doc, renameDraft);
                        }
                        if (event.key === "Escape") {
                          event.preventDefault();
                          cancelRenameDocument();
                        }
                      }}
                    />
                    <div className="flex items-center gap-2">
                      <button
                        disabled={saving || !renameDraft.trim()}
                        className="rounded-full border px-3 py-1.5 text-[12px] font-medium disabled:cursor-not-allowed disabled:opacity-55"
                        style={{ borderColor: "rgba(15,23,42,0.08)", background: "rgba(255,255,255,0.88)" }}
                        onClick={() => void renameDocument(doc, renameDraft)}
                      >
                        确认
                      </button>
                      <button
                        disabled={saving}
                        className="rounded-full border px-3 py-1.5 text-[12px] font-medium disabled:cursor-not-allowed disabled:opacity-55"
                        style={{ borderColor: "rgba(15,23,42,0.08)", background: "rgba(255,255,255,0.88)" }}
                        onClick={cancelRenameDocument}
                      >
                        取消
                      </button>
                    </div>
                  </div>
                ) : deleteCandidateId === doc.id ? (
                  <div
                    className="mt-3 rounded-2xl border px-3 py-3"
                    style={{ borderColor: "rgba(220,38,38,0.14)", background: "rgba(255,255,255,0.92)" }}
                  >
                    <div className="text-[12px] leading-5" style={{ color: "var(--t2)" }}>
                      确认删除“{doc.name.replace(DOC_EXTENSION, "")}”吗？
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        disabled={saving}
                        className="rounded-full border px-3 py-1.5 text-[12px] font-medium text-[#dc2626] disabled:cursor-not-allowed disabled:opacity-55"
                        style={{ borderColor: "rgba(220,38,38,0.14)", background: "rgba(255,255,255,0.88)" }}
                        onClick={() => void deleteDocument(doc)}
                      >
                        确认删除
                      </button>
                      <button
                        disabled={saving}
                        className="rounded-full border px-3 py-1.5 text-[12px] font-medium disabled:cursor-not-allowed disabled:opacity-55"
                        style={{ borderColor: "rgba(15,23,42,0.08)", background: "rgba(255,255,255,0.88)", color: "#475569" }}
                        onClick={cancelDeleteDocument}
                      >
                        取消
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 flex items-center gap-2">
                    <button
                      disabled={saving}
                      className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-medium disabled:cursor-not-allowed disabled:opacity-55"
                      style={{ borderColor: "rgba(15,23,42,0.08)", background: "rgba(255,255,255,0.88)", color: "#475569" }}
                      onClick={() => startRenameDocument(doc)}
                    >
                      <Pencil size={12} />
                      重命名
                    </button>
                    <button
                      disabled={saving}
                      className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-medium text-[#dc2626] disabled:cursor-not-allowed disabled:opacity-55"
                      style={{ borderColor: "rgba(220,38,38,0.14)", background: "rgba(255,255,255,0.88)", color: "#be123c" }}
                      onClick={() => requestDeleteDocument(doc)}
                    >
                      <Trash2 size={12} />
                      删除
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <div
          className="border-b px-4 py-3"
          style={{ borderColor: "rgba(15,23,42,0.08)", background: "rgba(255,255,255,0.75)" }}
        >
          <div className="flex flex-wrap items-center gap-3">
            <ToolbarGroup>
              <ToolbarIconButton icon={<Bold size={15} />} label="加粗" onClick={() => applyCommand("bold")} active={!!editor?.isActive("bold")} />
              <ToolbarIconButton icon={<Italic size={15} />} label="斜体" onClick={() => applyCommand("italic")} active={!!editor?.isActive("italic")} />
              <ToolbarIconButton icon={<Underline size={15} />} label="下划线" onClick={() => applyCommand("underline")} active={!!editor?.isActive("underline")} />
              <ToolbarIconButton icon={<Heading1 size={15} />} label="一级标题" onClick={() => applyCommand("heading1")} active={!!editor?.isActive("heading", { level: 1 })} />
              <ToolbarIconButton icon={<Heading2 size={15} />} label="二级标题" onClick={() => applyCommand("heading2")} active={!!editor?.isActive("heading", { level: 2 })} />
              <ToolbarIconButton icon={<List size={15} />} label="无序列表" onClick={() => applyCommand("bulletList")} active={!!editor?.isActive("bulletList")} />
              <ToolbarIconButton icon={<ListOrdered size={15} />} label="有序列表" onClick={() => applyCommand("orderedList")} active={!!editor?.isActive("orderedList")} />
              <ToolbarIconButton icon={<Quote size={15} />} label="引用" onClick={() => applyCommand("blockquote")} active={!!editor?.isActive("blockquote")} />
            </ToolbarGroup>

            <ToolbarGroup accent="pink">
              <ToolbarIconButton
                icon={<Wand2 size={15} />}
                label="改写选中"
                onClick={() => void runSelectionAssist("rewrite")}
                disabled={aiBusy}
              />
              <ToolbarIconButton
                icon={<Languages size={15} />}
                label="翻译选中"
                onClick={() => void runSelectionAssist("translate")}
                disabled={aiBusy}
              />
              <ToolbarIconButton
                icon={<Sparkles size={15} />}
                label="扩写选中"
                onClick={() => void runSelectionAssist("expand")}
                disabled={aiBusy}
              />
              <ToolbarIconButton
                icon={<ListOrdered size={15} />}
                label="整理大纲"
                onClick={() => void runDocumentAssist("outline")}
                disabled={aiBusy}
              />
              <ToolbarIconButton
                icon={<PenTool size={15} />}
                label="调整语气"
                onClick={() => void runDocumentAssist("retone")}
                disabled={aiBusy}
              />
              <ToolbarIconButton
                icon={<Sparkles size={15} />}
                label="智能续写"
                onClick={() => void runDocumentAssist("continue")}
                disabled={aiBusy}
              />
            </ToolbarGroup>

            <ToolbarGroup>
              <ToolbarIconButton
                icon={saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                label="保存"
                onClick={() => void saveDocument()}
                disabled={saving}
                active={isDirty}
              />
              <ToolbarIconButton icon={<FileDown size={15} />} label="导出轻量稿" onClick={exportMarkdown} />
              <ToolbarIconButton icon={<FileDown size={15} />} label="导出排版稿" onClick={() => void exportDocx()} />
              <ToolbarIconButton icon={<Printer size={15} />} label="打印导出" onClick={exportPdf} />
            </ToolbarGroup>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px]">
            <div
              className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5"
              style={{ borderColor: "rgba(15,23,42,0.08)", background: "rgba(255,255,255,0.82)", color: "#64748b" }}
            >
              <span className="font-medium" style={{ color: "#be123c" }}>工具提示</span>
              <span>悬停图标可查看功能说明</span>
            </div>
            <div
              className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5"
              style={{
                borderColor: isDirty ? "rgba(245,158,11,0.18)" : "rgba(34,197,94,0.18)",
                background: isDirty ? "rgba(255,251,235,0.9)" : "rgba(240,253,244,0.92)",
                color: isDirty ? "#b45309" : "#15803d",
              }}
            >
              <span className="font-medium">{isDirty ? "保存状态" : "已保存"}</span>
              <span>{saving ? "正在保存..." : isDirty ? "有未保存更改" : "所有修改已保存"}</span>
            </div>
            <div
              className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5"
              style={{
                borderColor: selectionText ? "rgba(225,29,72,0.14)" : "rgba(15,23,42,0.08)",
                background: selectionText ? "rgba(255,241,242,0.92)" : "rgba(255,255,255,0.82)",
                color: selectionText ? "#be123c" : "#64748b",
              }}
            >
              <span className="font-medium">{selectionText ? "已选中内容" : "智能改写"}</span>
              <span>{selectionText ? "可直接使用改写、翻译或扩写" : "先选中一段内容再使用局部智能功能"}</span>
            </div>
          </div>
        </div>

        <div className="flex min-h-0 flex-1">
          <div className="min-h-0 flex-1 overflow-auto px-8 py-8">
            {loading ? (
              <div className="flex h-full items-center justify-center gap-3 text-[14px]" style={{ color: "var(--t3)" }}>
                <Loader2 size={18} className="animate-spin" />
                正在读取文档...
              </div>
            ) : (
              <div className="mx-auto min-h-full max-w-[860px]">
                <div
                  className="rounded-[32px]"
                  style={{
                    background: "rgba(255,255,255,0.92)",
                  }}
                >
                  <EditorContent editor={editor} />
                </div>
              </div>
            )}
          </div>

          <aside
            className="w-[280px] shrink-0 border-l px-4 py-4"
            style={{ borderColor: "rgba(15,23,42,0.08)", background: "rgba(255,255,255,0.72)" }}
          >
            <div className="text-[12px] font-medium" style={{ color: "#be123c" }}>
              文档信息
            </div>
            <div className="mt-2 text-[18px] font-semibold">当前文稿</div>
            <div className="mt-4 grid gap-3">
              <MetricCard label="当前文档" value={activeDocumentTitle} />
              <MetricCard
                label="选区状态"
                value={selectionText ? `已选中 ${selectionText.length} 个字符` : "当前未选中内容"}
              />
              <MetricCard label="字符数" value={`${characterCount}`} />
            </div>
            <div
              className="mt-5 rounded-[28px] border px-4 py-4 text-[12px] leading-6"
              style={{ borderColor: "rgba(15,23,42,0.08)", color: "var(--t3)" }}
            >
              文档说明：
              <br />
              1. 左侧用于文档切换与新建
              <br />
              2. 顶部工具栏负责排版、智能处理与导出
              <br />
              3. 中间区域为正文编辑区
              <br />
              4. 右侧仅展示当前文稿信息
            </div>
          </aside>
        </div>
      </section>

      {closePromptOpen && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/20 backdrop-blur-sm">
          <div
            className="w-[420px] rounded-[28px] border bg-white p-5 shadow-2xl"
            style={{ borderColor: "rgba(15,23,42,0.08)" }}
          >
            <div className="text-[20px] font-semibold">还有未保存的修改</div>
            <p className="mt-3 text-[13px] leading-6" style={{ color: "var(--t3)" }}>
              当前文档还有未保存内容。你可以先保存，再关闭窗口；也可以直接关闭并放弃这些修改。
            </p>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                className="rounded-full border px-4 py-2 text-[13px]"
                style={{ borderColor: "rgba(15,23,42,0.08)", background: "rgba(255,255,255,0.92)" }}
                onClick={() => resolveClosePrompt(false)}
              >
                取消
              </button>
              <button
                className="rounded-full border px-4 py-2 text-[13px]"
                style={{ borderColor: "rgba(239,68,68,0.14)", background: "rgba(255,255,255,0.92)", color: "#be123c" }}
                onClick={() => resolveClosePrompt(true)}
              >
                直接关闭
              </button>
              <button
                className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-[13px] font-medium text-white"
                style={{ background: "linear-gradient(135deg, #fb7185, #e11d48)" }}
                onClick={() => void saveAndClose()}
              >
                {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                保存并关闭
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx global>{`
        .document-editor-prosemirror {
          min-height: 920px;
          border: 1px solid rgba(15, 23, 42, 0.08);
          border-radius: 32px;
          padding: 48px;
          background: rgba(255, 255, 255, 0.92);
          box-shadow: 0 26px 80px rgba(15, 23, 42, 0.08);
          color: #111827;
          line-height: 1.6;
          outline: none;
        }

        .document-editor-prosemirror > *:first-child {
          margin-top: 0;
        }

        .document-editor-prosemirror > *:last-child {
          margin-bottom: 0;
        }

        .document-editor-prosemirror h1 {
          margin: 0 0 1rem;
          font-size: 2rem;
          font-weight: 700;
          line-height: 1.25;
        }

        .document-editor-prosemirror h2 {
          margin: 1.15rem 0 0.75rem;
          font-size: 1.45rem;
          font-weight: 700;
          line-height: 1.3;
        }

        .document-editor-prosemirror p {
          margin: 0 0 0.22rem;
        }

        .document-editor-prosemirror ul,
        .document-editor-prosemirror ol {
          margin: 0.12rem 0 0.45rem 1.25rem;
          padding-left: 1rem;
        }

        .document-editor-prosemirror blockquote {
          margin: 0.7rem 0;
          border-left: 3px solid rgba(225, 29, 72, 0.2);
          padding-left: 1rem;
          color: #475569;
        }

        .document-editor-prosemirror .is-editor-empty:first-child::before {
          content: attr(data-placeholder);
          float: left;
          height: 0;
          color: #94a3b8;
          pointer-events: none;
        }
      `}</style>
    </div>
  );
}

function ToolbarGroup({
  children,
  accent = "slate",
}: {
  children: React.ReactNode;
  accent?: "slate" | "pink";
}) {
  return (
    <div
      className="inline-flex items-center gap-1 rounded-[18px] border px-2 py-1.5"
      style={{
        borderColor: accent === "pink" ? "rgba(225,29,72,0.12)" : "rgba(15,23,42,0.08)",
        background:
          accent === "pink"
            ? "linear-gradient(180deg, rgba(255,241,242,0.9), rgba(255,255,255,0.92))"
            : "linear-gradient(180deg, rgba(255,255,255,0.92), rgba(248,250,252,0.92))",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.88)",
      }}
    >
      {children}
    </div>
  );
}

function ToolbarIconButton({
  icon,
  label,
  onClick,
  disabled = false,
  active = false,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="inline-flex h-9 w-9 items-center justify-center rounded-xl transition"
      style={{
        background: disabled
          ? "rgba(148,163,184,0.14)"
          : active
            ? "rgba(251,113,133,0.14)"
            : "transparent",
        color: disabled ? "rgba(100,116,139,0.72)" : active ? "#be123c" : "#0f172a",
        border: active ? "1px solid rgba(251,113,133,0.16)" : "1px solid transparent",
      }}
    >
      {icon}
    </button>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="rounded-[24px] border px-4 py-3"
      style={{ borderColor: "rgba(15,23,42,0.08)", background: "rgba(248,250,252,0.9)" }}
    >
      <div className="text-[11px] font-medium" style={{ color: "#64748b" }}>
        {label}
      </div>
      <div className="mt-2 text-[13px] leading-6">{value}</div>
    </div>
  );
}
