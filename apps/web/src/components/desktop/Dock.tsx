"use client";

import { useRef, useState } from "react";
import { useWindowStore } from "@/stores/windowStore";
import { useDesktopStore } from "@/stores/desktopStore";
import { StartMenu } from "./StartMenu";
import { SystemTray } from "./SystemTray";
import { getMacosAppIconSrc } from "./appIconAssets";
import {
  DOCK_BASE_ICON_SIZE,
  DOCK_ITEM_GAP,
  getDockItemCenterX,
  getDockMagnification,
  getRenderableDockAppIds,
} from "./dockMagnification";
import * as Icons from "lucide-react";
import type { LucideIcon } from "lucide-react";

function getIcon(name: string): LucideIcon {
  return (Icons as unknown as Record<string, LucideIcon>)[name] ?? Icons.Box;
}

// fallback only: built-in apps normally use generated macOS-like PNG assets.
const DOCK_COLORS: Record<string, string> = {
  "ai-chat": "linear-gradient(180deg, #5Ac8FA, #007AFF)",
  "file-manager": "linear-gradient(180deg, #54C7FC, #147EFB)",
  settings: "linear-gradient(180deg, #8E8E93, #636366)",
  terminal: "linear-gradient(180deg, #3A3A3C, #1C1C1E)",
  browser: "linear-gradient(180deg, #5AC8FA, #0A84FF)",
  notes: "linear-gradient(180deg, #FFD60A, #FF9F0A)",
  "document-editor": "linear-gradient(180deg, #FB7185, #E11D48)",
  "text-editor": "linear-gradient(180deg, #7BD4FF, #3B82F6)",
  calendar: "linear-gradient(180deg, #FF453A, #D70015)",
  mail: "linear-gradient(180deg, #22C55E, #15803D)",
  whiteboard: "linear-gradient(180deg, #A78BFA, #7C3AED)",
};

// Dock 中显示的 app 顺序
const DOCK_APPS = [
  "ai-chat",
  "file-manager",
  "notes",
  "document-editor",
  "text-editor",
  "calendar",
  "mail",
  "whiteboard",
  "browser",
  "terminal",
  "settings",
];

export function Dock() {
  const [startOpen, setStartOpen] = useState(false);
  const [pointerX, setPointerX] = useState<number | null>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const windows = useWindowStore((s) => s.windows);
  const focusWindow = useWindowStore((s) => s.focusWindow);
  const restoreWindow = useWindowStore((s) => s.restoreWindow);
  const requestMinimize = useWindowStore((s) => s.requestMinimize);
  const openWindow = useWindowStore((s) => s.openWindow);
  const apps = useDesktopStore((s) => s.apps);

  const getDockContentLeft = () =>
    (dockRef.current?.getBoundingClientRect().left ?? 0) + 16;

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
  const dockAppIds = getRenderableDockAppIds(
    DOCK_APPS,
    new Set(Object.keys(apps)),
  );

  if (dockAppIds.length === 0) return null;

  return (
    <>
      <div
        ref={dockRef}
        data-desktop-blocker="true"
        className="absolute bottom-1.5 left-1/2 flex -translate-x-1/2 items-end overflow-visible"
        onMouseMove={(event) => {
          setPointerX(event.clientX);
        }}
        onMouseLeave={() => {
          setPointerX(null);
        }}
        style={{
          zIndex: 9999,
          minHeight: 80,
          padding: "13px 16px 9px",
          gap: DOCK_ITEM_GAP,
          background:
            "linear-gradient(180deg, rgba(255,255,255,0.58), rgba(245,248,250,0.38) 46%, rgba(220,228,232,0.34))",
          backdropFilter: "blur(44px) saturate(190%) brightness(1.04)",
          WebkitBackdropFilter: "blur(44px) saturate(190%) brightness(1.04)",
          borderRadius: 30,
          border: "1px solid rgba(255,255,255,0.52)",
          boxShadow:
            "0 28px 70px rgba(0,0,0,0.32), 0 9px 26px rgba(0,0,0,0.20), inset 0 1px 0 rgba(255,255,255,0.72), inset 0 -1px 0 rgba(0,0,0,0.12)",
        }}
      >
        {dockAppIds.map((appId, index) => {
          const app = apps[appId];
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
              fallbackIcon={<IconComp size={28} color="#fff" strokeWidth={1.75} />}
              iconSrc={getMacosAppIconSrc(appId)}
              bg={bg}
              label={app.manifest.name}
              isOpen={isOpen}
              isFocused={!!isFocused}
              itemCenterX={getDockItemCenterX({
                dockLeft: getDockContentLeft(),
                index,
              })}
              pointerX={pointerX}
              onClick={() => handleDockClick(appId)}
            />
          );
        })}

        {/* 分隔线 */}
        <div
          className="w-px self-stretch my-2 mx-1.5"
          style={{
            background:
              "linear-gradient(180deg, transparent, rgba(0,0,0,0.22), transparent)",
            boxShadow: "1px 0 rgba(255,255,255,0.42)",
          }}
        />

        {/* 系统托盘 */}
        <SystemTray />
      </div>

      {startOpen && <StartMenu onClose={() => setStartOpen(false)} />}
    </>
  );
}

function DockItem({
  fallbackIcon,
  iconSrc,
  bg,
  label,
  isOpen,
  isFocused,
  itemCenterX,
  pointerX,
  onClick,
}: {
  fallbackIcon: React.ReactNode;
  iconSrc?: string;
  bg: string;
  label: string;
  isOpen: boolean;
  isFocused: boolean;
  itemCenterX: number;
  pointerX: number | null;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const magnification = getDockMagnification({
    itemCenterX,
    pointerX: itemCenterX > 0 ? pointerX : null,
  });
  const tooltipBottom = 110 + Math.max(0, -magnification.translateY * 0.45);

  return (
    <div
      className="relative flex flex-col items-center justify-end"
      style={{
        width: DOCK_BASE_ICON_SIZE,
        height: DOCK_BASE_ICON_SIZE,
      }}
    >
      {/* Tooltip */}
      {hovered && (
        <div
          className="absolute px-3 py-1.5 rounded-xl text-[13px] font-medium whitespace-nowrap pointer-events-none"
          style={{
            bottom: tooltipBottom,
            zIndex: 2,
            background: "rgba(255,255,255,0.93)",
            color: "rgba(0,0,0,0.88)",
            border: "0.5px solid rgba(0,0,0,0.10)",
            boxShadow:
              "0 12px 30px rgba(0,0,0,0.22), 0 2px 8px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.85)",
            backdropFilter: "blur(26px) saturate(180%)",
            WebkitBackdropFilter: "blur(26px) saturate(180%)",
            animation: "dockTooltipIn 160ms cubic-bezier(0.16,1,0.3,1)",
          }}
        >
          {label}
          <span
            aria-hidden="true"
            style={{
              position: "absolute",
              left: "50%",
              bottom: -6,
              width: 10,
              height: 10,
              transform: "translateX(-50%) rotate(45deg)",
              background: "rgba(255,255,255,0.93)",
              borderRight: "0.5px solid rgba(0,0,0,0.08)",
              borderBottom: "0.5px solid rgba(0,0,0,0.08)",
              boxShadow: "2px 2px 5px rgba(0,0,0,0.05)",
            }}
          />
        </div>
      )}
      <button
        className="flex items-center justify-center"
        style={{
          width: DOCK_BASE_ICON_SIZE,
          height: DOCK_BASE_ICON_SIZE,
          padding: 0,
          border: "none",
          background: iconSrc ? "transparent" : bg,
          borderRadius: iconSrc ? 0 : 14,
          boxShadow: iconSrc
            ? "none"
            : "0 8px 18px rgba(0,0,0,0.24), inset 0 1px 0 rgba(255,255,255,0.25)",
          transform: `translateY(${magnification.translateY}px) scale(${magnification.scale})`,
          transformOrigin: "bottom center",
          transition:
            pointerX === null
              ? "transform 320ms cubic-bezier(0.16,1,0.3,1)"
              : "transform 230ms cubic-bezier(0.22,1,0.36,1)",
          willChange: "transform",
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={onClick}
        title={label}
      >
        {iconSrc ? (
          <img
            src={iconSrc}
            alt=""
            draggable={false}
            style={{
              width: "100%",
              height: "100%",
              display: "block",
              objectFit: "contain",
              pointerEvents: "none",
              filter: "drop-shadow(0 9px 12px rgba(0,0,0,0.30))",
            }}
          />
        ) : (
          fallbackIcon
        )}
      </button>
      {/* Running indicator dot */}
      {isOpen && (
        <div
          data-testid="dock-running-indicator"
          className="w-1 h-1 rounded-full"
          style={{
            position: "absolute",
            left: "50%",
            bottom: -8,
            transform: "translateX(-50%)",
            background: isFocused ? "rgba(0,0,0,0.72)" : "rgba(0,0,0,0.36)",
            boxShadow: "0 0 0 0.5px rgba(255,255,255,0.45)",
          }}
        />
      )}
    </div>
  );
}
