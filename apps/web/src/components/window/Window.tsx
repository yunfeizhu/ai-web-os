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
}

export function Window({ window: win, children, onSnapZoneChange }: WindowProps) {
  const { focusWindow, updatePosition, updateSize, snapWindow } = useWindowStore();
  const [animating, setAnimating] = useState(true);
  // 松手 snap 时短暂开启位移动画
  const [snapping, setSnapping] = useState(false);
  const snapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const t = requestAnimationFrame(() => setAnimating(false));
    return () => cancelAnimationFrame(t);
  }, []);

  // 清理 timer
  useEffect(() => () => { if (snapTimer.current) clearTimeout(snapTimer.current); }, []);

  if (win.state === "minimized") return null;

  const isMaximized = win.state === "maximized";

  const maxW = typeof globalThis.window !== "undefined" ? globalThis.window.innerWidth : 1920;
  const maxH = typeof globalThis.window !== "undefined" ? globalThis.window.innerHeight : 1080;

  const position = isMaximized ? { x: 0, y: 0 } : win.position;
  const size = isMaximized ? { width: maxW, height: maxH } : win.size;

  // snap 动画：给 Rnd 外层加 transition，让位置和尺寸平滑过渡
  const rndStyle: React.CSSProperties = {
    zIndex: isMaximized ? 10000 : win.zIndex,
    ...(snapping ? {
      transition: "transform 0.32s cubic-bezier(0.16,1,0.3,1), width 0.32s cubic-bezier(0.16,1,0.3,1), height 0.32s cubic-bezier(0.16,1,0.3,1)",
    } : {}),
  };

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
        // 开始拖拽时关闭 snap 动画，防止卡顿
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
          // 开启动画，执行 snap，然后 350ms 后关闭动画
          setSnapping(true);
          const target = getSnapTarget(zone);
          snapWindow(win.id, target.position.x, target.position.y, target.size.width, target.size.height);
          snapTimer.current = setTimeout(() => setSnapping(false), 350);
        } else {
          updatePosition(win.id, d.x, d.y);
        }
      }}
      onResizeStart={() => { if (!win.isFocused) focusWindow(win.id); }}
      onResizeStop={(_e, _dir, ref, _delta, pos) => {
        updateSize(win.id, ref.offsetWidth, ref.offsetHeight);
        updatePosition(win.id, pos.x, pos.y);
      }}
      onMouseDown={() => { if (!win.isFocused) focusWindow(win.id); }}
    >
      <div
        className={`flex flex-col w-full h-full overflow-hidden${animating ? " win-open" : ""}`}
        style={{
          borderRadius: isMaximized ? 0 : 12,
          background: "rgba(246,246,248,0.82)",
          backdropFilter: "blur(60px) saturate(200%)",
          WebkitBackdropFilter: "blur(60px) saturate(200%)",
          border: `0.5px solid ${win.isFocused ? "rgba(0,0,0,0.22)" : "rgba(0,0,0,0.12)"}`,
          boxShadow: win.isFocused ? "var(--shadow-window-focus)" : "var(--shadow-window)",
          transition: "box-shadow 0.2s, border-color 0.2s",
        }}
      >
        <TitleBar window={win} />
        <div
          className="flex-1 overflow-auto window-content"
          style={{ background: "rgba(255,255,255,0.55)" }}
        >
          {children}
        </div>
      </div>
    </Rnd>
  );
}
