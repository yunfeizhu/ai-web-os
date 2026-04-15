"use client";

import { useState } from "react";
import { useWindowStore } from "@/stores/windowStore";
import { useDesktopStore } from "@/stores/desktopStore";
import { StartMenu } from "./StartMenu";
import { SystemTray } from "./SystemTray";
import * as Icons from "lucide-react";
import type { LucideIcon } from "lucide-react";

function getIcon(name: string): LucideIcon {
  return (Icons as unknown as Record<string, LucideIcon>)[name] ?? Icons.Box;
}

// macOS 风格 Dock 图标颜色
const DOCK_COLORS: Record<string, string> = {
  "ai-chat": "linear-gradient(180deg, #5Ac8FA, #007AFF)",
  "file-manager": "linear-gradient(180deg, #54C7FC, #147EFB)",
  settings: "linear-gradient(180deg, #8E8E93, #636366)",
  terminal: "linear-gradient(180deg, #3A3A3C, #1C1C1E)",
  browser: "linear-gradient(180deg, #5AC8FA, #0A84FF)",
  notes: "linear-gradient(180deg, #FFD60A, #FF9F0A)",
  "text-editor": "linear-gradient(180deg, #7BD4FF, #3B82F6)",
  calendar: "linear-gradient(180deg, #FF453A, #D70015)",
};

// Dock 中显示的 app 顺序
const DOCK_APPS = [
  "ai-chat",
  "file-manager",
  "notes",
  "text-editor",
  "calendar",
  "browser",
  "terminal",
  "settings",
];

export function Dock() {
  const [startOpen, setStartOpen] = useState(false);
  const windows = useWindowStore((s) => s.windows);
  const focusWindow = useWindowStore((s) => s.focusWindow);
  const restoreWindow = useWindowStore((s) => s.restoreWindow);
  const requestMinimize = useWindowStore((s) => s.requestMinimize);
  const openWindow = useWindowStore((s) => s.openWindow);
  const apps = useDesktopStore((s) => s.apps);

  const handleDockClick = (appId: string) => {
    // 查找该 app 是否已有打开的窗口
    const existingWin = Object.values(windows).find(
      (w) => w.appId === appId,
    );
    if (existingWin) {
      if (existingWin.state === "minimized") restoreWindow(existingWin.id);
      else if (existingWin.isFocused) requestMinimize(existingWin.id);
      else focusWindow(existingWin.id);
    } else {
      const app = apps[appId];
      if (app) {
        openWindow(appId, app.manifest.name, app.manifest.icon, {
          size: app.manifest.ui.defaultSize,
          minSize: app.manifest.ui.minSize,
          singleton: app.manifest.ui.singleton,
        });
      }
    }
  };

  const openAppIds = new Set(Object.values(windows).map((w) => w.appId));

  return (
    <>
      <div
        data-desktop-blocker="true"
        className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-end gap-1 px-2.5 py-1.5"
        style={{
          zIndex: 9999,
          background: "rgba(250,250,252,0.55)",
          backdropFilter: "blur(40px) saturate(180%)",
          WebkitBackdropFilter: "blur(40px) saturate(180%)",
          borderRadius: "var(--dock-radius)",
          border: "1px solid rgba(255,255,255,0.45)",
          boxShadow: "var(--shadow-dock)",
          height: 62,
        }}
      >
        {DOCK_APPS.map((appId) => {
          const app = apps[appId];
          if (!app) return null;
          const IconComp = getIcon(app.manifest.icon);
          const bg =
            DOCK_COLORS[appId] ?? "linear-gradient(180deg, #8E8E93, #636366)";
          const isOpen = openAppIds.has(appId);
          const activeWin = Object.values(windows).find(
            (w) => w.appId === appId,
          );
          const isFocused =
            activeWin?.isFocused && activeWin.state !== "minimized";

          return (
            <DockItem
              key={appId}
              icon={<IconComp size={24} color="#fff" strokeWidth={1.8} />}
              bg={bg}
              label={app.manifest.name}
              isOpen={isOpen}
              isFocused={!!isFocused}
              onClick={() => handleDockClick(appId)}
            />
          );
        })}

        {/* 分隔线 */}
        <div
          className="w-px self-stretch my-2 mx-0.5"
          style={{ background: "rgba(0,0,0,0.12)" }}
        />

        {/* 系统托盘 */}
        <SystemTray />
      </div>

      {startOpen && <StartMenu onClose={() => setStartOpen(false)} />}
    </>
  );
}

function DockItem({
  icon,
  bg,
  label,
  isOpen,
  isFocused,
  onClick,
}: {
  icon: React.ReactNode;
  bg: string;
  label: string;
  isOpen: boolean;
  isFocused: boolean;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div className="flex flex-col items-center relative">
      {/* Tooltip */}
      {hovered && (
        <div
          className="absolute -top-8 px-2 py-0.5 rounded-md text-[12px] font-medium whitespace-nowrap pointer-events-none"
          style={{
            background: "rgba(0,0,0,0.75)",
            color: "#fff",
            boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
          }}
        >
          {label}
        </div>
      )}
      <button
        className="w-11 h-11 flex items-center justify-center transition-transform duration-150"
        style={{
          background: bg,
          borderRadius: 11,
          boxShadow: "0 1px 4px rgba(0,0,0,0.18), 0 0.5px 1px rgba(0,0,0,0.08)",
          transform: hovered ? "scale(1.18) translateY(-6px)" : "scale(1)",
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={onClick}
        title={label}
      >
        {icon}
      </button>
      {/* Running indicator dot */}
      {isOpen && (
        <div
          className="w-1 h-1 rounded-full mt-0.5"
          style={{
            background: isFocused ? "rgba(0,0,0,0.65)" : "rgba(0,0,0,0.32)",
          }}
        />
      )}
    </div>
  );
}
