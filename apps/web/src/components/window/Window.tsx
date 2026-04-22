"use client";

import { useEffect, useRef, useState } from "react";
import { Rnd } from "react-rnd";
import { TitleBar } from "./TitleBar";
import { useWindowStore } from "@/stores/windowStore";
import type { WindowState } from "@/types/window";
import { detectSnapZone, getSnapTarget, type SnapZone } from "./WindowSnapZone";

interface WindowProps {
  window: WindowState;
  children: React.ReactNode;
  onSnapZoneChange?: (zone: SnapZone) => void;
  contentVirtualized?: boolean;
}

type ExitAnim = "close" | "minimize" | null;

export function Window({
  window: win,
  children,
  onSnapZoneChange,
  contentVirtualized = false,
}: WindowProps) {
  const {
    focusWindow,
    updatePosition,
    updateSize,
    snapWindow,
    canCloseWindow,
    closeWindow,
    minimizeWindow,
    requestMinimize,
    toggleMaximize,
  } = useWindowStore();

  // 开场动画
  const [entering, setEntering] = useState(true);
  // 退出动画
  const [exitAnim, setExitAnim] = useState<ExitAnim>(null);
  // snap 过渡
  const [snapping, setSnapping] = useState(false);
  const snapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 最大化/还原过渡
  const [maxTransition, setMaxTransition] = useState(false);
  const maxTransTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 上一次的 state，用于检测 restore
  const prevState = useRef(win.state);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setEntering(false), 260);
    return () => clearTimeout(t);
  }, []);

  // 检测 minimized ↔ normal 和 maximized ↔ normal 的状态变化
  useEffect(() => {
    const prev = prevState.current;
    const curr = win.state;

    if (prev === "minimized" && curr === "normal") {
      // 最小化还原
      setExitAnim(null);
      setRestoring(true);
      const t = setTimeout(() => setRestoring(false), 260);
      prevState.current = curr;
      return () => clearTimeout(t);
    }

    prevState.current = curr;
  }, [win.state]);

  useEffect(
    () => () => {
      if (snapTimer.current) clearTimeout(snapTimer.current);
      if (maxTransTimer.current) clearTimeout(maxTransTimer.current);
    },
    [],
  );

  // 带动画的最大化/还原
  const handleToggleMaximize = () => {
    setMaxTransition(true);
    if (maxTransTimer.current) clearTimeout(maxTransTimer.current);
    maxTransTimer.current = setTimeout(() => setMaxTransition(false), 380);
    toggleMaximize(win.id);
  };

  // 带动画的关闭
  const handleClose = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const canClose = await canCloseWindow(win.id);
    if (!canClose) return;
    setExitAnim("close");
    setTimeout(() => closeWindow(win.id), 200);
  };

  // 带动画的最小化
  const handleMinimize = (e: React.MouseEvent) => {
    e.stopPropagation();
    setExitAnim("minimize");
    // 动画结束后调用 store，组件靠 win.state=minimized + exitAnim=minimize 隐藏
    setTimeout(() => minimizeWindow(win.id), 240);
  };

  // 响应 Dock 等外部触发的缩小请求（与 handleMinimize 同等动画）
  useEffect(() => {
    if (!win.pendingMinimize) return;
    setExitAnim("minimize");
    setTimeout(() => minimizeWindow(win.id), 240);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [win.pendingMinimize]);

  // minimized 且没有 restore 动画时不渲染
  if (win.state === "minimized" && exitAnim === null && !restoring) return null;

  const isMaximized = win.state === "maximized";

  const maxW =
    typeof globalThis.window !== "undefined"
      ? globalThis.window.innerWidth
      : 1920;
  const maxH =
    typeof globalThis.window !== "undefined"
      ? globalThis.window.innerHeight
      : 1080;

  const position = isMaximized ? { x: 0, y: 0 } : win.position;
  const size = isMaximized ? { width: maxW, height: maxH } : win.size;

  // 动画播完后 win.state 已是 minimized，组件保留但隐藏，等待 restore
  const isHidden = win.state === "minimized" && exitAnim === "minimize";

  const rndStyle: React.CSSProperties = {
    zIndex: win.zIndex,
    ...(isHidden ? { visibility: "hidden", pointerEvents: "none" } : {}),
    ...(snapping || maxTransition
      ? {
          transition:
            "transform 0.32s cubic-bezier(0.16,1,0.3,1), width 0.32s cubic-bezier(0.16,1,0.3,1), height 0.32s cubic-bezier(0.16,1,0.3,1)",
        }
      : {}),
  };

  // 决定内层 className
  let animClass = "";
  if (exitAnim === "close") animClass = "win-close";
  else if (exitAnim === "minimize") animClass = "win-minimize";
  else if (restoring) animClass = "win-restore";
  else if (entering) animClass = "win-open";

  return (
    <Rnd
      position={position}
      size={size}
      minWidth={win.minSize.width}
      minHeight={win.minSize.height}
      dragHandleClassName="window-drag-handle"
      disableDragging={isMaximized}
      enableResizing={!isMaximized}
      bounds="parent"
      style={rndStyle}
      onDragStart={() => {
        if (!win.isFocused) focusWindow(win.id);
        setSnapping(false);
        if (snapTimer.current) clearTimeout(snapTimer.current);
      }}
      onDrag={(e, d) => {
        if (onSnapZoneChange) {
          const mouseX = (e as MouseEvent).clientX ?? d.x;
          const mouseY = (e as MouseEvent).clientY ?? d.y;
          onSnapZoneChange(detectSnapZone(mouseX, mouseY));
        }
      }}
      onDragStop={(e, d) => {
        const mouseX = (e as MouseEvent).clientX ?? d.x;
        const mouseY = (e as MouseEvent).clientY ?? d.y;
        const zone = detectSnapZone(mouseX, mouseY);
        onSnapZoneChange?.(null);
        if (zone) {
          setSnapping(true);
          const target = getSnapTarget(zone);
          snapWindow(
            win.id,
            target.position.x,
            target.position.y,
            target.size.width,
            target.size.height,
          );
          snapTimer.current = setTimeout(() => setSnapping(false), 350);
        } else {
          updatePosition(win.id, d.x, d.y);
        }
      }}
      onResizeStart={() => {
        if (!win.isFocused) focusWindow(win.id);
      }}
      onResizeStop={(_e, _dir, ref, _delta, pos) => {
        updateSize(win.id, ref.offsetWidth, ref.offsetHeight);
        updatePosition(win.id, pos.x, pos.y);
      }}
      onMouseDown={() => {
        if (!win.isFocused) focusWindow(win.id);
      }}
    >
      <div
        className={`flex flex-col w-full h-full overflow-hidden${animClass ? ` ${animClass}` : ""}`}
        style={{
          borderRadius: isMaximized ? 0 : 12,
          background: "var(--window-bg)",
          backdropFilter: "blur(60px) saturate(200%)",
          WebkitBackdropFilter: "blur(60px) saturate(200%)",
          border: `0.5px solid ${win.isFocused ? "var(--border-strong)" : "var(--border)"}`,
          boxShadow: win.isFocused
            ? "var(--shadow-window-focus)"
            : "var(--shadow-window)",
          transition:
            "box-shadow 0.2s, border-color 0.2s, border-radius 0.32s cubic-bezier(0.16,1,0.3,1)",
        }}
      >
        <TitleBar
          window={win}
          onClose={handleClose}
          onMinimize={handleMinimize}
          onToggleMaximize={handleToggleMaximize}
        />
        <div
          className="flex-1 overflow-auto window-content"
          data-virtualized={contentVirtualized ? "true" : "false"}
          style={{ background: "var(--window-content-bg)" }}
        >
          {contentVirtualized ? (
            <VirtualizedWindowContent title={win.title} icon={win.icon} />
          ) : (
            children
          )}
        </div>
      </div>
    </Rnd>
  );
}

function VirtualizedWindowContent({
  title,
  icon,
}: {
  title: string;
  icon: string;
}) {
  return (
    <div
      className="flex h-full items-center justify-center"
      style={{
        background: "var(--virtualized-bg)",
      }}
    >
      <div
        className="flex items-center gap-3 rounded-lg px-4 py-3"
        style={{
          color: "var(--t3)",
          background: "var(--panel-bg-raised)",
          border: "0.5px solid var(--border)",
        }}
      >
        <span style={{ fontSize: 18, lineHeight: 1 }}>{icon}</span>
        <span className="max-w-[220px] truncate text-[13px] font-medium">
          {title}
        </span>
      </div>
    </div>
  );
}
