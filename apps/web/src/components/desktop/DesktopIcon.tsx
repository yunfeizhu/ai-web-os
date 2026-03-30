"use client";

import { useState } from "react";
import { useWindowStore } from "@/stores/windowStore";
import type { InstalledSkill } from "@/types/skill";
import * as Icons from "lucide-react";
import type { LucideIcon } from "lucide-react";

function getIcon(name: string): LucideIcon {
  return (Icons as unknown as Record<string, LucideIcon>)[name] ?? Icons.Box;
}

const ICON_STYLE: Record<string, { bg: string }> = {
  "ai-chat":      { bg: "linear-gradient(180deg, #5AC8FA 0%, #007AFF 100%)" },
  "file-manager": { bg: "linear-gradient(180deg, #54C7FC 0%, #147EFB 100%)" },
  "settings":     { bg: "linear-gradient(180deg, #8E8E93 0%, #636366 100%)" },
  "terminal":     { bg: "linear-gradient(180deg, #3A3A3C 0%, #1C1C1E 100%)" },
  "browser":      { bg: "linear-gradient(180deg, #5AC8FA 0%, #0A84FF 100%)" },
  "notes":        { bg: "linear-gradient(180deg, #FFD60A 0%, #FF9F0A 100%)" },
  "calendar":     { bg: "linear-gradient(180deg, #FF6961 0%, #FF3B30 100%)" },
};

const FALLBACK = { bg: "linear-gradient(180deg, #8E8E93, #636366)" };

export function DesktopIcon({ skill }: { skill: InstalledSkill }) {
  const openWindow = useWindowStore((s) => s.openWindow);
  const [hovered, setHovered] = useState(false);
  const { manifest } = skill;
  const IconComponent = getIcon(manifest.icon);
  const { bg } = ICON_STYLE[manifest.id] ?? FALLBACK;

  return (
    <button
      className="flex flex-col items-center cursor-default select-none"
      style={{
        width: 76,
        padding: "6px 4px 4px",
        gap: 5,
        background: "transparent",
        border: "none",
        outline: "none",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onDoubleClick={() =>
        openWindow(manifest.id, manifest.name, manifest.icon, {
          size: manifest.ui.defaultSize,
          minSize: manifest.ui.minSize,
        })
      }
    >
      {/* 图标：hover 时上浮 + 轻微放大 + 阴影加深 */}
      <div
        style={{
          width: 54,
          height: 54,
          borderRadius: 13,
          background: bg,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transform: hovered ? "translateY(-5px) scale(1.06)" : "translateY(0) scale(1)",
          transition: "transform 0.22s cubic-bezier(0.34,1.56,0.64,1), box-shadow 0.22s ease",
          boxShadow: hovered
            ? "0 10px 28px rgba(0,0,0,0.28), 0 4px 10px rgba(0,0,0,0.16), 0 1px 3px rgba(0,0,0,0.1)"
            : "0 2px 8px rgba(0,0,0,0.18), 0 1px 3px rgba(0,0,0,0.1)",
          // 轻微高光边缘
          border: "0.5px solid rgba(255,255,255,0.18)",
        }}
      >
        <IconComponent size={28} color="#fff" strokeWidth={1.6} />
      </div>

      {/* 标签：hover 时出现胶囊背景 */}
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
        {manifest.name}
      </span>
    </button>
  );
}
