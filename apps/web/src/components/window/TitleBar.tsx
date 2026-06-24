"use client";

import type { WindowState } from "@/types/window";
import { Maximize2, Minus, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface TitleBarProps {
  window: WindowState;
  onClose: (e: React.MouseEvent) => void;
  onMinimize: (e: React.MouseEvent) => void;
  onToggleMaximize: () => void;
}

export function TitleBar({ window: win, onClose, onMinimize, onToggleMaximize }: TitleBarProps) {

  return (
    <div
      className="window-drag-handle flex items-center h-[38px] px-3.5 shrink-0 select-none"
      style={{
        background: win.isFocused
          ? "var(--window-titlebar-bg)"
          : "var(--window-titlebar-bg-inactive)",
        borderBottom: "0.5px solid var(--window-titlebar-border)",
      }}
      onDoubleClick={onToggleMaximize}
    >
      {/* Traffic-light buttons */}
      <div className="flex items-center gap-2 mr-3 group/tl">
        <TrafficLight
          ariaLabel="关闭"
          color={win.isFocused ? "#FF5F57" : "var(--traffic-disabled)"}
          hoverColor="#FF3B30"
          Icon={X}
          onClick={onClose}
        />
        <TrafficLight
          ariaLabel="最小化"
          color={win.isFocused ? "#FEBC2E" : "var(--traffic-disabled)"}
          hoverColor="#FFB800"
          Icon={Minus}
          onClick={onMinimize}
        />
        <TrafficLight
          ariaLabel="最大化"
          color={win.isFocused ? "#28C840" : "var(--traffic-disabled)"}
          hoverColor="#1AAD30"
          Icon={Maximize2}
          onClick={(e) => { e.stopPropagation(); onToggleMaximize(); }}
        />
      </div>

      {/* Title */}
      <span
        className="flex-1 text-center text-[14px] font-medium truncate"
        style={{
          color: win.isFocused ? "var(--t1)" : "var(--t3)",
          transition: "color 0.15s",
        }}
      >
        {win.title}
      </span>

      <div style={{ width: 60 }} />
    </div>
  );
}

function TrafficLight({
  ariaLabel, color, hoverColor, Icon, onClick,
}: {
  ariaLabel: string;
  color: string;
  hoverColor: string;
  Icon: LucideIcon;
  onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      data-window-control={ariaLabel}
      onClick={onClick}
      className="w-3.5 h-3.5 rounded-full flex items-center justify-center transition-all duration-100
        group-hover/tl:opacity-100"
      style={{
        background: color,
        border: "0.5px solid var(--border)",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = hoverColor)}
      onMouseLeave={(e) => (e.currentTarget.style.background = color)}
    >
      <Icon
        aria-hidden="true"
        className="opacity-0 group-hover/tl:opacity-100 transition-opacity"
        size={8}
        strokeWidth={3.2}
        style={{ color: "rgba(0,0,0,0.66)" }}
      />
    </button>
  );
}
