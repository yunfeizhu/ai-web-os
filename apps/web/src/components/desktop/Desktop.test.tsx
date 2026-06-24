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

vi.mock("./Dock", () => ({
  Dock: () => <div data-testid="dock" />,
}));

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
  });

  it("keeps built-in apps off the desktop while leaving the Dock available", async () => {
    await act(async () => {
      root.render(<Desktop />);
    });

    expect(container.querySelector('[data-testid="dock"]')).not.toBeNull();
    expect(container.textContent).not.toContain("AI 助手");
    expect(container.textContent).not.toContain("文件管理器");
  });
});
