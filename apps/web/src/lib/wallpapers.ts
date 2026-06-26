export type WallpaperKind = "image" | "video";

export interface WallpaperOption {
  id: string;
  label: string;
  url: string;
  thumb: string;
  kind: WallpaperKind;
  meta?: string;
}

export const STATIC_WALLPAPERS: WallpaperOption[] = [
  {
    id: "mountain",
    label: "山脉",
    url: "/wallpapers/mountain.jpg",
    thumb: "/wallpapers/mountain-thumb.jpg",
    kind: "image",
  },
  {
    id: "lake",
    label: "湖泊",
    url: "/wallpapers/lake.jpg",
    thumb: "/wallpapers/lake-thumb.jpg",
    kind: "image",
  },
  {
    id: "forest",
    label: "森林",
    url: "/wallpapers/forest.jpg",
    thumb: "/wallpapers/forest-thumb.jpg",
    kind: "image",
  },
  {
    id: "aerial",
    label: "鸟瞰",
    url: "/wallpapers/aerial.jpg",
    thumb: "/wallpapers/aerial-thumb.jpg",
    kind: "image",
  },
  {
    id: "desert",
    label: "沙漠",
    url: "/wallpapers/desert.jpg",
    thumb: "/wallpapers/desert-thumb.jpg",
    kind: "image",
  },
  {
    id: "ocean",
    label: "海洋",
    url: "/wallpapers/ocean.jpg",
    thumb: "/wallpapers/ocean-thumb.jpg",
    kind: "image",
  },
];

export const LIVE_WALLPAPERS: WallpaperOption[] = [
  {
    id: "turquoise-bay",
    label: "海湾航拍",
    url: "/wallpapers/live/turquoise-bay-4k.mp4",
    thumb: "/wallpapers/live/turquoise-bay-thumb.jpg",
    kind: "video",
    meta: "4K MP4",
  },
  {
    id: "alps",
    label: "阿尔卑斯",
    url: "/wallpapers/live/alps-4k.mp4",
    thumb: "/wallpapers/live/alps-thumb.jpg",
    kind: "video",
    meta: "4K MP4",
  },
  {
    id: "lake-sunset",
    label: "日落湖泊",
    url: "/wallpapers/live/lake-sunset-4k.mp4",
    thumb: "/wallpapers/live/lake-sunset-thumb.jpg",
    kind: "video",
    meta: "4K MP4",
  },
  {
    id: "waterfall-forest",
    label: "森林瀑布",
    url: "/wallpapers/live/waterfall-forest-4k.mp4",
    thumb: "/wallpapers/live/waterfall-forest-thumb.jpg",
    kind: "video",
    meta: "4K MP4",
  },
];

export const WALLPAPERS = STATIC_WALLPAPERS;
export const WALLPAPER_OPTIONS = [...STATIC_WALLPAPERS, ...LIVE_WALLPAPERS];

export const DEFAULT_WALLPAPER_URL = STATIC_WALLPAPERS[0].url;

const LEGACY_WALLPAPER_KEYS: Record<string, string> = {
  "sonoma-light": "/wallpapers/mountain.jpg",
  "monterey": "/wallpapers/monterey.jpg",
  "ventura": "/wallpapers/forest.jpg",
  "sequoia": "/wallpapers/aerial.jpg",
};

const LEGACY_UNSPLASH_PHOTO_IDS: Record<string, string> = {
  "photo-1506905925346-21bda4d32df4": "/wallpapers/mountain.jpg",
  "photo-1439066615861-d1af74d74000": "/wallpapers/lake.jpg",
  "photo-1470071459604-3b5ec3a7fe05": "/wallpapers/forest.jpg",
  "photo-1501854140801-50d01698950b": "/wallpapers/aerial.jpg",
  "photo-1509316975850-ff9c5deb0cd9": "/wallpapers/desert.jpg",
  "photo-1505118380757-91f5f5632de0": "/wallpapers/ocean.jpg",
  "photo-1464822759023-fed622ff2c3b": "/wallpapers/monterey.jpg",
};

const LEGACY_MIXKIT_VIDEO_IDS: Record<string, string> = {
  "5008": "/wallpapers/live/turquoise-bay-4k.mp4",
  "4132": "/wallpapers/live/alps-4k.mp4",
  "4998": "/wallpapers/live/lake-sunset-4k.mp4",
  "2213": "/wallpapers/live/waterfall-forest-4k.mp4",
};

export function normalizeWallpaperUrl(wallpaper: string | null | undefined) {
  if (!wallpaper) return DEFAULT_WALLPAPER_URL;
  if (LEGACY_WALLPAPER_KEYS[wallpaper]) {
    return LEGACY_WALLPAPER_KEYS[wallpaper];
  }
  for (const [photoId, localUrl] of Object.entries(LEGACY_UNSPLASH_PHOTO_IDS)) {
    if (wallpaper.includes(photoId)) return localUrl;
  }
  for (const [videoId, localUrl] of Object.entries(LEGACY_MIXKIT_VIDEO_IDS)) {
    if (
      wallpaper.includes(`/videos/${videoId}/`) ||
      wallpaper.includes(`${videoId}-2160.mp4`)
    ) {
      return localUrl;
    }
  }
  return wallpaper;
}

export function getWallpaperByUrl(wallpaper: string | null | undefined) {
  const normalizedWallpaper = normalizeWallpaperUrl(wallpaper);
  return WALLPAPER_OPTIONS.find((option) => option.url === normalizedWallpaper);
}
