import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDesktopStore } from "@/stores/desktopStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useWindowStore } from "@/stores/windowStore";
import { Desktop } from "./Desktop";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/components/window/WindowManager", () => ({
  WindowManager: () => <div data-testid="window-layer" />,
}));

vi.mock("./AvatarPet", () => ({
  AvatarPet: () => <div data-testid="avatar-pet" />,
}));

vi.mock("./DesktopClock", () => ({
  DesktopClock: () => <div data-testid="desktop-clock" />,
}));

vi.mock("./DesktopWeatherWidget", () => ({
  DesktopWeatherWidget: () => <div data-testid="desktop-weather" />,
}));

vi.mock("./Dock", () => ({
  Dock: () => <div data-testid="dock" />,
}));

const createdDesktopFolder = {
  id: "desktop-folder-1",
  name: "新建文件夹",
  path: "/root/Desktop/新建文件夹",
  parent_path: "/root/Desktop",
  kind: "dir",
  mime_type: "inode/directory",
  size: 0,
  created_at: "2026-06-24T00:00:00Z",
  updated_at: "2026-06-24T00:00:00Z",
  extra: {},
};

describe("Desktop", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    window.localStorage.clear();
    useDesktopStore.setState({
      wallpaper: "",
      theme: "dark",
      icons: [],
      taskbarPins: [],
      apps: {},
    });
    useWindowStore.setState({
      windows: {},
      focusOrder: [],
      nextZIndex: 100,
      closeGuards: {},
    });
    useSettingsStore.setState({
      providers: {},
      defaultModel: "",
      avatarModel: "",
      language: "zh-CN",
      toolKeys: {},
      embeddingConfig: null,
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
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps built-in apps off the desktop while leaving the Dock available", async () => {
    await act(async () => {
      root.render(<Desktop />);
    });

    expect(container.querySelector('[data-testid="dock"]')).not.toBeNull();
    expect(container.textContent).not.toContain("AI 助手");
    expect(container.textContent).not.toContain("文件管理器");
  });

  it("renders selected live wallpapers as a muted looping video", async () => {
    useDesktopStore.setState({
      wallpaper: "/wallpapers/live/turquoise-bay-4k.mp4",
    });

    await act(async () => {
      root.render(<Desktop />);
    });

    const video = container.querySelector<HTMLVideoElement>(
      '[data-testid="desktop-live-wallpaper"]',
    );

    expect(video).not.toBeNull();
    expect(video?.getAttribute("src")).toBe(
      "/wallpapers/live/turquoise-bay-4k.mp4",
    );
    expect(video?.getAttribute("poster")).toBe(
      "/wallpapers/live/turquoise-bay-thumb.jpg",
    );
    expect(video?.muted).toBe(true);
    expect(video?.loop).toBe(true);
  });

  it("opens wallpaper and appearance context menu actions in the appearance settings tab", async () => {
    await act(async () => {
      root.render(<Desktop />);
    });

    openDesktopContextMenu(container);

    expect(getButtonByText(container, "外观设置")).not.toBeNull();
    expect(getButtonByText(container, "显示设置")).toBeNull();

    await clickButtonByText(container, "更改壁纸…");

    const settingsWindow = Object.values(useWindowStore.getState().windows)
      .find((windowState) => windowState.appId === "settings");

    expect(settingsWindow?.appState).toEqual({ initialTab: "appearance" });
  });

  it("creates a desktop folder from the first context menu action", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => createdDesktopFolder,
      text: async () => "",
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(<Desktop />);
    });

    openDesktopContextMenu(container);
    await clickButtonByText(container, "新建文件夹");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8000/api/v1/files/desktop/folders",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "新建文件夹" }),
      }),
    );
    expect(getButtonByText(container, "新建文件夹")).not.toBeNull();
  });

  it("renders desktop folders with the macOS folder png icon", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => createdDesktopFolder,
        text: async () => "",
      }),
    );

    await act(async () => {
      root.render(<Desktop />);
    });

    openDesktopContextMenu(container);
    await clickButtonByText(container, "新建文件夹");

    const icon = container.querySelector<HTMLImageElement>(
      '[data-testid="desktop-folder-icon-image"]',
    );

    expect(icon).not.toBeNull();
    expect(icon?.getAttribute("src")).toBe("/icons/macos/folder.png");
  });

  it("opens a created desktop folder in file manager on double click", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => createdDesktopFolder,
        text: async () => "",
      }),
    );

    await act(async () => {
      root.render(<Desktop />);
    });

    openDesktopContextMenu(container);
    await clickButtonByText(container, "新建文件夹");

    const folderButton = getButtonByText(container, "新建文件夹");
    expect(folderButton).not.toBeNull();

    await act(async () => {
      folderButton?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });

    const fileManagerWindow = Object.values(useWindowStore.getState().windows)
      .find((windowState) => windowState.appId === "file-manager");

    expect(fileManagerWindow?.appState).toEqual({
      initialPath: "/root/Desktop/新建文件夹",
    });
  });
});

function openDesktopContextMenu(container: HTMLElement) {
  const desktop = container.querySelector(".desktop-bg");
  expect(desktop).not.toBeNull();

  act(() => {
    desktop?.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        clientX: 80,
        clientY: 90,
      }),
    );
  });
}

async function clickButtonByText(container: HTMLElement, text: string) {
  const button = getButtonByText(container, text);
  expect(button).not.toBeNull();

  await act(async () => {
    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function getButtonByText(container: HTMLElement, text: string) {
  return Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent?.includes(text),
  ) ?? null;
}
