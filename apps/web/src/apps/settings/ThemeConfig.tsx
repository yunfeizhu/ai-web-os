"use client";

import { useDesktopStore } from "@/stores/desktopStore";
import {
  LIVE_WALLPAPERS,
  normalizeWallpaperUrl,
  STATIC_WALLPAPERS,
  type WallpaperOption,
} from "@/lib/wallpapers";
import { SectionTitle } from "./Settings";

export function ThemeConfig() {
  const { wallpaper, setWallpaper, theme, setTheme } = useDesktopStore();
  const selectedWallpaper = normalizeWallpaperUrl(wallpaper);

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

      <div className="flex flex-col gap-5">
        <WallpaperSection
          title="静态壁纸"
          wallpapers={STATIC_WALLPAPERS}
          selectedWallpaper={selectedWallpaper}
          onSelect={setWallpaper}
        />
        <WallpaperSection
          title="动态壁纸"
          wallpapers={LIVE_WALLPAPERS}
          selectedWallpaper={selectedWallpaper}
          onSelect={setWallpaper}
        />
        <p className="text-[11px] mt-2" style={{ color: "var(--t3)" }}>
          静态图片来源: Unsplash；动态视频来源: Mixkit，均已缓存为本地资源
        </p>
      </div>
    </div>
  );
}

function WallpaperSection({
  title,
  wallpapers,
  selectedWallpaper,
  onSelect,
}: {
  title: string;
  wallpapers: WallpaperOption[];
  selectedWallpaper: string;
  onSelect: (url: string) => void;
}) {
  return (
    <div>
      <p
        className="mb-3 text-[13px] font-semibold"
        style={{ color: "var(--t2)" }}
      >
        {title}
      </p>
      <div className="grid grid-cols-3 gap-2.5">
        {wallpapers.map((wp) => {
          const isActive = selectedWallpaper === wp.url;
          return (
            <button
              key={wp.id}
              onClick={() => onSelect(wp.url)}
              className="group relative aspect-video overflow-hidden rounded-lg transition-all duration-200"
              aria-pressed={isActive}
              style={{
                border: isActive
                  ? "2.5px solid var(--accent)"
                  : "0.5px solid var(--border)",
                boxShadow: isActive ? "0 0 0 2px var(--accent-bg-h)" : "none",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={wp.thumb}
                alt={wp.label}
                className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
              />
              {wp.meta && (
                <span
                  className="absolute left-1.5 top-1.5 rounded-md px-1.5 py-0.5 text-[10px] font-semibold"
                  style={{
                    background: "rgba(0,0,0,0.42)",
                    color: "#fff",
                  }}
                >
                  {wp.meta}
                </span>
              )}
              <div
                className="absolute bottom-0 inset-x-0 px-1.5 py-0.5 text-[11px] font-medium"
                style={{
                  background: "linear-gradient(transparent, rgba(0,0,0,0.4))",
                  color: "#fff",
                }}
              >
                {wp.label}
              </div>
              {isActive && (
                <div
                  className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full"
                  style={{ background: "var(--accent)" }}
                >
                  <span style={{ fontSize: 9, color: "#fff", fontWeight: 700 }}>
                    ✓
                  </span>
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
