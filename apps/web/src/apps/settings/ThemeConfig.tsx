"use client";

import { useDesktopStore } from "@/stores/desktopStore";
import { SectionTitle } from "./Settings";

// Unsplash 免费可商用壁纸
const WALLPAPERS = [
  {
    id: "mountain",
    label: "山脉",
    url: "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=2560&q=90&auto=format&fit=crop",
    thumb:
      "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=320&q=80&auto=format&fit=crop",
  },
  {
    id: "lake",
    label: "湖泊",
    url: "https://images.unsplash.com/photo-1439066615861-d1af74d74000?w=2560&q=90&auto=format&fit=crop",
    thumb:
      "https://images.unsplash.com/photo-1439066615861-d1af74d74000?w=320&q=80&auto=format&fit=crop",
  },
  {
    id: "forest",
    label: "森林",
    url: "https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=2560&q=90&auto=format&fit=crop",
    thumb:
      "https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=320&q=80&auto=format&fit=crop",
  },
  {
    id: "aerial",
    label: "鸟瞰",
    url: "https://images.unsplash.com/photo-1501854140801-50d01698950b?w=2560&q=90&auto=format&fit=crop",
    thumb:
      "https://images.unsplash.com/photo-1501854140801-50d01698950b?w=320&q=80&auto=format&fit=crop",
  },
  {
    id: "desert",
    label: "沙漠",
    url: "https://images.unsplash.com/photo-1509316975850-ff9c5deb0cd9?w=2560&q=90&auto=format&fit=crop",
    thumb:
      "https://images.unsplash.com/photo-1509316975850-ff9c5deb0cd9?w=320&q=80&auto=format&fit=crop",
  },
  {
    id: "ocean",
    label: "海洋",
    url: "https://images.unsplash.com/photo-1505118380757-91f5f5632de0?w=2560&q=90&auto=format&fit=crop",
    thumb:
      "https://images.unsplash.com/photo-1505118380757-91f5f5632de0?w=320&q=80&auto=format&fit=crop",
  },
];

export function ThemeConfig() {
  const { wallpaper, setWallpaper, theme, setTheme } = useDesktopStore();

  return (
    <div>
      <SectionTitle>外观</SectionTitle>

      {/* ── Theme toggle ───────────────────────────────────────── */}
      <div className="mb-6">
        <p
          className="text-[13px] font-semibold mb-3"
          style={{ color: "var(--t2)" }}
        >
          主题
        </p>
        <div className="flex gap-2.5">
          {(["light", "dark"] as const).map((t) => {
            const isActive = theme === t;
            const label = t === "light" ? "浅色" : "深色";
            const preview =
              t === "light"
                ? "linear-gradient(135deg, #f0ede8 0%, #ffffff 100%)"
                : "linear-gradient(135deg, #13131a 0%, #1c1c26 100%)";
            return (
              <button
                key={t}
                onClick={() => setTheme(t)}
                className="flex flex-col items-center gap-1.5 group"
                aria-pressed={isActive}
              >
                <div
                  className="w-24 h-14 rounded-lg transition-all duration-200"
                  style={{
                    background: preview,
                    border: isActive
                      ? "2.5px solid var(--accent)"
                      : "0.5px solid var(--border-strong)",
                    boxShadow: isActive
                      ? "0 0 0 2px var(--accent-bg-h)"
                      : "none",
                  }}
                >
                  {/* Mini desktop preview */}
                  <div className="flex flex-col h-full p-1.5 gap-1">
                    <div
                      className="h-1.5 rounded-sm w-full"
                      style={{
                        background:
                          t === "light"
                            ? "rgba(0,0,0,0.08)"
                            : "rgba(255,255,255,0.08)",
                      }}
                    />
                    <div className="flex gap-1 flex-1">
                      <div
                        className="flex-1 rounded-sm"
                        style={{
                          background:
                            t === "light"
                              ? "rgba(255,255,255,0.7)"
                              : "rgba(255,255,255,0.06)",
                        }}
                      />
                      <div
                        className="w-6 rounded-sm"
                        style={{
                          background:
                            t === "light"
                              ? "rgba(255,255,255,0.7)"
                              : "rgba(255,255,255,0.06)",
                        }}
                      />
                    </div>
                  </div>
                </div>
                <span
                  className="text-[12px] font-medium"
                  style={{ color: isActive ? "var(--accent)" : "var(--t2)" }}
                >
                  {label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Wallpaper grid ─────────────────────────────────────── */}
      <div>
        <p
          className="text-[13px] font-semibold mb-3"
          style={{ color: "var(--t2)" }}
        >
          桌面壁纸
        </p>
        <div className="grid grid-cols-3 gap-2.5">
          {WALLPAPERS.map((wp) => {
            const isActive = wallpaper === wp.url;
            return (
              <button
                key={wp.id}
                onClick={() => setWallpaper(wp.url)}
                className="relative aspect-video rounded-lg overflow-hidden transition-all duration-200 group"
                style={{
                  border: isActive
                    ? "2.5px solid var(--accent)"
                    : "0.5px solid var(--border)",
                  boxShadow: isActive
                    ? "0 0 0 2px var(--accent-bg-h)"
                    : "none",
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={wp.thumb}
                  alt={wp.label}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                />
                <div
                  className="absolute bottom-0 inset-x-0 py-0.5 px-1.5 text-[11px] font-medium"
                  style={{
                    background: "linear-gradient(transparent, rgba(0,0,0,0.4))",
                    color: "#fff",
                  }}
                >
                  {wp.label}
                </div>
                {isActive && (
                  <div
                    className="absolute top-1 right-1 w-4 h-4 rounded-full flex items-center justify-center"
                    style={{ background: "var(--accent)" }}
                  >
                    <span
                      style={{ fontSize: 9, color: "#fff", fontWeight: 700 }}
                    >
                      ✓
                    </span>
                  </div>
                )}
              </button>
            );
          })}
        </div>
        <p className="text-[11px] mt-2" style={{ color: "var(--t3)" }}>
          图片来源: Unsplash (免费可商用)
        </p>
      </div>
    </div>
  );
}
