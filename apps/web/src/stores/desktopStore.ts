import { create } from "zustand";
import type { InstalledSkill, SkillManifest } from "@/types/skill";

interface DesktopIcon {
  skillId: string;
  x: number;
  y: number;
}

interface DesktopState {
  wallpaper: string;
  theme: "dark" | "light";
  icons: DesktopIcon[];
  taskbarPins: string[];
  skills: Record<string, InstalledSkill>;

  setWallpaper: (url: string) => void;
  setTheme: (theme: "dark" | "light") => void;
  setIcons: (icons: DesktopIcon[]) => void;
  addTaskbarPin: (skillId: string) => void;
  removeTaskbarPin: (skillId: string) => void;
  registerSkill: (manifest: SkillManifest, isBuiltin?: boolean) => void;
  getSkill: (id: string) => InstalledSkill | undefined;
}

export const useDesktopStore = create<DesktopState>((set, get) => ({
  wallpaper: "",
  theme: "dark",
  icons: [],
  taskbarPins: [],
  skills: {},

  setWallpaper: (url) => set({ wallpaper: url }),
  setTheme: (theme) => set({ theme }),
  setIcons: (icons) => set({ icons }),

  addTaskbarPin: (skillId) =>
    set((s) => ({
      taskbarPins: s.taskbarPins.includes(skillId)
        ? s.taskbarPins
        : [...s.taskbarPins, skillId],
    })),

  removeTaskbarPin: (skillId) =>
    set((s) => ({
      taskbarPins: s.taskbarPins.filter((id) => id !== skillId),
    })),

  registerSkill: (manifest, isBuiltin = false) =>
    set((s) => ({
      skills: {
        ...s.skills,
        [manifest.id]: {
          manifest,
          status: "active",
          isBuiltin,
          isPinned: false,
          settings: {},
        },
      },
    })),

  getSkill: (id) => get().skills[id],
}));
