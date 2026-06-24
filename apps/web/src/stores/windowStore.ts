import { create } from "zustand";
import type { WindowState, WindowDisplayState } from "@/types/window";
import { generateId } from "@/lib/utils";
import {
  clampWindowRectToWorkArea,
  getResponsiveInitialWindowLayout,
} from "@/components/window/windowLayout";

interface WindowManagerState {
  windows: Record<string, WindowState>;
  focusOrder: string[];
  nextZIndex: number;
  closeGuards: Record<string, () => boolean | Promise<boolean>>;

  openWindow: (
    appId: string,
    title: string,
    icon: string,
    options?: OpenWindowOptions,
  ) => string;
  closeWindow: (id: string) => void;
  canCloseWindow: (id: string) => Promise<boolean>;
  registerCloseGuard: (id: string, guard: () => boolean | Promise<boolean>) => void;
  unregisterCloseGuard: (id: string) => void;
  focusWindow: (id: string) => void;
  minimizeWindow: (id: string) => void;
  requestMinimize: (id: string) => void;
  maximizeWindow: (id: string) => void;
  restoreWindow: (id: string) => void;
  toggleMaximize: (id: string) => void;
  updatePosition: (id: string, x: number, y: number) => void;
  updateSize: (id: string, width: number, height: number) => void;
  snapWindow: (
    id: string,
    x: number,
    y: number,
    width: number,
    height: number,
  ) => void;
  setWindowState: (id: string, state: WindowDisplayState) => void;
  updateAppState: (id: string, state: Record<string, unknown>) => void;
}

type OpenWindowOptions = Partial<WindowState> & {
  singleton?: boolean;
  instanceKey?: string;
};

const DEFAULT_SIZE = { width: 960, height: 680 };
const DEFAULT_MIN_SIZE = { width: 400, height: 300 };

export const useWindowStore = create<WindowManagerState>((set, get) => ({
  windows: {},
  focusOrder: [],
  nextZIndex: 100,
  closeGuards: {},

  openWindow: (appId, title, icon, options) => {
    const state = get();
    const existing = options?.instanceKey
      ? Object.values(state.windows).find(
          (w) => w.appId === appId && w.instanceKey === options.instanceKey,
        )
      : options?.singleton !== false
        ? Object.values(state.windows).find(
            (w) => w.appId === appId,
          )
        : undefined;
    if (existing) {
      get().focusWindow(existing.id);
      if (existing.state === "minimized") {
        get().restoreWindow(existing.id);
      }
      return existing.id;
    }

    const id = generateId();
    const offset = Object.keys(state.windows).length * 30;
    const initialLayout = getResponsiveInitialWindowLayout({
      preferredSize: options?.size ?? DEFAULT_SIZE,
      minSize: options?.minSize ?? DEFAULT_MIN_SIZE,
      offset,
    });
    const initialRect = options?.position
      ? clampWindowRectToWorkArea({
          position: options.position,
          size: initialLayout.size,
          minSize: initialLayout.minSize,
        })
      : initialLayout;

    const newWindow: WindowState = {
      id,
      appId,
      instanceKey: options?.instanceKey,
      title,
      icon,
      position: initialRect.position,
      size: initialRect.size,
      minSize: initialLayout.minSize,
      state: "normal",
      zIndex: state.nextZIndex,
      isFocused: true,
      isAnimating: false,
      appState: options?.appState,
    };

    set((s) => ({
      windows: {
        ...Object.fromEntries(
          Object.entries(s.windows).map(([k, w]) => [
            k,
            { ...w, isFocused: false },
          ]),
        ),
        [id]: newWindow,
      },
      focusOrder: [...s.focusOrder, id],
      nextZIndex: s.nextZIndex + 1,
    }));

    return id;
  },

  closeWindow: (id) => {
    set((s) => {
      const { [id]: _, ...rest } = s.windows;
      const focusOrder = s.focusOrder.filter((wid) => wid !== id);
      const topId = focusOrder[focusOrder.length - 1];
      return {
        windows: topId
          ? {
              ...Object.fromEntries(
                Object.entries(rest).map(([k, w]) => [
                  k,
                  { ...w, isFocused: k === topId },
                ]),
              ),
            }
          : rest,
        focusOrder,
      };
    });
  },

  canCloseWindow: async (id) => {
    const guard = get().closeGuards[id];
    if (!guard) return true;
    try {
      return await guard();
    } catch {
      return false;
    }
  },

  registerCloseGuard: (id, guard) => {
    set((s) => ({
      closeGuards: {
        ...s.closeGuards,
        [id]: guard,
      },
    }));
  },

  unregisterCloseGuard: (id) => {
    set((s) => {
      const { [id]: _, ...rest } = s.closeGuards;
      return { closeGuards: rest };
    });
  },

  focusWindow: (id) => {
    set((s) => {
      if (!s.windows[id]) return s;
      const focusOrder = [...s.focusOrder.filter((wid) => wid !== id), id];
      return {
        windows: Object.fromEntries(
          Object.entries(s.windows).map(([k, w]) => [
            k,
            {
              ...w,
              isFocused: k === id,
              zIndex: k === id ? s.nextZIndex : w.zIndex,
            },
          ]),
        ),
        focusOrder,
        nextZIndex: s.nextZIndex + 1,
      };
    });
  },

  minimizeWindow: (id) => {
    set((s) => {
      if (!s.windows[id]) return s;
      const focusOrder = s.focusOrder.filter((wid) => wid !== id);
      const topId = focusOrder[focusOrder.length - 1];
      return {
        windows: Object.fromEntries(
          Object.entries(s.windows).map(([k, w]) => [
            k,
            {
              ...w,
              state: k === id ? ("minimized" as const) : w.state,
              isFocused: k === topId,
              pendingMinimize: k === id ? false : w.pendingMinimize,
            },
          ]),
        ),
        focusOrder,
      };
    });
  },

  requestMinimize: (id) => {
    set((s) => {
      if (!s.windows[id]) return s;
      return {
        windows: {
          ...s.windows,
          [id]: { ...s.windows[id], pendingMinimize: true },
        },
      };
    });
  },

  maximizeWindow: (id) => {
    set((s) => {
      const w = s.windows[id];
      if (!w) return s;
      return {
        windows: {
          ...s.windows,
          [id]: {
            ...w,
            state: "maximized",
            // 保存最大化前的位置和尺寸
            preMaximizeSnapshot: { position: w.position, size: w.size },
          },
        },
      };
    });
  },

  restoreWindow: (id) => {
    const state = get();
    set((s) => ({
      windows: {
        ...Object.fromEntries(
          Object.entries(s.windows).map(([k, w]) => {
            if (k !== id) return [k, { ...w, isFocused: false }];
            const snap = w.preMaximizeSnapshot;
            const rect = clampWindowRectToWorkArea({
              position: snap?.position ?? w.position,
              size: snap?.size ?? w.size,
              minSize: w.minSize,
            });
            return [
              k,
              {
                ...w,
                state: "normal" as const,
                isFocused: true,
                zIndex: s.nextZIndex,
                position: rect.position,
                size: rect.size,
                preMaximizeSnapshot: undefined,
              },
            ];
          }),
        ),
      },
      focusOrder: [...state.focusOrder.filter((wid) => wid !== id), id],
      nextZIndex: s.nextZIndex + 1,
    }));
  },

  toggleMaximize: (id) => {
    const w = get().windows[id];
    if (!w) return;
    // 已最大化 或 有 snap 快照（半屏状态） → 还原
    if (w.state === "maximized" || w.preMaximizeSnapshot) {
      get().restoreWindow(id);
    } else {
      get().maximizeWindow(id);
    }
  },

  updatePosition: (id, x, y) => {
    set((s) => ({
      windows: {
        ...s.windows,
        [id]: s.windows[id]
          ? {
              ...s.windows[id],
              ...clampWindowRectToWorkArea({
                position: { x, y },
                size: s.windows[id].size,
                minSize: s.windows[id].minSize,
              }),
            }
          : s.windows[id],
      },
    }));
  },

  updateSize: (id, width, height) => {
    set((s) => ({
      windows: {
        ...s.windows,
        [id]: s.windows[id]
          ? {
              ...s.windows[id],
              ...clampWindowRectToWorkArea({
                position: s.windows[id].position,
                size: { width, height },
                minSize: s.windows[id].minSize,
              }),
            }
          : s.windows[id],
      },
    }));
  },

  snapWindow: (id, x, y, width, height) => {
    set((s) => {
      const w = s.windows[id];
      if (!w) return s;
      return {
        windows: {
          ...s.windows,
          [id]: {
            ...w,
            position: { x, y },
            size: { width, height },
            // 保存 snap 前的快照（如果还没有的话）
            preMaximizeSnapshot: w.preMaximizeSnapshot ?? {
              position: w.position,
              size: w.size,
            },
          },
        },
      };
    });
  },

  setWindowState: (id, state) => {
    set((s) => ({
      windows: {
        ...s.windows,
        [id]: s.windows[id] ? { ...s.windows[id], state } : s.windows[id],
      },
    }));
  },

  updateAppState: (id, appState) => {
    set((s) => ({
      windows: {
        ...s.windows,
        [id]: s.windows[id]
          ? {
              ...s.windows[id],
              appState: { ...s.windows[id].appState, ...appState },
            }
          : s.windows[id],
      },
    }));
  },
}));
