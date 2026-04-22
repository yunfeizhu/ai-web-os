"use client";

import type { WindowState } from "@/types/window";

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
          color={win.isFocused ? "#FF5F57" : "var(--traffic-disabled)"}
          hoverColor="#FF3B30"
          symbol="×"
          onClick={onClose}
        />
        <TrafficLight
          color={win.isFocused ? "#FEBC2E" : "var(--traffic-disabled)"}
          hoverColor="#FFB800"
          symbol="−"
          onClick={onMinimize}
        />
        <TrafficLight
          color={win.isFocused ? "#28C840" : "var(--traffic-disabled)"}
          hoverColor="#1AAD30"
          symbol="⤢"
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
  color, hoverColor, symbol, onClick,
}: {
  color: string; hoverColor: string; symbol: string; onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <button
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
      <span
        className="opacity-0 group-hover/tl:opacity-100 transition-opacity select-none"
        style={{ fontSize: 10, fontWeight: 900, lineHeight: 1, color: "rgba(0,0,0,0.65)", marginTop: "-0.5px" }}
      >
        {symbol}
      </span>
    </button>
  );
}
