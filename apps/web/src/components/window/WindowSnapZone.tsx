"use client";

import { useEffect, useRef, useState } from "react";
import { DESKTOP_DOCK_CLEARANCE, getResponsiveSnapTarget } from "./windowLayout";

export type SnapZone = "left" | "right" | "maximize" | null;

interface SnapZoneOverlayProps {
  activeZone: SnapZone;
}

// Win11 风格：从触发边缘的角落缩放弹出
const TRANSFORM_ORIGIN: Record<NonNullable<SnapZone>, string> = {
  left:     "left bottom",
  right:    "right bottom",
  maximize: "top center",
};

export function WindowSnapZoneOverlay({ activeZone }: SnapZoneOverlayProps) {
  const [visible, setVisible] = useState(false);
  const prevZone = useRef<SnapZone>(null);

  useEffect(() => {
    if (activeZone) {
      if (prevZone.current && prevZone.current !== activeZone) {
        // zone 切换：先隐藏再重新入场
        setVisible(false);
        const t = setTimeout(() => setVisible(true), 40);
        prevZone.current = activeZone;
        return () => clearTimeout(t);
      }
      // 稍微延迟让 DOM 先渲染 scale(0) 再触发过渡
      const t = requestAnimationFrame(() => setVisible(true));
      prevZone.current = activeZone;
      return () => cancelAnimationFrame(t);
    } else {
      setVisible(false);
      prevZone.current = null;
    }
  }, [activeZone]);

  if (!activeZone) return null;

  const base: React.CSSProperties = {
    position: "absolute",
    zIndex: 9998,
    background: "var(--panel-bg-raised)",
    border: "1px solid var(--border-strong)",
    backdropFilter: "blur(24px) saturate(180%)",
    WebkitBackdropFilter: "blur(24px) saturate(180%)",
    borderRadius: 16,
    pointerEvents: "none",
    transformOrigin: TRANSFORM_ORIGIN[activeZone],
    transform: visible ? "scale(1)" : "scale(0.6)",
    opacity: visible ? 1 : 0,
    transition: visible
      ? "transform 0.32s cubic-bezier(0.16,1,0.3,1), opacity 0.2s ease"
      : "none",
  };

  if (activeZone === "left") {
    Object.assign(base, {
      top: 4,
      left: 4,
      bottom: DESKTOP_DOCK_CLEARANCE + 4,
      width: "calc(50% - 6px)",
    });
  } else if (activeZone === "right") {
    Object.assign(base, {
      top: 4,
      right: 4,
      bottom: DESKTOP_DOCK_CLEARANCE + 4,
      width: "calc(50% - 6px)",
    });
  } else if (activeZone === "maximize") {
    Object.assign(base, {
      top: 4,
      left: 4,
      right: 4,
      bottom: DESKTOP_DOCK_CLEARANCE + 4,
    });
  }

  return <div style={base} />;
}

export function detectSnapZone(x: number, y: number): SnapZone {
  const EDGE = 80;
  const TOP_EDGE = 12;
  const vw = window.innerWidth;

  if (y <= TOP_EDGE) return "maximize";
  if (x <= EDGE) return "left";
  if (x >= vw - EDGE) return "right";
  return null;
}

export function getSnapTarget(zone: SnapZone): {
  position: { x: number; y: number };
  size: { width: number; height: number };
} {
  return getResponsiveSnapTarget(zone);
}
