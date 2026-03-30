"use client";

import { useDesktopStore } from "@/stores/desktopStore";
import { SectionTitle } from "./Settings";

// Unsplash 免费可商用壁纸
const WALLPAPERS = [
  {
    id: "mountain",
    label: "山脉",
    url: "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=2560&q=90&auto=format&fit=crop",
    thumb: "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=320&q=80&auto=format&fit=crop",
  },
  {
    id: "lake",
    label: "湖泊",
    url: "https://images.unsplash.com/photo-1439066615861-d1af74d74000?w=2560&q=90&auto=format&fit=crop",
    thumb: "https://images.unsplash.com/photo-1439066615861-d1af74d74000?w=320&q=80&auto=format&fit=crop",
  },
  {
    id: "forest",
    label: "森林",
    url: "https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=2560&q=90&auto=format&fit=crop",
    thumb: "https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=320&q=80&auto=format&fit=crop",
  },
  {
    id: "aerial",
    label: "鸟瞰",
    url: "https://images.unsplash.com/photo-1501854140801-50d01698950b?w=2560&q=90&auto=format&fit=crop",
    thumb: "https://images.unsplash.com/photo-1501854140801-50d01698950b?w=320&q=80&auto=format&fit=crop",
  },
  {
    id: "desert",
    label: "沙漠",
    url: "https://images.unsplash.com/photo-1509316975850-ff9c5deb0cd9?w=2560&q=90&auto=format&fit=crop",
    thumb: "https://images.unsplash.com/photo-1509316975850-ff9c5deb0cd9?w=320&q=80&auto=format&fit=crop",
  },
  {
    id: "ocean",
    label: "海洋",
    url: "https://images.unsplash.com/photo-1505118380757-91f5f5632de0?w=2560&q=90&auto=format&fit=crop",
    thumb: "https://images.unsplash.com/photo-1505118380757-91f5f5632de0?w=320&q=80&auto=format&fit=crop",
  },
];

export function ThemeConfig() {
  const { wallpaper, setWallpaper } = useDesktopStore();

  return (
    <div>
      <SectionTitle>外观</SectionTitle>

      <div>
        <p className="text-[12px] font-semibold mb-3" style={{ color: "var(--t2)" }}>
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
                    : "0.5px solid rgba(0,0,0,0.12)",
                  boxShadow: isActive ? "0 0 0 2px rgba(0,122,255,0.25)" : "none",
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={wp.thumb}
                  alt={wp.label}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                />
                <div
                  className="absolute bottom-0 inset-x-0 py-0.5 px-1.5 text-[10px] font-medium"
                  style={{ background: "linear-gradient(transparent, rgba(0,0,0,0.4))", color: "#fff" }}
                >
                  {wp.label}
                </div>
                {isActive && (
                  <div className="absolute top-1 right-1 w-4 h-4 rounded-full flex items-center justify-center"
                    style={{ background: "var(--accent)" }}>
                    <span style={{ fontSize: 9, color: "#fff", fontWeight: 700 }}>✓</span>
                  </div>
                )}
              </button>
            );
          })}
        </div>
        <p className="text-[10px] mt-2" style={{ color: "var(--t3)" }}>
          图片来源: Unsplash (免费可商用)
        </p>
      </div>
    </div>
  );
}
