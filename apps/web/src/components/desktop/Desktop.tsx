"use client";

import { useCallback, useEffect, useState } from "react";
import { WindowManager } from "@/components/window/WindowManager";
import { Dock } from "./Dock";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import { DesktopIcon } from "./DesktopIcon";
import { useDesktopStore } from "@/stores/desktopStore";
import { useWindowStore } from "@/stores/windowStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { BUILTIN_SKILLS } from "@/lib/skill-registry";
import { DesktopClock } from "./DesktopClock";

// macOS 风格壁纸 — Unsplash 免费可商用
const WALLPAPERS = {
  "sonoma-light": "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=2560&q=90&auto=format&fit=crop",
  "monterey": "https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=2560&q=90&auto=format&fit=crop",
  "ventura": "https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=2560&q=90&auto=format&fit=crop",
  "sequoia": "https://images.unsplash.com/photo-1501854140801-50d01698950b?w=2560&q=90&auto=format&fit=crop",
};

export function Desktop() {
  const { wallpaper, skills, registerSkill } = useDesktopStore();
  const openWindow = useWindowStore((s) => s.openWindow);
  const windows = useWindowStore((s) => s.windows);
  const hasMaximized = Object.values(windows).some((w) => w.state === "maximized");
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  const { embeddingConfig, providers, defaultModel } = useSettingsStore();

  useEffect(() => {
    BUILTIN_SKILLS.forEach((skill) => registerSkill(skill, true));
  }, [registerSkill]);

  // 应用启动时自动恢复记忆管理器和知识库管理器（后端重启后 _manager 为 None）
  // 监听 embeddingConfig：Zustand persist hydration 完成后触发
  useEffect(() => {
    const cfg = embeddingConfig;
    if (!cfg?.apiKey) return;

    (async () => {
      try {
        const { decodeModel, PROVIDERS } = await import("@/skills/settings/providers");
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

        await fetch("http://localhost:8000/api/v1/memory/init", {
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

        await fetch("http://localhost:8000/api/v1/knowledge/init", {
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
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const contextMenuItems: MenuItem[] = [
    { label: "新建文件夹" },
    { type: "separator" },
    { label: "更改壁纸…", onClick: () => openWindow("settings", "设置", "Settings") },
    { label: "显示设置", onClick: () => openWindow("settings", "设置", "Settings") },
  ];

  const desktopSkills = Object.values(skills);

  // 当前壁纸 URL
  const wpUrl = wallpaper
    || WALLPAPERS["sonoma-light"];

  return (
    <div
      className="desktop-bg"
      onContextMenu={handleContextMenu}
      onClick={() => setContextMenu(null)}
    >
      {/* Wallpaper */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `url(${wpUrl})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      />

      {/* 桌面时钟 — 左上角 */}
      <DesktopClock />

      {/* Desktop icon grid — macOS 风格：纵向排列，紧贴右侧 */}
      <div
        className="absolute top-3 right-3 flex flex-col gap-1"
        style={{ zIndex: 1 }}
      >
        {desktopSkills.map((skill) => (
          <DesktopIcon key={skill.manifest.id} skill={skill} />
        ))}
      </div>

      {/* Window layer */}
      <WindowManager />

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
