"use client";

import { useEffect, useRef } from "react";

export interface MenuItem {
  label?: string;
  icon?: React.ReactNode;
  onClick?: () => void;
  type?: "separator";
  disabled?: boolean;
}

export function ContextMenu({ x, y, items, onClose }: {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const menuW = 220;
  const ax = Math.min(x, window.innerWidth - menuW - 8);
  const ay = Math.min(y, window.innerHeight - items.length * 30 - 80);

  return (
    <>
      <div className="fixed inset-0" style={{ zIndex: 10000 }} onClick={onClose} />
      <div
        ref={ref}
        className="fixed py-1 rounded-lg"
        style={{
          left: ax, top: ay, width: menuW,
          zIndex: 10001,
          background: "rgba(252,252,254,0.82)",
          backdropFilter: "blur(40px) saturate(200%)",
          WebkitBackdropFilter: "blur(40px) saturate(200%)",
          border: "0.5px solid rgba(0,0,0,0.15)",
          boxShadow: "var(--shadow-menu)",
        }}
      >
        {items.map((item, i) => {
          if (item.type === "separator") {
            return (
              <div
                key={i}
                className="mx-2 my-1"
                style={{ height: 0.5, background: "rgba(0,0,0,0.10)" }}
              />
            );
          }
          return (
            <button
              key={i}
              disabled={item.disabled}
              onClick={(e) => { e.stopPropagation(); item.onClick?.(); onClose(); }}
              className="w-full flex items-center gap-2 px-3 py-[5px] text-[13px]
                transition-colors duration-75 disabled:opacity-30 rounded-[4px] mx-1"
              style={{
                color: "var(--t1)",
                width: "calc(100% - 8px)",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.background = "var(--accent)";
                (e.currentTarget as HTMLElement).style.color = "#fff";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.background = "transparent";
                (e.currentTarget as HTMLElement).style.color = "var(--t1)";
              }}
            >
              {item.icon && <span className="shrink-0">{item.icon}</span>}
              {item.label}
            </button>
          );
        })}
      </div>
    </>
  );
}
