"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  FilePlus2,
  Grip,
  Loader2,
  Minus,
  Plus,
  Save,
  Sparkles,
  Square,
  StickyNote,
  Trash2,
  Type,
} from "lucide-react";

import { apiFetch, completeOnce } from "@/lib/backend";

interface FileEntry {
  id: string;
  name: string;
  path: string;
  kind: "file" | "dir";
}

type BoardNodeKind = "sticky" | "text" | "box";

interface BoardNode {
  id: string;
  kind: BoardNodeKind;
  title: string;
  body: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
}

interface BoardLink {
  id: string;
  from: string;
  to: string;
  label?: string;
}

interface WhiteboardData {
  name: string;
  nodes: BoardNode[];
  links: BoardLink[];
}

interface WhiteboardLayoutPayload {
  nodes?: Array<Partial<BoardNode>>;
  links?: Array<{ from?: string; to?: string; label?: string }>;
}

interface WhiteboardAppProps {
  appState?: Record<string, unknown>;
  windowId: string;
}

const BOARD_PATH = "/Whiteboards";
const BOARD_EXT = ".whiteboard.json";
const CANVAS_WIDTH = 1800;
const CANVAS_HEIGHT = 1400;
const MIN_ZOOM = 0.45;
const MAX_ZOOM = 1.8;
const FIT_PADDING = 96;

function createId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function sanitizeName(value: string) {
  return (
    value
      .trim()
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "whiteboard"
  );
}

function createBlankBoard(name = "新白板"): WhiteboardData {
  return {
    name,
    nodes: [
      {
        id: createId("node"),
        kind: "sticky",
        title: "开始",
        body: "双击节点文字即可编辑，按住节点任意空白区域就能直接拖动。",
        x: 120,
        y: 120,
        w: 240,
        h: 150,
        color: "#fde68a",
      },
    ],
    links: [],
  };
}

export function WhiteboardApp({ appState }: WhiteboardAppProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const zoomRef = useRef(1);
  const requestedFilePath = typeof appState?.filePath === "string" ? appState.filePath : "";
  const dragStateRef = useRef<{
    id: string;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  const [boards, setBoards] = useState<FileEntry[]>([]);
  const [activePath, setActivePath] = useState("");
  const [board, setBoard] = useState<WhiteboardData>(createBlankBoard());
  const [boardName, setBoardName] = useState("新白板");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState("");
  const [zoom, setZoom] = useState(1);
  const [renamingEntryId, setRenamingEntryId] = useState("");
  const [renameDraft, setRenameDraft] = useState("");
  const [deleteCandidateId, setDeleteCandidateId] = useState("");
  const [editingTarget, setEditingTarget] = useState<{
    nodeId: string;
    field: "title" | "body";
  } | null>(null);

  const selectedNode = useMemo(
    () => board.nodes.find((node) => node.id === selectedNodeId) || null,
    [board.nodes, selectedNodeId],
  );
  const activeEntry = useMemo(
    () => boards.find((entry) => entry.path === activePath) || null,
    [activePath, boards],
  );

  const boardLinks = useMemo(() => {
    return board.links
      .map((link) => {
        const from = board.nodes.find((node) => node.id === link.from);
        const to = board.nodes.find((node) => node.id === link.to);
        if (!from || !to) return null;
        return {
          ...link,
          x1: from.x + from.w / 2,
          y1: from.y + from.h / 2,
          x2: to.x + to.w / 2,
          y2: to.y + to.h / 2,
        };
      })
      .filter(Boolean) as Array<BoardLink & { x1: number; y1: number; x2: number; y2: number }>;
  }, [board.links, board.nodes]);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  useEffect(() => {
    if (!statusText) return;

    const timer = window.setTimeout(() => {
      setStatusText("");
    }, 3200);

    return () => {
      window.clearTimeout(timer);
    };
  }, [statusText]);

  const fitBoardToView = (targetBoard: WhiteboardData) => {
    const viewport = viewportRef.current;
    if (!viewport || targetBoard.nodes.length === 0) return;

    const bounds = getBoardBounds(targetBoard.nodes);
    const availableWidth = Math.max(240, viewport.clientWidth - 24);
    const availableHeight = Math.max(240, viewport.clientHeight - 24);
    const nextZoom = clampZoom(
      Math.min(
        availableWidth / (bounds.width + FIT_PADDING * 2),
        availableHeight / (bounds.height + FIT_PADDING * 2),
        1,
      ),
    );

    setZoom(nextZoom);
    requestAnimationFrame(() => {
      const horizontalPadding = Math.max((viewport.clientWidth - bounds.width * nextZoom) / 2, 24);
      const verticalPadding = Math.max((viewport.clientHeight - bounds.height * nextZoom) / 2, 24);
      viewport.scrollLeft = Math.max(0, bounds.minX * nextZoom - horizontalPadding);
      viewport.scrollTop = Math.max(0, bounds.minY * nextZoom - verticalPadding);
    });
  };

  const applyZoom = (nextZoom: number) => {
    const viewport = viewportRef.current;
    const clamped = clampZoom(nextZoom);
    if (!viewport) {
      setZoom(clamped);
      return;
    }

    const centerX = (viewport.scrollLeft + viewport.clientWidth / 2) / zoomRef.current;
    const centerY = (viewport.scrollTop + viewport.clientHeight / 2) / zoomRef.current;

    setZoom(clamped);
    requestAnimationFrame(() => {
      viewport.scrollLeft = Math.max(0, centerX * clamped - viewport.clientWidth / 2);
      viewport.scrollTop = Math.max(0, centerY * clamped - viewport.clientHeight / 2);
    });
  };

  const focusEditor = (nodeId: string, field: "title" | "body") => {
    requestAnimationFrame(() => {
      const element = viewportRef.current?.querySelector<HTMLElement>(
        `[data-edit-node="${nodeId}"][data-edit-field="${field}"]`,
      );
      if (!element) return;
      element.focus();
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(element);
      range.collapse(false);
      selection?.removeAllRanges();
      selection?.addRange(range);
    });
  };

  const beginEditing = (nodeId: string, field: "title" | "body") => {
    setSelectedNodeId(nodeId);
    setEditingTarget({ nodeId, field });
    focusEditor(nodeId, field);
  };

  const handleNodeTextMouseDown = (
    event: React.MouseEvent<HTMLDivElement>,
    nodeId: string,
    isEditing: boolean,
  ) => {
    event.stopPropagation();
    setSelectedNodeId(nodeId);
    if (!isEditing) {
      event.preventDefault();
    }
  };

  const loadBoards = async (preferredPath?: string) => {
    const response = await apiFetch<{ entries: FileEntry[] }>(
      `/files?path=${encodeURIComponent(BOARD_PATH)}`,
    );
    const nextBoards = response.entries.filter(
      (entry) => entry.kind === "file" && entry.name.endsWith(BOARD_EXT),
    );
    setBoards(nextBoards);

    const targetPath =
      preferredPath && nextBoards.some((entry) => entry.path === preferredPath)
        ? preferredPath
        : nextBoards[0]?.path;

    if (!activePath && targetPath) {
      await openBoard(targetPath);
    }
  };

  const openBoard = async (path: string) => {
    setLoading(true);
    try {
      const data = await apiFetch<{ content: string }>(
        `/files/content?path=${encodeURIComponent(path)}`,
      );
      const parsed = JSON.parse(data.content) as WhiteboardData;
      setBoard(parsed);
      setBoardName(parsed.name || path.split("/").pop()?.replace(BOARD_EXT, "") || "白板");
      setActivePath(path);
      setSelectedNodeId(parsed.nodes[0]?.id || "");
      setEditingTarget(null);
      setStatusText("");
      requestAnimationFrame(() => {
        fitBoardToView(parsed);
      });
    } catch {
      setStatusText("白板读取失败。");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBoards(requestedFilePath || undefined).catch(() => {
      setStatusText("白板目录读取失败。");
    });
  }, [requestedFilePath]);

  useEffect(() => {
    if (!requestedFilePath || requestedFilePath === activePath) return;
    void openBoard(requestedFilePath).catch(() => {
      setStatusText("指定白板打开失败。");
    });
  }, [activePath, requestedFilePath]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;

      const target = event.target;
      if (!(target instanceof Node) || !viewport.contains(target)) return;

      event.preventDefault();
      event.stopPropagation();

      const direction = Math.sign(-event.deltaY);
      if (!direction) return;

      applyZoom(zoomRef.current + direction * 0.1);
    };

    viewport.addEventListener("wheel", handleWheel, { passive: false, capture: true });
    return () => {
      viewport.removeEventListener("wheel", handleWheel, { capture: true });
    };
  }, []);

  useEffect(() => {
    const move = (event: MouseEvent) => {
      const state = dragStateRef.current;
      if (!state) return;
      const deltaX = (event.clientX - state.startX) / zoomRef.current;
      const deltaY = (event.clientY - state.startY) / zoomRef.current;
      setBoard((prev) => ({
        ...prev,
        nodes: prev.nodes.map((node) =>
          node.id === state.id
            ? {
                ...node,
                x: state.originX + deltaX,
                y: state.originY + deltaY,
              }
            : node,
        ),
      }));
    };

    const up = () => {
      dragStateRef.current = null;
    };

    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, []);

  const persistBoard = async (nextBoard?: WhiteboardData, nextPath?: string) => {
    const targetBoard = {
      ...(nextBoard || board),
      name: boardName || nextBoard?.name || board.name || "新白板",
    };
    const path = nextPath || activePath || `${BOARD_PATH}/${sanitizeName(boardName)}${BOARD_EXT}`;
    setSaving(true);
    try {
      await apiFetch("/files/content", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path,
          content: JSON.stringify(targetBoard, null, 2),
          mime_type: "application/json",
        }),
      });
      setBoard(targetBoard);
      setActivePath(path);
      await loadBoards(path);
      setStatusText("白板已保存。");
    } catch {
      setStatusText("白板保存失败。");
    } finally {
      setSaving(false);
    }
  };

  const createBoard = async () => {
    const next = createBlankBoard(boardName || "新白板");
    setBoard(next);
    setSelectedNodeId(next.nodes[0]?.id || "");
    setEditingTarget(null);
    requestAnimationFrame(() => {
      fitBoardToView(next);
    });
    const path = `${BOARD_PATH}/${sanitizeName(boardName || "新白板")}${BOARD_EXT}`;
    await persistBoard(next, path);
  };

  const renameBoard = async (entry: FileEntry, nextName: string) => {
    if (!entry) {
      setStatusText("请先打开一张已保存的白板。");
      return;
    }

    const trimmedName = nextName.trim() || entry.name.replace(BOARD_EXT, "") || "新白板";
    const nextFileName = `${sanitizeName(trimmedName)}${BOARD_EXT}`;

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

      let baseBoard = board;
      if (entry.path !== activePath) {
        const data = await apiFetch<{ content: string }>(
          `/files/content?path=${encodeURIComponent(entry.path)}`,
        );
        baseBoard = JSON.parse(data.content) as WhiteboardData;
      }

      const nextBoard = { ...baseBoard, name: trimmedName };
      await apiFetch("/files/content", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: renamedEntry.path,
          content: JSON.stringify(nextBoard, null, 2),
          mime_type: "application/json",
        }),
      });

      if (entry.path === activePath) {
        setBoard(nextBoard);
        setBoardName(trimmedName);
        setActivePath(renamedEntry.path);
      }

      setRenamingEntryId("");
      setRenameDraft("");
      await loadBoards(renamedEntry.path);
      setStatusText("白板已重命名。");
    } catch {
      setStatusText("白板重命名失败。");
    } finally {
      setSaving(false);
    }
  };

  const deleteBoard = async (entry: FileEntry) => {
    if (!entry) {
      setStatusText("请先打开一张已保存的白板。");
      return;
    }

    setSaving(true);
    try {
      await apiFetch<{ status: string }>(`/files/${entry.id}`, { method: "DELETE" });

      const remainingBoards = boards.filter((item) => item.id !== entry.id);
      const nextEntry = remainingBoards[0] || null;

      setBoards(remainingBoards);

      if (nextEntry) {
        await openBoard(nextEntry.path);
        await loadBoards(nextEntry.path);
      } else {
        const nextBoard = createBlankBoard();
        setBoard(nextBoard);
        setBoardName(nextBoard.name);
        setActivePath("");
        setSelectedNodeId(nextBoard.nodes[0]?.id || "");
        setEditingTarget(null);
        requestAnimationFrame(() => {
          fitBoardToView(nextBoard);
        });
      }

      setDeleteCandidateId("");
      setStatusText("白板已删除。");
    } catch {
      setStatusText("白板删除失败。");
    } finally {
      setSaving(false);
    }
  };

  const startRenameBoard = (entry: FileEntry) => {
    setDeleteCandidateId("");
    setRenamingEntryId(entry.id);
    setRenameDraft(entry.name.replace(BOARD_EXT, ""));
  };

  const cancelRenameBoard = () => {
    setRenamingEntryId("");
    setRenameDraft("");
  };

  const requestDeleteBoard = (entry: FileEntry) => {
    setRenamingEntryId("");
    setRenameDraft("");
    setDeleteCandidateId(entry.id);
  };

  const cancelDeleteBoard = () => {
    setDeleteCandidateId("");
  };

  const addNode = (kind: BoardNodeKind) => {
    const color = kind === "sticky" ? "#fde68a" : kind === "box" ? "#bfdbfe" : "#e2e8f0";
    const nextNode: BoardNode = {
      id: createId("node"),
      kind,
      title: kind === "sticky" ? "便签" : kind === "box" ? "模块" : "文本",
      body: kind === "text" ? "输入说明文字" : "双击这里编辑内容",
      x: 180 + board.nodes.length * 26,
      y: 140 + board.nodes.length * 22,
      w: kind === "text" ? 240 : 220,
      h: kind === "text" ? 110 : 140,
      color,
    };
    setBoard((prev) => ({ ...prev, nodes: [...prev.nodes, nextNode] }));
    setSelectedNodeId(nextNode.id);
    setEditingTarget(null);
  };

  const updateSelectedNode = (patch: Partial<BoardNode>) => {
    if (!selectedNodeId) return;
    setBoard((prev) => ({
      ...prev,
      nodes: prev.nodes.map((node) => (node.id === selectedNodeId ? { ...node, ...patch } : node)),
    }));
  };

  const deleteSelectedNode = () => {
    if (!selectedNodeId) return;

    setBoard((prev) => {
      const nextNodes = prev.nodes.filter((node) => node.id !== selectedNodeId);
      const nextLinks = prev.links.filter(
        (link) => link.from !== selectedNodeId && link.to !== selectedNodeId,
      );
      return {
        ...prev,
        nodes: nextNodes,
        links: nextLinks,
      };
    });

    setSelectedNodeId("");
    setEditingTarget(null);
    setStatusText("已删除当前节点。");
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!selectedNodeId || editingTarget) return;

      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }

      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        deleteSelectedNode();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [deleteSelectedNode, editingTarget, selectedNodeId]);

  const runAiLayout = async () => {
    if (!aiPrompt.trim()) {
      setStatusText("请先输入你想生成的图解说明。");
      return;
    }

    setAiBusy(true);
    setStatusText("");
    try {
      const result = await completeOnce(
        `请把下面的需求转成白板结构图 JSON，格式必须是 {"nodes":[...],"links":[...]}。每个 node 包含 title、body、kind(sticky|box|text)、color；每个 link 包含 from、to、label。不要输出解释。\n\n需求：${aiPrompt}`,
        "你是白板图解助手。只输出 JSON，不要 markdown。",
      );

      const parsed = parseWhiteboardLayout(result.content);
      const laidOutNodes = (parsed.nodes || []).map((node, index) => ({
        id: createId("node"),
        kind: normalizeBoardNodeKind(node.kind),
        title: node.title || `节点 ${index + 1}`,
        body: node.body || "",
        x: 120 + (index % 3) * 280,
        y: 120 + Math.floor(index / 3) * 220,
        w: node.w || 220,
        h: node.h || 140,
        color: node.color || (index % 2 === 0 ? "#bfdbfe" : "#fde68a"),
      }));

      if (laidOutNodes.length === 0) {
        throw new Error("empty-layout");
      }

      const titleMap = new Map(laidOutNodes.map((node) => [node.title, node.id]));
      const links = (parsed.links || [])
        .map((link) => ({
          id: createId("link"),
          from: titleMap.get(link.from || "") || link.from || "",
          to: titleMap.get(link.to || "") || link.to || "",
          label: link.label || "",
        }))
        .filter((link) => Boolean(link.from && link.to));

      const nextBoard = {
        name: boardName,
        nodes: laidOutNodes,
        links,
      };

      setBoard(nextBoard);
      setSelectedNodeId(laidOutNodes[0]?.id || "");
      setEditingTarget(null);
      setAiPrompt("");
      setStatusText("智能助手已生成白板结构。");
      requestAnimationFrame(() => {
        fitBoardToView(nextBoard);
      });
    } catch {
      setStatusText("智能白板生成失败，请尝试把需求写得更具体一些。");
    } finally {
      setAiBusy(false);
    }
  };

  return (
    <div
      data-testid="whiteboard-macos-shell"
      data-desktop-blocker="true"
      className="flex h-full min-w-0 overflow-hidden"
      style={{
        color: "var(--t1)",
        background:
          "linear-gradient(180deg, rgba(247,247,249,0.96), rgba(239,240,244,0.98))",
      }}
    >
      <aside
        data-testid="whiteboard-sidebar"
        className="flex w-[270px] shrink-0 flex-col border-r px-3 py-3"
        style={{
          borderColor: "rgba(0,0,0,0.08)",
          background: "rgba(237,238,242,0.74)",
          backdropFilter: "blur(28px) saturate(170%)",
          WebkitBackdropFilter: "blur(28px) saturate(170%)",
        }}
      >
        <div className="text-[12px] font-medium" style={{ color: "#7c3aed" }}>
          创意画布
        </div>
        <div className="mt-1 text-[24px] font-semibold">白板</div>
        <p className="mt-2 text-[12px] leading-6" style={{ color: "var(--t3)" }}>
          节点支持整块拖拽、双击编辑、画布缩放和智能结构生成，适合快速整理思路。
        </p>

        <div className="mt-4 flex items-center gap-2">
          <input
            value={boardName}
            onChange={(event) => setBoardName(event.target.value)}
            className="min-w-0 flex-1 rounded-2xl border px-3 py-2 text-[13px] outline-none"
            style={{ borderColor: "rgba(15,23,42,0.08)", background: "rgba(248,250,252,0.92)" }}
          />
          <button
            onClick={() => void createBoard()}
            aria-label="新建白板"
            className="inline-flex h-9 w-9 items-center justify-center rounded-[9px]"
            style={{
              border: "0.5px solid rgba(0,0,0,0.08)",
              background: "rgba(255,255,255,0.66)",
              color: "var(--t2)",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.58)",
            }}
            title="新建白板"
          >
            <FilePlus2 size={16} />
          </button>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <IconPill icon={<StickyNote size={14} />} label="便签" onClick={() => addNode("sticky")} />
          <IconPill icon={<Square size={14} />} label="模块" onClick={() => addNode("box")} />
          <IconPill icon={<Type size={14} />} label="文本" onClick={() => addNode("text")} />
          <IconPill
            icon={saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            label="保存"
            onClick={() => void persistBoard()}
            disabled={saving}
          />
        </div>

        <div className="mt-5 text-[12px] font-medium" style={{ color: "#64748b" }}>
          白板列表
        </div>
        <div className="mt-3 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
          {boards.length === 0 ? (
            <div
              className="rounded-[24px] border border-dashed px-4 py-5 text-[13px] leading-6"
              style={{ borderColor: "rgba(15,23,42,0.1)", color: "var(--t3)" }}
            >
              还没有白板文件。点上方加号即可创建第一张。
            </div>
          ) : (
            boards.map((entry) => (
              <div
                key={entry.id}
                className="rounded-[22px] border px-4 py-3"
                style={{
                  borderColor:
                    entry.path === activePath ? "rgba(124,58,237,0.22)" : "rgba(15,23,42,0.08)",
                  background:
                    entry.path === activePath
                      ? "linear-gradient(135deg, rgba(167,139,250,0.12), rgba(255,255,255,0.96))"
                      : "rgba(248,250,252,0.9)",
                }}
              >
                <button
                  onClick={() => void openBoard(entry.path)}
                  className="block w-full text-left"
                >
                  <div className="truncate text-[14px] font-semibold">
                    {entry.name.replace(BOARD_EXT, "")}
                  </div>
                  <div className="mt-1 truncate text-[12px]" style={{ color: "var(--t3)" }}>
                    白板目录 / {entry.name.replace(BOARD_EXT, "")}
                  </div>
                </button>
                {renamingEntryId === entry.id ? (
                  <div className="mt-3 grid gap-2">
                    <input
                      value={renameDraft}
                      onChange={(event) => setRenameDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void renameBoard(entry, renameDraft);
                        }
                        if (event.key === "Escape") {
                          event.preventDefault();
                          cancelRenameBoard();
                        }
                      }}
                      autoFocus
                      className="w-full rounded-2xl border px-3 py-2 text-[12px] outline-none"
                      style={{ borderColor: "rgba(124,58,237,0.18)", background: "rgba(255,255,255,0.92)" }}
                    />
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => void renameBoard(entry, renameDraft)}
                        disabled={saving || !renameDraft.trim()}
                        className="rounded-full border px-3 py-1.5 text-[12px] font-medium disabled:cursor-not-allowed disabled:opacity-55"
                        style={{ borderColor: "rgba(15,23,42,0.08)", background: "rgba(255,255,255,0.88)" }}
                      >
                        确认
                      </button>
                      <button
                        onClick={cancelRenameBoard}
                        disabled={saving}
                        className="rounded-full border px-3 py-1.5 text-[12px] font-medium disabled:cursor-not-allowed disabled:opacity-55"
                        style={{ borderColor: "rgba(15,23,42,0.08)", background: "rgba(255,255,255,0.88)" }}
                      >
                        取消
                      </button>
                    </div>
                  </div>
                ) : deleteCandidateId === entry.id ? (
                  <div
                    className="mt-3 rounded-2xl border px-3 py-3"
                    style={{ borderColor: "rgba(220,38,38,0.14)", background: "rgba(255,255,255,0.92)" }}
                  >
                    <div className="text-[12px] leading-5" style={{ color: "var(--t2)" }}>
                      确认删除“{entry.name.replace(BOARD_EXT, "")}”吗？
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        onClick={() => void deleteBoard(entry)}
                        disabled={saving}
                        className="rounded-full border px-3 py-1.5 text-[12px] font-medium text-[#dc2626] disabled:cursor-not-allowed disabled:opacity-55"
                        style={{ borderColor: "rgba(220,38,38,0.14)", background: "rgba(255,255,255,0.88)" }}
                      >
                        确认删除
                      </button>
                      <button
                        onClick={cancelDeleteBoard}
                        disabled={saving}
                        className="rounded-full border px-3 py-1.5 text-[12px] font-medium disabled:cursor-not-allowed disabled:opacity-55"
                        style={{ borderColor: "rgba(15,23,42,0.08)", background: "rgba(255,255,255,0.88)" }}
                      >
                        取消
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 flex items-center gap-2">
                    <button
                      onClick={() => startRenameBoard(entry)}
                      disabled={saving}
                      className="rounded-full border px-3 py-1.5 text-[12px] font-medium disabled:cursor-not-allowed disabled:opacity-55"
                      style={{ borderColor: "rgba(15,23,42,0.08)", background: "rgba(255,255,255,0.88)" }}
                    >
                      重命名
                    </button>
                    <button
                      onClick={() => requestDeleteBoard(entry)}
                      disabled={saving}
                      className="rounded-full border px-3 py-1.5 text-[12px] font-medium text-[#dc2626] disabled:cursor-not-allowed disabled:opacity-55"
                      style={{ borderColor: "rgba(220,38,38,0.14)", background: "rgba(255,255,255,0.88)" }}
                    >
                      删除
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </aside>

      <section className="flex min-w-0 flex-1">
        <div className="min-w-0 flex-1 px-5 py-4">
          <div className="relative h-full">
            <div className="pointer-events-none absolute right-4 top-4 z-20 flex items-center gap-2">
              <div
                className="pointer-events-auto inline-flex items-center gap-2 rounded-full border px-2 py-2"
                style={{ borderColor: "rgba(15,23,42,0.08)", background: "rgba(255,255,255,0.92)" }}
              >
                <button className="rounded-full p-1" onClick={() => applyZoom(zoom - 0.1)}>
                  <Minus size={14} />
                </button>
                <span className="min-w-[54px] text-center text-[12px] font-medium">
                  {Math.round(zoom * 100)}%
                </span>
                <button className="rounded-full p-1" onClick={() => applyZoom(zoom + 0.1)}>
                  <Plus size={14} />
                </button>
              </div>
              <button
                className="pointer-events-auto rounded-full border px-3 py-2 text-[12px] font-medium"
                style={{ borderColor: "rgba(15,23,42,0.08)", background: "rgba(255,255,255,0.92)" }}
                onClick={() => fitBoardToView(board)}
              >
                适配画布
              </button>
            </div>
            <div
              ref={viewportRef}
              className="relative h-full overflow-auto rounded-[14px] border"
              style={{
                borderColor: "rgba(0,0,0,0.08)",
                background:
                  "linear-gradient(0deg, rgba(248,250,252,0.98), rgba(255,255,255,0.98)), radial-gradient(rgba(148,163,184,0.22) 1px, transparent 1px)",
                backgroundSize: "100% 100%, 24px 24px",
              }}
              onMouseDown={() => {
                setSelectedNodeId("");
                setEditingTarget(null);
              }}
            >

            {loading ? (
              <div className="flex h-full items-center justify-center gap-3 text-[14px]" style={{ color: "var(--t3)" }}>
                <Loader2 size={18} className="animate-spin" />
                正在读取白板...
              </div>
            ) : (
              <div style={{ width: CANVAS_WIDTH * zoom, height: CANVAS_HEIGHT * zoom }}>
                <div
                  className="relative"
                  style={{
                    width: CANVAS_WIDTH,
                    height: CANVAS_HEIGHT,
                    transform: `scale(${zoom})`,
                    transformOrigin: "top left",
                  }}
                >
                  <svg className="pointer-events-none absolute inset-0 h-full w-full">
                    {boardLinks.map((link) => (
                      <g key={link.id}>
                        <line
                          x1={link.x1}
                          y1={link.y1}
                          x2={link.x2}
                          y2={link.y2}
                          stroke="#8b5cf6"
                          strokeWidth="2.4"
                          strokeLinecap="round"
                        />
                        {link.label && (
                          <text
                            x={(link.x1 + link.x2) / 2}
                            y={(link.y1 + link.y2) / 2 - 6}
                            textAnchor="middle"
                            fill="#6d28d9"
                            fontSize="12"
                          >
                            {link.label}
                          </text>
                        )}
                      </g>
                    ))}
                  </svg>

                  {board.nodes.map((node) => {
                    const isEditingTitle =
                      editingTarget?.nodeId === node.id && editingTarget.field === "title";
                    const isEditingBody =
                      editingTarget?.nodeId === node.id && editingTarget.field === "body";
                    return (
                      <div
                        key={node.id}
                        className="absolute rounded-[24px] border p-3 shadow-lg transition-shadow"
                        style={{
                          left: node.x,
                          top: node.y,
                          width: node.w,
                          minHeight: node.h,
                          borderColor:
                            selectedNodeId === node.id ? "rgba(124,58,237,0.35)" : "rgba(15,23,42,0.08)",
                          background: node.color,
                          color: "#1f2937",
                          cursor: isEditingTitle || isEditingBody ? "text" : "grab",
                          boxShadow:
                            selectedNodeId === node.id
                              ? "0 18px 36px rgba(124,58,237,0.18)"
                              : "0 12px 30px rgba(15,23,42,0.08)",
                        }}
                        onMouseDown={(event) => {
                          if ((event.target as HTMLElement).closest("[data-node-editor='true']")) {
                            return;
                          }
                          if (event.button !== 0) return;
                          event.stopPropagation();
                          setSelectedNodeId(node.id);
                          setEditingTarget(null);
                          dragStateRef.current = {
                            id: node.id,
                            startX: event.clientX,
                            startY: event.clientY,
                            originX: node.x,
                            originY: node.y,
                          };
                        }}
                      >
                        <div
                          className="flex items-center gap-2 text-[12px] font-medium"
                          style={{ color: "rgba(31,41,55,0.68)" }}
                        >
                          <Grip size={12} />
                          {node.kind === "sticky" ? "便签" : node.kind === "box" ? "模块" : "文本"}
                        </div>

                        <div
                          data-node-editor="true"
                          data-edit-node={node.id}
                          data-edit-field="title"
                          className="mt-2 text-[15px] font-semibold outline-none"
                          contentEditable={isEditingTitle}
                          suppressContentEditableWarning
                          style={{ userSelect: isEditingTitle ? "text" : "none", cursor: "text" }}
                          onMouseDown={(event) => handleNodeTextMouseDown(event, node.id, isEditingTitle)}
                          onDoubleClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            beginEditing(node.id, "title");
                          }}
                          onBlur={() => {
                            if (isEditingTitle) {
                              setEditingTarget(null);
                            }
                          }}
                          onInput={(event) => {
                            const text = (event.target as HTMLDivElement).innerText;
                            setBoard((prev) => ({
                              ...prev,
                              nodes: prev.nodes.map((item) =>
                                item.id === node.id ? { ...item, title: text } : item,
                              ),
                            }));
                          }}
                        >
                          {node.title}
                        </div>

                        <div
                          data-node-editor="true"
                          data-edit-node={node.id}
                          data-edit-field="body"
                          className="mt-2 whitespace-pre-wrap text-[13px] leading-6 outline-none"
                          contentEditable={isEditingBody}
                          suppressContentEditableWarning
                          style={{ userSelect: isEditingBody ? "text" : "none", cursor: "text" }}
                          onMouseDown={(event) => handleNodeTextMouseDown(event, node.id, isEditingBody)}
                          onDoubleClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            beginEditing(node.id, "body");
                          }}
                          onBlur={() => {
                            if (isEditingBody) {
                              setEditingTarget(null);
                            }
                          }}
                          onInput={(event) => {
                            const text = (event.target as HTMLDivElement).innerText;
                            setBoard((prev) => ({
                              ...prev,
                              nodes: prev.nodes.map((item) =>
                                item.id === node.id ? { ...item, body: text } : item,
                              ),
                            }));
                          }}
                        >
                          {node.body}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            </div>
          </div>
        </div>

        <aside
          className="flex w-[320px] shrink-0 flex-col border-l px-4 py-4"
          style={{ borderColor: "rgba(15,23,42,0.08)", background: "rgba(255,255,255,0.78)" }}
        >
          <div className="text-[12px] font-medium" style={{ color: "#7c3aed" }}>
            智能生成
          </div>
          <div className="mt-2 text-[18px] font-semibold">自然语言生成</div>
          <textarea
            value={aiPrompt}
            onChange={(event) => setAiPrompt(event.target.value)}
            className="mt-4 min-h-[160px] rounded-[24px] border px-4 py-4 text-[13px] outline-none"
            style={{ borderColor: "rgba(15,23,42,0.08)", background: "rgba(248,250,252,0.92)" }}
            placeholder="例如：帮我画一张阶段五办公套件的能力结构图，包含文档、表格、日历、邮件、白板五个模块，并标出它们和智能助手、知识库之间的关系。"
          />
          <button
            onClick={() => void runAiLayout()}
            disabled={aiBusy}
            className="mt-3 inline-flex items-center justify-center gap-2 rounded-full px-4 py-3 text-[13px] font-medium text-white"
            style={{ background: "linear-gradient(135deg, #a78bfa, #7c3aed)", opacity: aiBusy ? 0.72 : 1 }}
          >
            {aiBusy ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
            生成白板结构
          </button>

          <div className="mt-6 text-[12px] font-medium" style={{ color: "#64748b" }}>
            节点属性
          </div>
          {!selectedNode ? (
            <div
              className="mt-3 rounded-[24px] border border-dashed px-4 py-5 text-[13px] leading-6"
              style={{ borderColor: "rgba(15,23,42,0.1)", color: "var(--t3)" }}
            >
              选中一个节点后，可以在这里快速调整尺寸和颜色。
            </div>
          ) : (
            <div className="mt-3 grid gap-3">
              <Field label="宽度">
                <input
                  type="number"
                  value={selectedNode.w}
                  onChange={(event) => updateSelectedNode({ w: Number(event.target.value) || 220 })}
                  className="w-full rounded-2xl border px-3 py-2 text-[13px] outline-none"
                  style={fieldStyle}
                />
              </Field>
              <Field label="高度">
                <input
                  type="number"
                  value={selectedNode.h}
                  onChange={(event) => updateSelectedNode({ h: Number(event.target.value) || 140 })}
                  className="w-full rounded-2xl border px-3 py-2 text-[13px] outline-none"
                  style={fieldStyle}
                />
              </Field>
              <Field label="颜色">
                <div className="flex gap-2 rounded-2xl border px-3 py-3" style={fieldStyle}>
                  {["#fde68a", "#bfdbfe", "#fecdd3", "#ddd6fe", "#bbf7d0"].map((color) => (
                    <button
                      key={color}
                      className="h-7 w-7 rounded-full border-2"
                      style={{
                        background: color,
                        borderColor: selectedNode.color === color ? "#0f172a" : "transparent",
                      }}
                      onClick={() => updateSelectedNode({ color })}
                    />
                  ))}
                </div>
              </Field>
              <button
                onClick={deleteSelectedNode}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-[13px] font-medium text-[#dc2626]"
                style={{ borderColor: "rgba(220,38,38,0.14)", background: "rgba(255,255,255,0.92)" }}
              >
                <Trash2 size={14} />
                删除当前节点
              </button>
            </div>
          )}

          <div className="mt-auto text-[12px]" style={{ color: "var(--t3)" }}>
            {statusText || "支持整块拖拽、双击编辑、画布缩放与自动适配视图。"}
          </div>
        </aside>
      </section>
    </div>
  );
}

function IconPill({
  icon,
  label,
  onClick,
  disabled = false,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 rounded-full border px-3 py-2 text-[12px] font-medium disabled:cursor-not-allowed disabled:opacity-55"
      style={{ borderColor: "rgba(15,23,42,0.08)", background: "rgba(248,250,252,0.92)" }}
    >
      {icon}
      {label}
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-2">
      <span className="text-[12px] font-medium" style={{ color: "var(--t3)" }}>
        {label}
      </span>
      {children}
    </label>
  );
}

const fieldStyle = {
  borderColor: "rgba(15,23,42,0.08)",
  background: "rgba(248,250,252,0.92)",
};

function parseWhiteboardLayout(raw: string): WhiteboardLayoutPayload {
  const candidates = [
    raw,
    raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, ""),
    extractJsonBlock(raw),
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as WhiteboardLayoutPayload;
      if (parsed && typeof parsed === "object") {
        return parsed;
      }
    } catch {
      continue;
    }
  }

  throw new Error("invalid-layout-json");
}

function extractJsonBlock(raw: string): string {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return raw;
  }
  return raw.slice(start, end + 1);
}

function normalizeBoardNodeKind(value: unknown): BoardNodeKind {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "sticky" || normalized.includes("便签")) {
    return "sticky";
  }
  if (normalized === "text" || normalized.includes("文本")) {
    return "text";
  }
  return "box";
}

function clampZoom(value: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

function getBoardBounds(nodes: BoardNode[]) {
  const minX = Math.min(...nodes.map((node) => node.x));
  const minY = Math.min(...nodes.map((node) => node.y));
  const maxX = Math.max(...nodes.map((node) => node.x + node.w));
  const maxY = Math.max(...nodes.map((node) => node.y + node.h));
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}
