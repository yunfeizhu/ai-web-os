import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useAvatarStore } from "@/stores/avatarStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { AvatarSettings } from "./AvatarSettings";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

describe("AvatarSettings", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    window.localStorage.clear();
    useSettingsStore.setState({
      providers: {},
      defaultModel: "",
      avatarModel: "",
    });
    useAvatarStore.setState({
      visible: true,
      bubbleOpen: false,
      modelSourceType: "url",
      modelUrl: "",
      localModelName: "",
      live2dError: "",
      currentEmotion: "neutral",
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
  });

  it("shows Live2D errors in the virtual companion settings", () => {
    useAvatarStore.setState({
      live2dError: "Use a .model3.json model URL",
    });

    act(() => {
      root.render(<AvatarSettings />);
    });

    const alert = container.querySelector('[role="alert"]');

    expect(alert).not.toBeNull();
    expect(alert?.textContent).toContain("Use a .model3.json model URL");
  });

  it("does not show a Live2D diagnostic block when there is no error", () => {
    act(() => {
      root.render(<AvatarSettings />);
    });

    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
});
