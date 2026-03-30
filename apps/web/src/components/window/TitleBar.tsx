"use client";

import { useWindowStore } from "@/stores/windowStore";
import type { WindowState } from "@/types/window";

export function TitleBar({ window: win }: { window: WindowState }) {
  const { closeWindow, minimizeWindow, toggleMaximize } = useWindowStore();
  const isMaximized = win.state === "maximized";

  return (
    <div
      className="window-drag-handle flex items-center h-[38px] px-3.5 shrink-0 select-none"
      style={{
        background: win.isFocused ? "rgba(255,255,255,0.55)" : "rgba(245,245,247,0.65)",
        borderBottom: "0.5px solid rgba(0,0,0,0.08)",
      }}
      onDoubleClick={() => toggleMaximize(win.id)}
    >
      {/* Traffic-light buttons */}
      <div className="flex items-center gap-2 mr-3 group/tl">
        <TrafficLight
          color={win.isFocused ? "#FF5F57" : "#D4D4D4"}
          hoverColor="#FF3B30"
          symbol="×"
          onClick={(e) => { e.stopPropagation(); closeWindow(win.id); }}
        />
        <TrafficLight
          color={win.isFocused ? "#FEBC2E" : "#D4D4D4"}
          hoverColor="#FFB800"
          symbol="−"
          onClick={(e) => { e.stopPropagation(); minimizeWindow(win.id); }}
        />
        <TrafficLight
          color={win.isFocused ? "#28C840" : "#D4D4D4"}
          hoverColor="#1AAD30"
          symbol="⤢"
          onClick={(e) => { e.stopPropagation(); toggleMaximize(win.id); }}
        />
      </div>

      {/* Title */}
      <span
        className="flex-1 text-center text-[13px] font-medium truncate"
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
      className="w-3 h-3 rounded-full flex items-center justify-center transition-all duration-100
        group-hover/tl:opacity-100"
      style={{
        background: color,
        border: "0.5px solid rgba(0,0,0,0.08)",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = hoverColor)}
      onMouseLeave={(e) => (e.currentTarget.style.background = color)}
    >
      <span
        className="text-[8px] font-bold leading-none opacity-0 group-hover/tl:opacity-80 transition-opacity"
        style={{ color: "rgba(0,0,0,0.5)" }}
      >
        {symbol}
      </span>
    </button>
  );
}
