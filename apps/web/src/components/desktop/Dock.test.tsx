import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useDesktopStore } from "@/stores/desktopStore";
import { useWindowStore } from "@/stores/windowStore";
import type { InstalledApp } from "@/types/app";
import type { WindowState } from "@/types/window";
import { Dock } from "./Dock";
import { DOCK_BASE_ICON_SIZE } from "./dockMagnification";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

describe("Dock", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    window.localStorage.clear();
    useDesktopStore.setState({
      wallpaper: "",
      theme: "dark",
      icons: [],
      taskbarPins: [],
      apps: {
        settings: createInstalledApp("settings", "设置", "Settings"),
      },
    });
    useWindowStore.setState({
      windows: {
        "settings-window": createWindow("settings-window", "settings", "设置"),
      },
      focusOrder: ["settings-window"],
      nextZIndex: 101,
      closeGuards: {},
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    window.localStorage.clear();
  });

  it("keeps open app indicators out of Dock item layout height", () => {
    act(() => {
      root.render(<Dock />);
    });

    const button = container.querySelector('button[title="设置"]') as HTMLButtonElement | null;
    const item = button?.parentElement as HTMLDivElement | null;
    const indicator = item?.querySelector('[data-testid="dock-running-indicator"]') as
      | HTMLDivElement
      | null;

    expect(button).not.toBeNull();
    expect(item?.style.width).toBe(`${DOCK_BASE_ICON_SIZE}px`);
    expect(item?.style.height).toBe(`${DOCK_BASE_ICON_SIZE}px`);
    expect(indicator).not.toBeNull();
    expect(indicator?.style.position).toBe("absolute");
  });
});

function createInstalledApp(id: string, name: string, icon: string): InstalledApp {
  return {
    manifest: {
      id,
      name,
      version: "1.0.0",
      description: "",
      icon,
      category: "system",
      agent: {
        systemPrompt: "",
        model: "",
        temperature: 0,
        maxTokens: 0,
      },
      ui: {
        component: id,
        defaultSize: { width: 800, height: 600 },
        minSize: { width: 400, height: 300 },
        singleton: true,
      },
    },
    status: "active",
    isBuiltin: true,
    isPinned: false,
    settings: {},
  };
}

function createWindow(id: string, appId: string, title: string): WindowState {
  return {
    id,
    appId,
    title,
    icon: "Settings",
    position: { x: 0, y: 0 },
    size: { width: 800, height: 600 },
    minSize: { width: 400, height: 300 },
    state: "normal",
    zIndex: 100,
    isFocused: true,
    isAnimating: false,
  };
}
