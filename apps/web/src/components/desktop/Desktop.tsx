"use client";

import { useCallback, useEffect, useState } from "react";
import { WindowManager } from "@/components/window/WindowManager";
import { Dock } from "./Dock";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import { DesktopIcon } from "./DesktopIcon";
import { useDesktopStore } from "@/stores/desktopStore";
import { useWindowStore } from "@/stores/windowStore";
import { BUILTIN_SKILLS } from "@/lib/skill-registry";

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
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    BUILTIN_SKILLS.forEach((skill) => registerSkill(skill, true));
  }, [registerSkill]);

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

      {/* Dock */}
      <Dock />

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
