import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSettingsStore } from "@/stores/settingsStore";
import { AvatarBubble } from "./AvatarBubble";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

describe("AvatarBubble", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    window.localStorage.clear();
    useSettingsStore.setState({
      providers: {
        custom_1775624383002_i47a: {
          apiKey: "test-key",
          enabledModels: ["kimi-k2.6"],
          isCustom: true,
        },
      },
      defaultModel: "custom_1775624383002_i47a::kimi-k2.6",
      avatarModel: "",
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

  it("shows a user-facing custom provider label instead of the generated id", () => {
    act(() => {
      root.render(<AvatarBubble />);
    });

    expect(container.textContent).toContain("自定义模型 · kimi-k2.6");
    expect(container.textContent).not.toContain("custom_1775624383002_i47a");
  });

  it("labels the full chat launcher so the top-right action is clear", () => {
    act(() => {
      root.render(<AvatarBubble />);
    });

    const launcher = container.querySelector<HTMLButtonElement>(
      'button[aria-label="打开完整 AI 助手"]',
    );

    expect(launcher).not.toBeNull();
    expect(launcher?.textContent).toContain("完整对话");
  });
});
