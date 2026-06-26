"use client";

import { useCallback, useEffect, useState } from "react";
import { WindowManager } from "@/components/window/WindowManager";
import { AvatarPet } from "./AvatarPet";
import { Dock } from "./Dock";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import { useDesktopStore } from "@/stores/desktopStore";
import { useWindowStore } from "@/stores/windowStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { BUILTIN_APPS } from "@/lib/app-registry";
import { DesktopClock } from "./DesktopClock";
import { DesktopWeatherWidget } from "./DesktopWeatherWidget";
import { apiFetch, API_BASE } from "@/lib/backend";
import { getWallpaperByUrl, normalizeWallpaperUrl } from "@/lib/wallpapers";
import {
  DESKTOP_ICON_GRID_ITEM_STYLE,
  DESKTOP_ICON_GRID_STYLE,
} from "./desktopIconLayout";

interface DesktopFolderEntry {
  id: string;
  name: string;
  path: string;
  parent_path: string;
  kind: "dir";
  mime_type: string | null;
  size: number;
}

const DEFAULT_DESKTOP_FOLDER_NAME = "新建文件夹";
const FILE_MANAGER_APP_ID = "file-manager";
const MACOS_FOLDER_ICON_SRC = "/icons/macos/folder.png";

export function Desktop() {
  const { wallpaper, registerApp } = useDesktopStore();
  const fileManagerApp = useDesktopStore((s) => s.apps[FILE_MANAGER_APP_ID]);
  const openWindow = useWindowStore((s) => s.openWindow);
  const updateAppState = useWindowStore((s) => s.updateAppState);
  const windows = useWindowStore((s) => s.windows);
  const hasMaximized = Object.values(windows).some((w) => w.state === "maximized");
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [desktopFolders, setDesktopFolders] = useState<DesktopFolderEntry[]>([]);

  const { embeddingConfig, providers, defaultModel } = useSettingsStore();

  useEffect(() => {
    BUILTIN_APPS.forEach((app) => registerApp(app, true));
  }, [registerApp]);

  // 应用启动时自动恢复记忆管理器和知识库管理器（后端重启后 _manager 为 None）
  // 监听 embeddingConfig：Zustand persist hydration 完成后触发
  useEffect(() => {
    const cfg = embeddingConfig;
    if (!cfg?.apiKey) return;

    (async () => {
      try {
        const { decodeModel, PROVIDERS } = await import("@/apps/settings/providers");
        let llmModel = "";
        let llmApiKey: string | null = null;
        let llmApiBase: string | null = null;
        if (defaultModel) {
          const { providerId, modelId } = decodeModel(defaultModel);
          const pcfg = providers[providerId];
          const pdef = PROVIDERS.find((p) => p.id === providerId);
          if (pcfg?.apiKey) {
            llmModel = modelId;
            llmApiKey = pcfg.apiKey;
            llmApiBase = pcfg.baseUrl ?? pdef?.defaultBaseUrl ?? null;
          }
        }
        if (!llmModel) {
          for (const [pid, pcfg] of Object.entries(providers)) {
            if (pcfg?.apiKey && pcfg.enabledModels?.length) {
              llmModel = pcfg.enabledModels[0];
              llmApiKey = pcfg.apiKey;
              const pdef = PROVIDERS.find((p) => p.id === pid);
              llmApiBase = pcfg.baseUrl ?? pdef?.defaultBaseUrl ?? null;
              break;
            }
          }
        }
        if (!llmModel) return;

        await fetch(`${API_BASE}/memory/init`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            llm_provider: "litellm",
            llm_model: llmModel,
            llm_api_key: llmApiKey,
            llm_api_base: llmApiBase,
            embedder_provider: "openai",
            embedder_model: cfg.model,
            embedder_api_key: cfg.apiKey,
            embedder_base_url: cfg.baseUrl,
            embedder_dims: cfg.dims,
          }),
        });

        await fetch(`${API_BASE}/knowledge/init`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            embedder_model: cfg.model,
            embedder_api_key: cfg.apiKey,
            embedder_base_url: cfg.baseUrl,
          }),
        });
      } catch {
        // 静默失败，不影响桌面加载
      }
    })();
  }, [embeddingConfig]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const target = e.target as HTMLElement | null;
    const isBlockedArea = Boolean(
      target?.closest("[data-desktop-blocker='true']"),
    );
    if (isBlockedArea) {
      setContextMenu(null);
      return;
    }
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const handleCreateDesktopFolder = useCallback(async () => {
    try {
      const folder = await apiFetch<DesktopFolderEntry>("/files/desktop/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: DEFAULT_DESKTOP_FOLDER_NAME }),
      });
      setDesktopFolders((current) => {
        if (current.some((item) => item.id === folder.id)) return current;
        return [...current, folder];
      });
    } catch (error) {
      console.error("Failed to create desktop folder", error);
    }
  }, []);

  const openDesktopFolder = useCallback((folder: DesktopFolderEntry) => {
    const manifest =
      fileManagerApp?.manifest ??
      BUILTIN_APPS.find((app) => app.id === FILE_MANAGER_APP_ID);
    const windowId = openWindow(
      FILE_MANAGER_APP_ID,
      manifest?.name ?? "文件管理器",
      manifest?.icon ?? "FolderOpen",
      {
        size: manifest?.ui.defaultSize,
        minSize: manifest?.ui.minSize,
        singleton: manifest?.ui.singleton ?? true,
        appState: { initialPath: folder.path },
      },
    );
    updateAppState(windowId, { initialPath: folder.path });
  }, [fileManagerApp, openWindow, updateAppState]);

  const openAppearanceSettings = useCallback(() => {
    const appState = { initialTab: "appearance" };
    const windowId = openWindow("settings", "设置", "Settings", { appState });
    updateAppState(windowId, appState);
  }, [openWindow, updateAppState]);

  const contextMenuItems: MenuItem[] = [
    { label: "新建文件夹", onClick: handleCreateDesktopFolder },
    { type: "separator" },
    { label: "更改壁纸…", onClick: openAppearanceSettings },
    { label: "外观设置", onClick: openAppearanceSettings },
  ];

  const wpUrl = normalizeWallpaperUrl(wallpaper);
  const selectedWallpaper = getWallpaperByUrl(wpUrl);

  return (
    <div
      className="desktop-bg"
      onContextMenuCapture={(event) => {
        event.preventDefault();
      }}
      onContextMenu={handleContextMenu}
      onClick={() => setContextMenu(null)}
    >
      {selectedWallpaper?.kind === "video" ? (
        <video
          data-testid="desktop-live-wallpaper"
          className="absolute inset-0 h-full w-full object-cover"
          src={selectedWallpaper.url}
          poster={selectedWallpaper.thumb}
          autoPlay
          muted
          loop
          playsInline
          aria-hidden="true"
        />
      ) : (
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `url(${wpUrl})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        />
      )}

      {/* 桌面时钟 — 左上角 */}
      <DesktopClock />
      <DesktopWeatherWidget />

      {desktopFolders.length > 0 && (
        <div
          className="absolute right-4 top-6"
          data-desktop-blocker="true"
          style={DESKTOP_ICON_GRID_STYLE}
        >
          {desktopFolders.map((folder) => (
            <div key={folder.id} style={DESKTOP_ICON_GRID_ITEM_STYLE}>
              <DesktopFolderIcon
                folder={folder}
                onOpen={() => openDesktopFolder(folder)}
              />
            </div>
          ))}
        </div>
      )}

      {/* Window layer */}
      <WindowManager />

      <AvatarPet />

      {/* Dock — 全屏时隐藏 */}
      {!hasMaximized && <Dock />}

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenuItems}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}

function DesktopFolderIcon({
  folder,
  onOpen,
}: {
  folder: DesktopFolderEntry;
  onOpen: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      data-testid="desktop-folder-icon"
      className="flex flex-col items-center cursor-default select-none"
      style={{
        width: 76,
        padding: "6px 4px 4px",
        gap: 5,
        background: "transparent",
        border: "none",
        outline: "none",
      }}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        style={{
          width: 66,
          height: 58,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transform: hovered ? "translateY(-5px) scale(1.06)" : "translateY(0) scale(1)",
          transition: "transform 0.22s cubic-bezier(0.34,1.56,0.64,1)",
        }}
      >
        <img
          data-testid="desktop-folder-icon-image"
          src={MACOS_FOLDER_ICON_SRC}
          alt=""
          draggable={false}
          style={{
            width: 66,
            height: 66,
            objectFit: "contain",
            display: "block",
            filter: hovered
              ? "drop-shadow(0 10px 22px rgba(0,0,0,0.26)) drop-shadow(0 3px 8px rgba(0,0,0,0.18))"
              : "drop-shadow(0 3px 8px rgba(0,0,0,0.2))",
            transition: "filter 0.22s ease",
          }}
        />
      </div>
      <span
        style={{
          fontSize: 11,
          fontWeight: 500,
          lineHeight: 1.3,
          textAlign: "center",
          width: "100%",
          padding: "1px 2px",
          color: "#fff",
          textShadow: "0 1px 4px rgba(0,0,0,0.6), 0 0 8px rgba(0,0,0,0.3)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          display: "block",
        }}
      >
        {folder.name}
      </span>
    </button>
  );
}
