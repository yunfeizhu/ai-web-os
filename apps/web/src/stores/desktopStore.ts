import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AppManifest, InstalledApp } from "@/types/app";

interface DesktopIcon {
  appId: string;
  x: number;
  y: number;
}

interface DesktopState {
  wallpaper: string;
  theme: "dark" | "light";
  icons: DesktopIcon[];
  taskbarPins: string[];
  apps: Record<string, InstalledApp>;

  setWallpaper: (url: string) => void;
  setTheme: (theme: "dark" | "light") => void;
  setIcons: (icons: DesktopIcon[]) => void;
  addTaskbarPin: (appId: string) => void;
  removeTaskbarPin: (appId: string) => void;
  registerApp: (manifest: AppManifest, isBuiltin?: boolean) => void;
  getApp: (id: string) => InstalledApp | undefined;
}

export const useDesktopStore = create<DesktopState>()(
  persist(
    (set, get) => ({
      wallpaper: "",
      theme: "dark",
      icons: [],
      taskbarPins: [],
      apps: {},

      setWallpaper: (url) => set({ wallpaper: url }),
      setTheme: (theme) => set({ theme }),
      setIcons: (icons) => set({ icons }),

      addTaskbarPin: (appId) =>
        set((s) => ({
          taskbarPins: s.taskbarPins.includes(appId)
            ? s.taskbarPins
            : [...s.taskbarPins, appId],
        })),

      removeTaskbarPin: (appId) =>
        set((s) => ({
          taskbarPins: s.taskbarPins.filter((id) => id !== appId),
        })),

      registerApp: (manifest, isBuiltin = false) =>
        set((s) => ({
          apps: {
            ...s.apps,
            [manifest.id]: {
              manifest,
              status: "active",
              isBuiltin,
              isPinned: false,
              settings: {},
            },
          },
        })),

      getApp: (id) => get().apps[id],
    }),
    {
      name: "ainative-desktop",
      // Only persist appearance prefs; runtime state (apps, icons) is rebuilt on load
      partialize: (state) => ({
        wallpaper: state.wallpaper,
        theme: state.theme,
      }),
    },
  ),
);
