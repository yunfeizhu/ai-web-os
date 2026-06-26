import { describe, expect, it } from "vitest";

import {
  getWallpaperByUrl,
  LIVE_WALLPAPERS,
  normalizeWallpaperUrl,
  STATIC_WALLPAPERS,
} from "./wallpapers";

describe("wallpaper catalog", () => {
  it("keeps static and live wallpapers as separate local catalogs", () => {
    expect(STATIC_WALLPAPERS.length).toBeGreaterThan(0);
    expect(LIVE_WALLPAPERS).toHaveLength(4);
    expect(LIVE_WALLPAPERS.every((wallpaper) => wallpaper.kind === "video"))
      .toBe(true);
    expect(LIVE_WALLPAPERS.every((wallpaper) => wallpaper.url.endsWith(".mp4")))
      .toBe(true);
    expect(LIVE_WALLPAPERS.every((wallpaper) => wallpaper.url.startsWith("/wallpapers/live/")))
      .toBe(true);
  });

  it("resolves selected and legacy video wallpaper urls to catalog entries", () => {
    const liveWallpaper = LIVE_WALLPAPERS[0];

    expect(getWallpaperByUrl(liveWallpaper.url)).toEqual(liveWallpaper);
    expect(
      normalizeWallpaperUrl(
        "https://assets.mixkit.co/videos/5008/5008-2160.mp4",
      ),
    ).toBe("/wallpapers/live/turquoise-bay-4k.mp4");
  });
});
