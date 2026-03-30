"use client";

import { useState } from "react";
import { useDesktopStore } from "@/stores/desktopStore";
import { useWindowStore } from "@/stores/windowStore";
import { Search } from "lucide-react";
import * as Icons from "lucide-react";
import type { LucideIcon } from "lucide-react";

function getIcon(name: string): LucideIcon {
  return (Icons as unknown as Record<string, LucideIcon>)[name] ?? Icons.Box;
}

const ICON_BG: Record<string, string> = {
  "ai-chat":      "linear-gradient(180deg, #5Ac8FA, #007AFF)",
  "file-manager": "linear-gradient(180deg, #54C7FC, #147EFB)",
  "settings":     "linear-gradient(180deg, #8E8E93, #636366)",
  "terminal":     "linear-gradient(180deg, #3A3A3C, #1C1C1E)",
  "browser":      "linear-gradient(180deg, #5AC8FA, #0A84FF)",
  "notes":        "linear-gradient(180deg, #FFD60A, #FF9F0A)",
  "calendar":     "linear-gradient(180deg, #FF453A, #D70015)",
};

export function StartMenu({ onClose }: { onClose: () => void }) {
  const skills = useDesktopStore((s) => s.skills);
  const openWindow = useWindowStore((s) => s.openWindow);
  const [query, setQuery] = useState("");

  const filtered = Object.values(skills).filter((s) =>
    !query ||
    s.manifest.name.toLowerCase().includes(query.toLowerCase()) ||
    s.manifest.description.toLowerCase().includes(query.toLowerCase()),
  );

  const handleOpen = (skillId: string) => {
    const s = skills[skillId];
    if (!s) return;
    openWindow(skillId, s.manifest.name, s.manifest.icon, {
      size: s.manifest.ui.defaultSize,
      minSize: s.manifest.ui.minSize,
    });
    onClose();
  };

  return (
    <>
      <div className="fixed inset-0" style={{ zIndex: 9998 }} onClick={onClose} />
      <div
        className="fixed inset-0 flex flex-col items-center pt-24"
        style={{
          zIndex: 9999,
          background: "rgba(240,240,245,0.70)",
          backdropFilter: "blur(40px) saturate(180%)",
          WebkitBackdropFilter: "blur(40px) saturate(180%)",
        }}
        onClick={onClose}
      >
        {/* Search */}
        <div
          className="w-64 flex items-center gap-2 px-3 py-2 rounded-lg mb-8"
          style={{
            background: "rgba(0,0,0,0.06)",
            border: "0.5px solid rgba(0,0,0,0.08)",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <Search size={14} color="rgba(0,0,0,0.35)" />
          <input
            autoFocus
            type="text"
            placeholder="搜索"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1 bg-transparent outline-none text-[14px] placeholder:text-black/30"
            style={{ color: "var(--t1)" }}
          />
        </div>

        {/* App grid */}
        <div
          className="grid grid-cols-5 gap-x-10 gap-y-6"
          onClick={(e) => e.stopPropagation()}
        >
          {filtered.map((skill) => {
            const IconComp = getIcon(skill.manifest.icon);
            const bg = ICON_BG[skill.manifest.id] ?? "linear-gradient(180deg, #8E8E93, #636366)";
            return (
              <button
                key={skill.manifest.id}
                onClick={() => handleOpen(skill.manifest.id)}
                className="flex flex-col items-center gap-1.5 group"
              >
                <div
                  className="w-16 h-16 flex items-center justify-center transition-transform duration-150 group-hover:scale-110"
                  style={{
                    background: bg,
                    borderRadius: 16,
                    boxShadow: "0 2px 10px rgba(0,0,0,0.18)",
                  }}
                >
                  <IconComp size={30} color="#fff" strokeWidth={1.7} />
                </div>
                <span
                  className="text-[11px] font-medium"
                  style={{ color: "var(--t1)" }}
                >
                  {skill.manifest.name}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
