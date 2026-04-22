"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  FileArchive,
  FileAudio2,
  FileCode2,
  FileCog,
  FileImage,
  FileJson,
  FilePenLine,
  FileSpreadsheet,
  FileSymlink,
  FileText,
  FileVideo,
  Folder,
  FolderPlus,
  HardDrive,
  LayoutGrid,
  List,
  Loader2,
  MoveRight,
  Pencil,
  PenTool,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";

import {
  columnLabel,
  getSheetDimensions,
  getSpreadsheetPreview,
  isSpreadsheetFileName,
  parseSpreadsheetBuffer,
} from "@/apps/spreadsheet-viewer/spreadsheet-utils";
import { apiFetch, buildApiUrl } from "@/lib/backend";
import { downloadFileBuffer, invalidateFileBufferCache } from "@/lib/file-download-cache";
import { invalidateFileTextCache, loadFileText } from "@/lib/file-text-cache";
import { useDesktopStore } from "@/stores/desktopStore";
import { useWindowStore } from "@/stores/windowStore";

interface FileEntry {
  id: string;
  name: string;
  path: string;
  parent_path: string;
  kind: "file" | "dir";
  mime_type: string | null;
  size: number;
}

interface TreeNode {
  name: string;
  path: string;
  children: TreeNode[];
}

type ActionState =
  | { type: "new-folder"; value: string }
  | { type: "new-text-file"; value: string }
  | { type: "rename"; value: string }
  | { type: "move"; value: string }
  | { type: "copy"; value: string }
  | null;

const PREVIEW_DELAY_MS = 180;

export function FileManager() {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [rootName, setRootName] = useState("主目录");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [currentPath, setCurrentPath] = useState("/");
  const [selected, setSelected] = useState<FileEntry | null>(null);
  const [previewEntry, setPreviewEntry] = useState<FileEntry | null>(null);
  const [previewText, setPreviewText] = useState<string>("");
  const [spreadsheetPreview, setSpreadsheetPreview] = useState<{
    name: string;
    cells: string[][];
    totalRows: number;
    totalCols: number;
  } | null>(null);
  const [spreadsheetPreviewStatus, setSpreadsheetPreviewStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [textPreviewStatus, setTextPreviewStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [mediaPreviewError, setMediaPreviewError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState<ActionState>(null);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    entry: FileEntry;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const openWindow = useWindowStore((state) => state.openWindow);
  const textEditorApp = useDesktopStore((state) => state.apps["text-editor"]);
  const documentEditorApp = useDesktopStore((state) => state.apps["document-editor"]);
  const whiteboardApp = useDesktopStore((state) => state.apps["whiteboard"]);

  const MENU_W = 164;
  const MENU_H = 220; // 最大预估高度（5 项 × ~40px + padding）

  const openContextMenu = (x: number, y: number, entry: FileEntry) => {
    const rect = containerRef.current?.getBoundingClientRect() ?? {
      left: 0,
      top: 0,
      width: 800,
      height: 600,
    };
    let relX = x - rect.left;
    let relY = y - rect.top;
    // 右侧溢出 → 向左弹出
    if (relX + MENU_W > rect.width) relX = relX - MENU_W;
    // 底部溢出 → 向上弹出
    if (relY + MENU_H > rect.height) relY = relY - MENU_H;
    // 保证不超出左/上边界
    relX = Math.max(4, relX);
    relY = Math.max(4, relY);
    setContextMenu({ x: relX, y: relY, entry });
  };

  const selectedIsEditableText = isEditableTextFile(selected);
  const selectedIsEditableSpreadsheet = isEditableSpreadsheetFile(selected);
  const selectedIsDrive = isDriveEntry(selected);
  const selectedPreviewKind = getPreviewKind(selected);
  const previewKind = getPreviewKind(previewEntry);
  const selectedCanOpenExternally = isExternallyOpenableFile(selected);
  const selectedShouldDownloadDirectly = isDirectDownloadFile(selected);
  const previewDownloadUrl = previewEntry ? getDownloadUrl(previewEntry) : "";
  const isPreviewPending =
    selected?.kind === "file" &&
    selectedPreviewKind !== "unsupported" &&
    previewEntry?.id !== selected?.id;

  const selectedDownloadUrl = selected
    ? getDownloadUrl(selected)
    : "";

  const breadcrumbs = useMemo(() => {
    if (currentPath === "/") return ["/"];
    const parts = currentPath.split("/").filter(Boolean);
    return [
      "/",
      ...parts.map((_, index) => `/${parts.slice(0, index + 1).join("/")}`),
    ];
  }, [currentPath]);

  const loadTree = async () => {
    const data = await apiFetch<{ tree: TreeNode[]; root_name: string }>(
      "/files/tree",
    );
    setTree(data.tree);
    if (data.root_name) setRootName(data.root_name);
  };

  const openTextEditor = (entry: FileEntry) => {
    if (!isEditableTextFile(entry)) return;
    openWindow(
      "text-editor",
      entry.name,
      textEditorApp?.manifest.icon ?? "FileText",
      {
        size: textEditorApp?.manifest.ui.defaultSize ?? {
          width: 920,
          height: 680,
        },
        minSize: textEditorApp?.manifest.ui.minSize ?? {
          width: 520,
          height: 360,
        },
        singleton: false,
        instanceKey: entry.path,
        appState: { filePath: entry.path },
      },
    );
  };

  const openSpreadsheetEditor = (entry: FileEntry) => {
    if (!isEditableSpreadsheetFile(entry)) return;
    openWindow("spreadsheet-viewer", entry.name, "FileSpreadsheet", {
      size: { width: 1080, height: 760 },
      minSize: { width: 720, height: 480 },
      singleton: false,
      instanceKey: entry.path,
      appState: { filePath: entry.path, fileId: entry.id },
    });
  };

  const openDocumentEditor = (entry: FileEntry) => {
    if (!isDocumentEditorFile(entry)) return;
    openWindow(
      "document-editor",
      entry.name.replace(/\.aosdoc\.html$/i, ""),
      documentEditorApp?.manifest.icon ?? "FilePenLine",
      {
        size: documentEditorApp?.manifest.ui.defaultSize ?? {
          width: 1180,
          height: 760,
        },
        minSize: documentEditorApp?.manifest.ui.minSize ?? {
          width: 760,
          height: 520,
        },
        singleton: false,
        instanceKey: entry.path,
        appState: { filePath: entry.path, fileId: entry.id },
      },
    );
  };

  const openWhiteboardEditor = (entry: FileEntry) => {
    if (!isWhiteboardFile(entry)) return;
    openWindow(
      "whiteboard",
      entry.name.replace(/\.whiteboard\.json$/i, ""),
      whiteboardApp?.manifest.icon ?? "PenTool",
      {
        size: whiteboardApp?.manifest.ui.defaultSize ?? {
          width: 1220,
          height: 760,
        },
        minSize: whiteboardApp?.manifest.ui.minSize ?? {
          width: 900,
          height: 560,
        },
        singleton: false,
        instanceKey: entry.path,
        appState: { filePath: entry.path, fileId: entry.id },
      },
    );
  };

  const openExternalFile = (entry: FileEntry) => {
    if (!isExternallyOpenableFile(entry)) return;
    window.open(getDownloadUrl(entry), "_blank", "noopener,noreferrer");
  };

  const downloadFile = (entry: FileEntry) => {
    if (entry.kind !== "file") return;
    const link = document.createElement("a");
    link.href = getDownloadUrl(entry);
    link.download = entry.name;
    link.rel = "noreferrer";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const openEntry = (entry: FileEntry) => {
    if (entry.kind === "dir") {
      void loadEntries(entry.path);
      return;
    }
    if (isEditableTextFile(entry)) {
      openTextEditor(entry);
      return;
    }
    if (isDocumentEditorFile(entry)) {
      openDocumentEditor(entry);
      return;
    }
    if (isEditableSpreadsheetFile(entry)) {
      openSpreadsheetEditor(entry);
      return;
    }
    if (isWhiteboardFile(entry)) {
      openWhiteboardEditor(entry);
      return;
    }
    if (isExternallyOpenableFile(entry)) {
      openExternalFile(entry);
      return;
    }
    downloadFile(entry);
  };

  const selectEntry = (entry: FileEntry) => {
    setSelected(entry);
  };

  const loadEntries = async (path = currentPath) => {
    setLoading(true);
    try {
      const data = await apiFetch<{ entries: FileEntry[] }>(
        `/files?path=${encodeURIComponent(path)}`,
      );
      setEntries(data.entries);
      setCurrentPath(path);
      setSelected((prev) => {
        if (!prev) return null;
        return data.entries.find((entry) => entry.id === prev.id) ?? null;
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTree();
    loadEntries("/");
  }, []);

  useEffect(() => {
    if (!selected || selected.kind !== "file" || selectedPreviewKind === "unsupported") {
      setPreviewEntry(selected);
      return;
    }

    setPreviewEntry(null);
    const timer = window.setTimeout(() => {
      setPreviewEntry(selected);
    }, PREVIEW_DELAY_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [selected, selectedPreviewKind]);

  useEffect(() => {
    setMediaPreviewError(false);
  }, [previewEntry?.id]);

  useEffect(() => {
    if (!previewEntry || previewEntry.kind !== "file" || previewKind !== "text") {
      setPreviewText("");
      setTextPreviewStatus("idle");
      return;
    }

    let cancelled = false;
    setTextPreviewStatus("loading");

    loadFileText(previewEntry.path)
      .then((content) => {
        if (cancelled) return;
        setPreviewText(content);
        setTextPreviewStatus("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setPreviewText("预览加载失败");
        setTextPreviewStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [previewEntry, previewKind]);

  useEffect(() => {
    if (!previewEntry || previewEntry.kind !== "file" || previewKind !== "spreadsheet") {
      setSpreadsheetPreview(null);
      setSpreadsheetPreviewStatus("idle");
      return;
    }

    let cancelled = false;
    setSpreadsheetPreviewStatus("loading");

    downloadFileBuffer(previewEntry.id)
      .then((buffer) => {
        if (cancelled) return;
        const workbook = parseSpreadsheetBuffer(buffer, previewEntry.name);
        setSpreadsheetPreview(getSpreadsheetPreview(workbook.sheets[0]));
        setSpreadsheetPreviewStatus("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setSpreadsheetPreview(null);
        setSpreadsheetPreviewStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [previewEntry, previewKind]);

  const refresh = async () => {
    await Promise.all([loadTree(), loadEntries(currentPath)]);
  };

  const submitAction = async () => {
    if (!action) return;
    if (selectedIsDrive && action.type !== "new-folder" && action.type !== "new-text-file") {
      setAction(null);
      return;
    }
    if (action.type === "new-folder") {
      await apiFetch("/files/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parent: currentPath, name: action.value }),
      });
    }
    if (action.type === "new-text-file") {
      const created = await apiFetch<FileEntry>("/files/text-files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parent: currentPath, name: action.value }),
      });
      setAction(null);
      await refresh();
      selectEntry(created);
      return;
    }
    if (action.type === "rename" && selected) {
      await apiFetch(`/files/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: action.value }),
      });
    }
    if (action.type === "move" && selected) {
      await apiFetch("/files/move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entry_id: selected.id,
          destination_dir: action.value,
        }),
      });
    }
    if (action.type === "copy" && selected) {
      await apiFetch("/files/copy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entry_id: selected.id,
          destination_dir: action.value,
        }),
      });
    }
    setAction(null);
    await refresh();
  };

  const deleteSelected = async () => {
    if (!selected || selectedIsDrive) return;
    invalidateFileBufferCache(selected.id);
    invalidateFileTextCache(selected.path);
    await apiFetch(`/files/${selected.id}`, { method: "DELETE" });
    setSelected(null);
    setPreviewEntry(null);
    await refresh();
  };

  const uploadFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = "";
    await uploadRawFile(file);
  };

  const uploadRawFile = async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    await fetch(buildApiUrl(`/files/upload?path=${encodeURIComponent(currentPath)}`), {
      method: "POST",
      body: form,
    });
    await refresh();
  };

  return (
    <div
      ref={containerRef}
      className="relative flex h-full flex-col"
      style={{
        background: "var(--window-content-bg)",
        color: "var(--t1)",
      }}
    >
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={uploadFile}
      />

      <div
        className="flex items-center gap-2 border-b px-4 py-2"
        style={{
          borderColor: "var(--border)",
          background: "var(--panel-bg-soft)",
        }}
      >
        <ActionButton
          icon={<FolderPlus size={13} />}
          label="新建文件夹"
          onClick={() => setAction({ type: "new-folder", value: "" })}
        />
        <ActionButton
          icon={<FileText size={13} />}
          label="新建文本文件"
          onClick={() => setAction({ type: "new-text-file", value: "Untitled.txt" })}
        />
        <ActionButton
          icon={<Upload size={13} />}
          label="上传"
          onClick={() => fileInputRef.current?.click()}
        />
        <ActionButton
          icon={
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          }
          label="刷新"
          onClick={refresh}
        />
        <div className="ml-auto flex items-center gap-2">
          <ActionButton
            icon={<LayoutGrid size={13} />}
            label={viewMode === "grid" ? "网格视图" : "切换网格"}
            onClick={() => setViewMode("grid")}
          />
          <ActionButton
            icon={<List size={13} />}
            label={viewMode === "list" ? "列表视图" : "切换列表"}
            onClick={() => setViewMode("list")}
          />
          {selected && !selectedIsDrive && (
            <>
              {selectedIsEditableText && (
                <ActionButton
                  icon={<FileText size={13} />}
                  label="打开编辑器"
                  onClick={() => openTextEditor(selected)}
                />
              )}
              {isDocumentEditorFile(selected) && (
                <ActionButton
                  icon={<FilePenLine size={13} />}
                  label="打开文档编辑器"
                  onClick={() => openDocumentEditor(selected)}
                />
              )}
              {selectedIsEditableSpreadsheet && (
                <ActionButton
                  icon={<FileSpreadsheet size={13} />}
                  label="打开表格编辑器"
                  onClick={() => openSpreadsheetEditor(selected)}
                />
              )}
              {isWhiteboardFile(selected) && (
                <ActionButton
                  icon={<PenTool size={13} />}
                  label="打开白板"
                  onClick={() => openWhiteboardEditor(selected)}
                />
              )}
              {selectedCanOpenExternally && (
                <ActionButton
                  icon={<ExternalLink size={13} />}
                  label="打开文件"
                  onClick={() => openExternalFile(selected)}
                />
              )}
              {selectedShouldDownloadDirectly && (
                <ActionButton
                  icon={<Download size={13} />}
                  label="下载文件"
                  onClick={() => downloadFile(selected)}
                />
              )}
              <ActionButton
                icon={<Pencil size={13} />}
                label="重命名"
                onClick={() =>
                  setAction({ type: "rename", value: selected.name })
                }
              />
              <ActionButton
                icon={<MoveRight size={13} />}
                label="移动"
                onClick={() => setAction({ type: "move", value: currentPath })}
              />
              <ActionButton
                icon={<Copy size={13} />}
                label="复制"
                onClick={() => setAction({ type: "copy", value: currentPath })}
              />
              <ActionButton
                icon={<Trash2 size={13} />}
                label="删除"
                onClick={deleteSelected}
              />
            </>
          )}
        </div>
      </div>

      <div
        className="border-b px-4 py-2.5"
        style={{
          borderColor: "var(--border)",
          background: "var(--panel-bg)",
        }}
      >
        <div
          className="flex items-center gap-3 overflow-x-auto whitespace-nowrap"
          style={{ scrollbarWidth: "none" }}
        >
          <div
            className="shrink-0 text-[11px] font-medium uppercase tracking-[0.18em]"
            style={{ color: "var(--t3)" }}
          >
            位置
          </div>
          <div
            className="flex min-w-0 items-center gap-1.5 rounded-2xl px-2 py-1"
            style={{
              background: "var(--control-bg)",
              boxShadow: "inset 0 0 0 1px var(--border)",
            }}
          >
            {breadcrumbs.map((item, index) => {
              const isCurrent = item === currentPath;
              return (
                <div key={item} className="flex items-center gap-1.5">
                  {index > 0 && (
                    <ChevronRight
                      size={12}
                      strokeWidth={1.8}
                      style={{ color: "var(--t3)" }}
                    />
                  )}
                  <button
                    onClick={() => loadEntries(item)}
                    className="rounded-full px-2.5 py-1 text-[13px] transition-all"
                    style={{
                      color: isCurrent ? "var(--t1)" : "var(--t2)",
                      background: isCurrent
                        ? "rgba(10, 132, 255, 0.16)"
                        : "transparent",
                      boxShadow: isCurrent
                        ? "inset 0 0 0 1px rgba(10, 132, 255, 0.22)"
                        : "none",
                      fontWeight: isCurrent ? 600 : 500,
                    }}
                  >
                    {getBreadcrumbLabel(item, index, rootName)}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {action && (
        <div
          className="flex items-center gap-2 border-b px-4 py-2 text-[13px]"
          style={{
            borderColor: "var(--border)",
            background: "var(--panel-bg-soft)",
          }}
        >
          <span style={{ color: "var(--t2)", minWidth: 72 }}>
            {action.type === "new-folder" && "新建目录"}
            {action.type === "new-text-file" && "新建文本文件"}
            {action.type === "rename" && "重命名"}
            {action.type === "move" && "移动到"}
            {action.type === "copy" && "复制到"}
          </span>
          <input
            value={action.value}
            onChange={(event) =>
              setAction((prev) =>
                prev ? { ...prev, value: event.target.value } : prev,
              )
            }
            className="flex-1 rounded-lg px-3 py-1.5 outline-none"
            style={{
              background: "var(--input-bg)",
              border: "0.5px solid var(--border)",
              color: "var(--t1)",
            }}
          />
          <ActionButton label="取消" onClick={() => setAction(null)} />
          <ActionButton label="确认" onClick={submitAction} />
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <aside
          className="w-[220px] overflow-y-auto border-r p-3"
          style={{
            borderColor: "var(--border)",
            background: "var(--panel-bg)",
          }}
        >
          <TreeView
            nodes={tree}
            currentPath={currentPath}
            onOpen={loadEntries}
            rootName={rootName}
          />
        </aside>

        <main
          className="min-w-0 flex-1 overflow-y-auto p-3"
          style={{ background: "var(--window-content-bg)" }}
        >
          <div
            className="min-h-full rounded-2xl border p-3"
            style={{
              borderColor: "var(--border)",
              background: "var(--panel-bg-soft)",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
            }}
            onDragOver={(event) => {
              event.preventDefault();
            }}
            onDrop={async (event) => {
              event.preventDefault();
              const file = event.dataTransfer.files?.[0];
              if (file) {
                await uploadRawFile(file);
              }
            }}
          >
            {viewMode === "grid" ? (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
                {entries.map((entry) => (
                  <EntryCard
                    key={entry.id}
                    entry={entry}
                    selected={selected?.id === entry.id}
                    onSelect={selectEntry}
                    onOpen={() => openEntry(entry)}
                    onContext={(x, y) => openContextMenu(x, y, entry)}
                  />
                ))}
              </div>
            ) : (
              <div className="overflow-hidden rounded-xl">
                {entries.map((entry) => (
                  <EntryRow
                    key={entry.id}
                    entry={entry}
                    selected={selected?.id === entry.id}
                    onSelect={selectEntry}
                    onOpen={() => openEntry(entry)}
                    onContext={(x, y) => openContextMenu(x, y, entry)}
                  />
                ))}
              </div>
            )}
          </div>
        </main>

        <aside
          className="w-[300px] overflow-y-auto border-l p-4"
          style={{
            borderColor: "var(--border)",
            background: "var(--panel-bg)",
          }}
        >
          {!selected ? (
            <EmptyPanel text="选择文件或文件夹查看详情" />
          ) : (
            <div className="space-y-4">
              <div>
                <div className="mb-1 text-[16px] font-semibold">
                  {selected.name}
                </div>
                <div className="text-[12px]" style={{ color: "var(--t3)" }}>
                  {selected.path}
                </div>
              </div>

              <div
                className="grid grid-cols-2 gap-2 text-[12px]"
                style={{ color: "var(--t2)" }}
              >
                <InfoCard
                  label="类型"
                  value={getEntryTypeLabel(selected)}
                />
                <InfoCard
                  label="大小"
                  value={
                    selected.kind === "dir" ? "-" : formatSize(selected.size)
                  }
                />
              </div>

              {selected.kind === "file" && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-[12px]" style={{ color: "var(--t2)" }}>
                    <span>预览</span>
                    {selectedPreviewKind !== "unsupported" && !selectedIsEditableText && !selectedIsEditableSpreadsheet && (
                      <a
                        href={selectedDownloadUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 rounded-full px-2 py-1 transition-colors"
                        style={{ background: "var(--control-bg)", color: "var(--t2)" }}
                      >
                        <ExternalLink size={12} />
                        新窗口打开
                      </a>
                    )}
                  </div>

                  {selectedPreviewKind === "image" && (
                    <MediaPreviewShell>
                      {isPreviewPending ? (
                        <PreviewLoading text="正在准备图片预览…" />
                      ) : mediaPreviewError ? (
                        <EmptyPanel text="图片预览加载失败，请尝试在新窗口中打开。" />
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={previewDownloadUrl}
                          alt={selected.name}
                          className="max-h-[360px] w-full object-contain"
                          onError={() => setMediaPreviewError(true)}
                        />
                      )}
                    </MediaPreviewShell>
                  )}

                  {selectedPreviewKind === "pdf" && (
                    <MediaPreviewShell className="overflow-hidden p-0">
                      {isPreviewPending ? (
                        <PreviewLoading text="正在准备 PDF 预览…" />
                      ) : mediaPreviewError ? (
                        <EmptyPanel text="PDF 预览加载失败，请尝试在新窗口中打开。" />
                      ) : (
                        <iframe
                          src={previewDownloadUrl}
                          className="h-[360px] w-full"
                          onError={() => setMediaPreviewError(true)}
                        />
                      )}
                    </MediaPreviewShell>
                  )}

                  {selectedPreviewKind === "audio" && (
                    <MediaPreviewShell>
                      {isPreviewPending ? (
                        <PreviewLoading text="正在准备音频预览…" />
                      ) : mediaPreviewError ? (
                        <EmptyPanel text="音频预览加载失败，请尝试下载后播放。" />
                      ) : (
                        <audio
                          src={previewDownloadUrl}
                          controls
                          className="w-full"
                          onError={() => setMediaPreviewError(true)}
                        />
                      )}
                    </MediaPreviewShell>
                  )}

                  {selectedPreviewKind === "video" && (
                    <MediaPreviewShell className="overflow-hidden p-0">
                      {isPreviewPending ? (
                        <PreviewLoading text="正在准备视频预览…" />
                      ) : mediaPreviewError ? (
                        <EmptyPanel text="视频预览加载失败，请尝试在新窗口中打开。" />
                      ) : (
                        <video
                          src={previewDownloadUrl}
                          controls
                          className="max-h-[360px] w-full bg-black object-contain"
                          onError={() => setMediaPreviewError(true)}
                        />
                      )}
                    </MediaPreviewShell>
                  )}

                  {selectedPreviewKind === "spreadsheet" && (
                    <MediaPreviewShell className="overflow-hidden p-0">
                      {isPreviewPending || spreadsheetPreviewStatus === "loading" ? (
                        <PreviewLoading text="正在加载表格预览…" />
                      ) : spreadsheetPreviewStatus === "error" || !spreadsheetPreview ? (
                        <EmptyPanel text="表格预览加载失败，请尝试打开表格编辑器。" />
                      ) : (
                        <SpreadsheetPreviewTable
                          cells={spreadsheetPreview.cells}
                          totalRows={spreadsheetPreview.totalRows}
                          totalCols={spreadsheetPreview.totalCols}
                        />
                      )}
                    </MediaPreviewShell>
                  )}
                </div>
              )}

              {selectedIsEditableSpreadsheet && (
                <div className="space-y-3">
                  <ActionButton
                    icon={<FileSpreadsheet size={13} />}
                    label="打开表格编辑器"
                    onClick={() => openSpreadsheetEditor(selected)}
                  />
                  <div className="text-[12px]" style={{ color: "var(--t3)" }}>
                    双击文件或点击这里，会在独立窗口里打开这个表格进行编辑和保存。
                  </div>
                </div>
              )}

              {selectedIsEditableText && (
                <div className="space-y-3">
                  <ActionButton
                    icon={<FileText size={13} />}
                    label="打开文本编辑器"
                    onClick={() => openTextEditor(selected)}
                  />
                  <div className="text-[12px]" style={{ color: "var(--t3)" }}>
                    双击文件或点击上方按钮，会像 macOS 一样在独立窗口中编辑这个
                    TXT 文件。
                  </div>
                </div>
              )}

              {isDocumentEditorFile(selected) && (
                <div className="space-y-3">
                  <ActionButton
                    icon={<FilePenLine size={13} />}
                    label="打开文档编辑器"
                    onClick={() => openDocumentEditor(selected)}
                  />
                  <div className="text-[12px]" style={{ color: "var(--t3)" }}>
                    双击文件或点击这里，会在独立窗口中打开这份富文本文档进行编辑和导出。
                  </div>
                </div>
              )}

              {isWhiteboardFile(selected) && (
                <div className="space-y-3">
                  <ActionButton
                    icon={<PenTool size={13} />}
                    label="打开白板"
                    onClick={() => openWhiteboardEditor(selected)}
                  />
                  <div className="text-[12px]" style={{ color: "var(--t3)" }}>
                    双击文件或点击这里，会在独立窗口中打开白板进行拖拽编辑和结构梳理。
                  </div>
                </div>
              )}

              {selectedPreviewKind === "text" && (
                <MediaPreviewShell className="overflow-hidden p-0">
                  {isPreviewPending || textPreviewStatus === "loading" ? (
                    <PreviewLoading text="正在加载文本预览…" />
                  ) : (
                    <pre
                      className="max-h-[360px] overflow-auto px-3 py-3 text-[12px]"
                      style={{
                        background: "#111827",
                        color: "#e5e7eb",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                      }}
                    >
                      {previewText}
                    </pre>
                  )}
                </MediaPreviewShell>
              )}

              {selectedPreviewKind === "unsupported" &&
                selected.kind === "file" && (
                  <div className="space-y-3">
                    <ActionButton
                      icon={<Download size={13} />}
                      label="下载文件"
                      onClick={() => downloadFile(selected)}
                    />
                    <EmptyPanel text="这个文件类型暂不支持内嵌预览，双击或右键打开时会直接下载。" />
                  </div>
                )}
            </div>
          )}
        </aside>
      </div>

      {contextMenu && (
        <div
          className="absolute inset-0 z-50"
          onClick={() => setContextMenu(null)}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setContextMenu(null);
          }}
        >
          <div
            className="absolute w-[160px] rounded-xl p-1.5"
            style={{
              top: contextMenu.y,
              left: contextMenu.x,
              background: "var(--surface-solid)",
              boxShadow: "var(--shadow-window)",
              border: "0.5px solid var(--border)",
            }}
          >
            {(() => {
              const entry = contextMenu.entry;
              // Windows 盘符路径（/C /D /E），只允许打开，不允许重命名/删除等操作
              const isDrive = /^\/[A-Za-z]$/.test(entry.path);
              return (
                <>
                  <ContextMenuButton
                    label={
                      entry.kind === "dir"
                        ? "打开目录"
                        : isEditableTextFile(entry)
                          ? "打开文本编辑器"
                          : isDocumentEditorFile(entry)
                            ? "打开文档编辑器"
                            : isEditableSpreadsheetFile(entry)
                              ? "打开表格编辑器"
                              : isWhiteboardFile(entry)
                                ? "打开白板"
                                : isExternallyOpenableFile(entry)
                                  ? "打开文件"
                                  : "下载文件"
                    }
                    onClick={() => {
                      setSelected(entry);
                      openEntry(entry);
                      setContextMenu(null);
                    }}
                  />
                  {!isDrive && (
                    <>
                      <ContextMenuButton
                        label="重命名"
                        onClick={() => {
                          setSelected(entry);
                          setAction({ type: "rename", value: entry.name });
                          setContextMenu(null);
                        }}
                      />
                      <ContextMenuButton
                        label="复制"
                        onClick={() => {
                          setSelected(entry);
                          setAction({ type: "copy", value: currentPath });
                          setContextMenu(null);
                        }}
                      />
                      <ContextMenuButton
                        label="移动"
                        onClick={() => {
                          setSelected(entry);
                          setAction({ type: "move", value: currentPath });
                          setContextMenu(null);
                        }}
                      />
                      <ContextMenuButton
                        label="删除"
                        danger
                        onClick={async () => {
                          setSelected(entry);
                          invalidateFileBufferCache(entry.id);
                          invalidateFileTextCache(entry.path);
                          await apiFetch(`/files/${entry.id}`, {
                            method: "DELETE",
                          });
                          setContextMenu(null);
                          if (selected?.id === entry.id) setSelected(null);
                          await refresh();
                        }}
                      />
                    </>
                  )}
                </>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}

function ActionButton({
  icon,
  label,
  onClick,
  disabled = false,
}: {
  icon?: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 align-middle text-[13px] leading-none [&_svg]:shrink-0"
      style={{
        background: "var(--control-bg)",
        border: "0.5px solid var(--border)",
        color: "var(--t1)",
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {icon}
      {label}
    </button>
  );
}

function TreeView({
  nodes,
  currentPath,
  onOpen,
  rootName,
}: {
  nodes: TreeNode[];
  currentPath: string;
  onOpen: (path: string) => void;
  rootName: string;
}) {
  return (
    <div className="space-y-1 select-none">
      <button
        onClick={() => onOpen("/")}
        className="flex w-full select-none items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px]"
        style={{
          background:
            currentPath === "/" ? "rgba(10, 132, 255, 0.16)" : "transparent",
          color: currentPath === "/" ? "var(--t1)" : "var(--t2)",
        }}
      >
        <HardDrive size={14} />
        {rootName}
      </button>
      {nodes.map((node) => (
        <TreeNodeItem
          key={node.path}
          node={node}
          currentPath={currentPath}
          onOpen={onOpen}
          depth={0}
        />
      ))}
    </div>
  );
}

function TreeNodeItem({
  node,
  currentPath,
  onOpen,
  depth,
}: {
  node: TreeNode;
  currentPath: string;
  onOpen: (path: string) => void;
  depth: number;
}) {
  return (
    <div>
      <button
        onClick={() => onOpen(node.path)}
        className="flex w-full select-none items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px]"
        style={{
          paddingLeft: 8 + depth * 12,
          background:
            currentPath === node.path ? "rgba(10, 132, 255, 0.16)" : "transparent",
          color: currentPath === node.path ? "var(--t1)" : "var(--t2)",
        }}
      >
        {isDrivePath(node.path) ? <HardDrive size={14} /> : <Folder size={14} />}
        <span className="truncate">{node.name}</span>
      </button>
      {node.children.map((child) => (
        <TreeNodeItem
          key={child.path}
          node={child}
          currentPath={currentPath}
          onOpen={onOpen}
          depth={depth + 1}
        />
      ))}
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="rounded-xl p-2.5"
      style={{
        background: "var(--control-bg)",
        border: "0.5px solid var(--border)",
      }}
    >
      <div style={{ color: "var(--t3)" }}>{label}</div>
      <div className="mt-1 break-all font-medium" style={{ color: "var(--t1)" }}>
        {value}
      </div>
    </div>
  );
}

function EmptyPanel({ text }: { text: string }) {
  return (
    <div
      className="rounded-xl p-4 text-[13px]"
      style={{
        background: "var(--control-bg)",
        border: "0.5px solid var(--border)",
        color: "var(--t3)",
      }}
    >
      {text}
    </div>
  );
}

function MediaPreviewShell({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl border p-3 ${className}`.trim()}
      style={{
        background: "var(--panel-bg-soft)",
        borderColor: "var(--border)",
      }}
    >
      {children}
    </div>
  );
}

function PreviewLoading({ text }: { text: string }) {
  return (
    <div
      className="flex h-[220px] items-center justify-center gap-2 text-[13px]"
      style={{ color: "var(--t3)" }}
    >
      <Loader2 size={15} className="animate-spin" />
      {text}
    </div>
  );
}

function SpreadsheetPreviewTable({
  cells,
  totalRows,
  totalCols,
}: {
  cells: string[][];
  totalRows: number;
  totalCols: number;
}) {
  const visibleRows = cells.length;
  const visibleCols = cells.reduce((max, row) => Math.max(max, row.length), 0);

  return (
    <div className="overflow-auto">
      <table className="min-w-full border-separate border-spacing-0 text-[12px]">
        <thead>
          <tr>
            {Array.from({ length: visibleCols }, (_, colIndex) => (
              <th
                key={colIndex}
                className="border-b border-r px-2 py-2 text-left"
                style={{
                  background: "var(--panel-bg)",
                  borderColor: "var(--border)",
                  color: "var(--t2)",
                }}
              >
                {columnLabel(colIndex)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cells.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, colIndex) => (
                <td
                  key={`${rowIndex}-${colIndex}`}
                  className="max-w-[112px] border-b border-r px-2 py-2 align-top"
                  style={{
                    borderColor: "var(--border)",
                    color: "var(--t1)",
                    background: rowIndex % 2 === 0 ? "var(--surface-solid)" : "var(--panel-bg)",
                    wordBreak: "break-word",
                  }}
                >
                  {cell || " "}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <div
        className="border-t px-3 py-2 text-[12px]"
        style={{ borderColor: "var(--border)", color: "var(--t3)" }}
      >
        已显示 {visibleRows} 行 / {visibleCols} 列，原表共 {totalRows || visibleRows} 行、{totalCols || visibleCols} 列。
      </div>
    </div>
  );
}

function EntryCard({
  entry,
  selected,
  onSelect,
  onOpen,
  onContext,
}: {
  entry: FileEntry;
  selected: boolean;
  onSelect: (entry: FileEntry) => void;
  onOpen: () => void;
  onContext: (x: number, y: number) => void;
}) {
  return (
    <button
      onClick={() => onSelect(entry)}
      onDoubleClick={onOpen}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onContext(event.clientX, event.clientY);
      }}
      className="select-none rounded-xl p-3 text-left transition-colors"
      style={{
        background: selected ? "rgba(10, 132, 255, 0.16)" : "var(--panel-bg)",
        border: selected
          ? "0.5px solid rgba(10, 132, 255, 0.34)"
          : "0.5px solid var(--border)",
        boxShadow: selected
          ? "0 12px 28px rgba(10, 132, 255, 0.12), inset 0 1px 0 rgba(255,255,255,0.06)"
          : "0 8px 20px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.04)",
      }}
    >
      <div
        className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg"
        style={{
          background: "var(--control-bg)",
          color: getEntryAccentColor(entry),
          border: "0.5px solid var(--border)",
        }}
      >
        {getEntryIcon(entry, 18)}
      </div>
      <div className="truncate text-[14px] font-medium">{entry.name}</div>
      <div className="mt-1 text-[12px]" style={{ color: "var(--t3)" }}>
        {entry.kind === "dir" ? getEntryTypeLabel(entry) : formatSize(entry.size)}
      </div>
    </button>
  );
}

function EntryRow({
  entry,
  selected,
  onSelect,
  onOpen,
  onContext,
}: {
  entry: FileEntry;
  selected: boolean;
  onSelect: (entry: FileEntry) => void;
  onOpen: () => void;
  onContext: (x: number, y: number) => void;
}) {
  return (
    <button
      onClick={() => onSelect(entry)}
      onDoubleClick={onOpen}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onContext(event.clientX, event.clientY);
      }}
      className="flex w-full select-none items-center gap-3 border-b px-3 py-2 text-left text-[13px]"
      style={{
        background: selected ? "rgba(10, 132, 255, 0.16)" : "var(--panel-bg)",
        borderColor: "var(--border)",
      }}
    >
      <span style={{ color: getEntryAccentColor(entry) }}>
        {getEntryIcon(entry, 16)}
      </span>
      <span className="flex-1 truncate">{entry.name}</span>
      <span style={{ color: "var(--t3)" }}>
        {entry.kind === "dir" ? getEntryTypeLabel(entry) : formatSize(entry.size)}
      </span>
    </button>
  );
}

function ContextMenuButton({
  label,
  onClick,
  danger = false,
}: {
  label: string;
  onClick: () => void | Promise<void>;
  danger?: boolean;
}) {
  return (
    <button
      onClick={() => void onClick()}
      className="w-full rounded-lg px-3 py-2 text-left text-[13px] transition-colors hover:bg-black/[0.06]"
      style={{ color: danger ? "#ef4444" : "var(--t1)" }}
    >
      {label}
    </button>
  );
}

function formatSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function getBreadcrumbLabel(path: string, index: number, rootName: string) {
  if (index === 0) return rootName;
  const segment = path.split("/").filter(Boolean).at(-1) ?? rootName;
  if (/^[A-Za-z]$/.test(segment)) {
    return `本地磁盘 (${segment.toUpperCase()}:)`;
  }
  return segment;
}

function isPreviewableTextFile(entry: FileEntry | null) {
  if (!entry || entry.kind !== "file") return false;
  const name = entry.name.toLowerCase();
  return Boolean(
    entry.mime_type?.startsWith("text/") ||
    name.endsWith(".md") ||
    name.endsWith(".txt") ||
    name.endsWith(".json"),
  );
}

function isEditableTextFile(entry: FileEntry | null) {
  if (!entry || entry.kind !== "file") return false;
  return entry.name.toLowerCase().endsWith(".txt");
}

function isDocumentEditorFile(entry: FileEntry | null) {
  if (!entry || entry.kind !== "file") return false;
  return entry.name.toLowerCase().endsWith(".aosdoc.html");
}

function isEditableSpreadsheetFile(entry: FileEntry | null) {
  if (!entry || entry.kind !== "file") return false;
  return isSpreadsheetFileName(entry.name);
}

function isWhiteboardFile(entry: FileEntry | null) {
  if (!entry || entry.kind !== "file") return false;
  return entry.name.toLowerCase().endsWith(".whiteboard.json");
}

function isHtmlFile(entry: FileEntry | null) {
  if (!entry || entry.kind !== "file") return false;
  const name = entry.name.toLowerCase();
  return entry.mime_type === "text/html" || name.endsWith(".html") || name.endsWith(".htm");
}

function isImageFile(entry: FileEntry | null) {
  return Boolean(entry?.kind === "file" && entry.mime_type?.startsWith("image/"));
}

function isPdfFile(entry: FileEntry | null) {
  return Boolean(entry?.kind === "file" && entry.mime_type === "application/pdf");
}

function isAudioFile(entry: FileEntry | null) {
  return Boolean(entry?.kind === "file" && entry.mime_type?.startsWith("audio/"));
}

function isVideoFile(entry: FileEntry | null) {
  return Boolean(entry?.kind === "file" && entry.mime_type?.startsWith("video/"));
}

function isDriveEntry(entry: FileEntry | null) {
  if (!entry || entry.kind !== "dir") return false;
  return /^\/[A-Za-z]$/.test(entry.path);
}

function isDrivePath(path: string) {
  return /^\/[A-Za-z]$/.test(path);
}

function getDownloadUrl(entry: FileEntry) {
  return buildApiUrl(`/files/${entry.id}/download`);
}

function getPreviewKind(entry: FileEntry | null) {
  if (!entry || entry.kind !== "file") return "unsupported" as const;
  if (isEditableSpreadsheetFile(entry)) return "spreadsheet" as const;
  if (isPreviewableTextFile(entry)) return "text" as const;
  if (isImageFile(entry)) return "image" as const;
  if (isPdfFile(entry)) return "pdf" as const;
  if (isAudioFile(entry)) return "audio" as const;
  if (isVideoFile(entry)) return "video" as const;
  return "unsupported" as const;
}

function isExternallyOpenableFile(entry: FileEntry | null) {
  if (!entry || entry.kind !== "file") return false;
  if (isHtmlFile(entry)) return true;
  const kind = getPreviewKind(entry);
  return ["image", "pdf", "audio", "video"].includes(kind);
}

function isDirectDownloadFile(entry: FileEntry | null) {
  if (!entry || entry.kind !== "file") return false;
  return getPreviewKind(entry) === "unsupported";
}

function getEntryTypeLabel(entry: FileEntry | null) {
  if (!entry) return "";
  if (isDriveEntry(entry)) return "本地磁盘";
  if (entry.kind === "dir") return "文件夹";
  return getFileVisualMeta(entry).label;
}

function getEntryAccentColor(entry: FileEntry) {
  if (isDriveEntry(entry)) return "#64748b";
  if (entry.kind === "dir") return "#ffb020";
  return getFileVisualMeta(entry).color;
}

function getEntryIcon(entry: FileEntry, size: number) {
  if (isDriveEntry(entry)) return <HardDrive size={size} />;
  if (entry.kind === "dir") return <Folder size={size} />;

  const meta = getFileVisualMeta(entry);
  switch (meta.kind) {
    case "image":
      return <FileImage size={size} />;
    case "document":
      return <FilePenLine size={size} />;
    case "json":
      return <FileJson size={size} />;
    case "code":
      return <FileCode2 size={size} />;
    case "spreadsheet":
      return <FileSpreadsheet size={size} />;
    case "whiteboard":
      return <PenTool size={size} />;
    case "archive":
      return <FileArchive size={size} />;
    case "audio":
      return <FileAudio2 size={size} />;
    case "video":
      return <FileVideo size={size} />;
    case "shortcut":
      return <FileSymlink size={size} />;
    case "config":
      return <FileCog size={size} />;
    default:
      return <FileText size={size} />;
  }
}

function getFileVisualMeta(entry: FileEntry) {
  const ext = entry.name.toLowerCase().split(".").pop() ?? "";
  const mime = entry.mime_type?.toLowerCase() ?? "";

  if (entry.name.toLowerCase().endsWith(".aosdoc.html")) {
    return { kind: "document", color: "#e11d48", label: "富文档" } as const;
  }
  if (entry.name.toLowerCase().endsWith(".whiteboard.json")) {
    return { kind: "whiteboard", color: "#7c3aed", label: "白板文件" } as const;
  }

  if (["lnk", "url"].includes(ext)) {
    return { kind: "shortcut", color: "#8b5cf6", label: "快捷方式" } as const;
  }
  if (mime.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "ico"].includes(ext)) {
    return { kind: "image", color: "#0ea5e9", label: "图片" } as const;
  }
  if (mime === "application/pdf" || ext === "pdf") {
    return { kind: "text", color: "#ef4444", label: "PDF 文档" } as const;
  }
  if (
    ["ppt", "pptx", "pps", "ppsx", "key"].includes(ext) ||
    mime.includes("presentationml.presentation") ||
    mime.includes("ms-powerpoint") ||
    mime.includes("presentation")
  ) {
    return { kind: "text", color: "#f97316", label: "演示文稿" } as const;
  }
  if (
    ["doc", "docx", "rtf", "odt", "pages"].includes(ext) ||
    mime.includes("wordprocessingml.document") ||
    mime.includes("msword") ||
    mime.includes("rtf")
  ) {
    return { kind: "text", color: "#2563eb", label: "文档" } as const;
  }
  if (mime.startsWith("audio/") || ["mp3", "wav", "flac", "aac", "ogg", "m4a"].includes(ext)) {
    return { kind: "audio", color: "#f59e0b", label: "音频" } as const;
  }
  if (mime.startsWith("video/") || ["mp4", "mov", "avi", "mkv", "webm"].includes(ext)) {
    return { kind: "video", color: "#f97316", label: "视频" } as const;
  }
  if (["xls", "xlsx", "csv"].includes(ext)) {
    return { kind: "spreadsheet", color: "#22c55e", label: "表格" } as const;
  }
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) {
    return { kind: "archive", color: "#a16207", label: "压缩包" } as const;
  }
  if (ext === "json" || mime.includes("json")) {
    return { kind: "json", color: "#06b6d4", label: "JSON 文件" } as const;
  }
  if (["js", "jsx", "ts", "tsx", "py", "java", "go", "rs", "html", "css", "scss", "vue", "sql", "sh", "bat", "ps1"].includes(ext)) {
    return { kind: "code", color: "#6366f1", label: "代码文件" } as const;
  }
  if (["ini", "cfg", "conf", "yaml", "yml", "toml", "env"].includes(ext)) {
    return { kind: "config", color: "#64748b", label: "配置文件" } as const;
  }
  if (["txt", "md", "log"].includes(ext) || mime.startsWith("text/")) {
    return { kind: "text", color: "#38bdf8", label: "文本文件" } as const;
  }

  return {
    kind: "text",
    color: "#38bdf8",
    label: entry.mime_type || "文件",
  } as const;
}
