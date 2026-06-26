import { act } from "react";
import { readFileSync } from "node:fs";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useSettingsStore } from "@/stores/settingsStore";
import { Settings } from "./Settings";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

describe("Settings", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    window.localStorage.clear();
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
  });

  it("opens the appearance tab from app state", async () => {
    await act(async () => {
      root.render(<Settings appState={{ initialTab: "appearance" }} />);
    });

    expect(container.textContent).toContain("外观");
    expect(container.textContent).toContain("静态壁纸");
    expect(container.textContent).toContain("动态壁纸");
    expect(container.textContent).not.toContain("LLM 模型提供商");
  });

  it("reopens the requested tab when a new app state object asks for it again", async () => {
    await act(async () => {
      root.render(<Settings appState={{ initialTab: "appearance" }} />);
    });

    await clickButtonByText(container, "模型与密钥");

    expect(container.textContent).toContain("LLM 模型提供商");

    await act(async () => {
      root.render(<Settings appState={{ initialTab: "appearance" }} />);
    });

    expect(container.textContent).toContain("静态壁纸");
    expect(container.textContent).not.toContain("LLM 模型提供商");
  });

  it("renders model providers as a macOS grouped list", async () => {
    await act(async () => {
      root.render(<Settings />);
    });

    const group = container.querySelector('[data-testid="llm-provider-group"]');

    expect(group).not.toBeNull();
    expect(group?.getAttribute("data-variant")).toBe("macos-grouped-list");
  });

  it("uses an icon-only edit control for saved embedding configuration", async () => {
    useSettingsStore.setState({
      embeddingConfig: {
        name: "Qwen3 Embedding",
        provider: "openai",
        model: "text-embedding-v3",
        apiKey: "sk-test",
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        dims: 4096,
      },
    });

    await act(async () => {
      root.render(<Settings />);
    });

    await clickButtonByText(container, "Embedding 模型");

    const editButton = container.querySelector(
      'button[aria-label="修改 Embedding 模型配置"]',
    );

    expect(editButton).not.toBeNull();
    expect(editButton?.textContent).not.toContain("修改");
    expect(editButton?.querySelector("svg")).not.toBeNull();
  });

  it("keeps provider row layout styles scoped away from summary icon buttons", () => {
    const css = readFileSync("src/app/globals.css", "utf8");

    expect(css).not.toContain(".settings-provider-row > button");
    expect(css).not.toContain(".settings-provider-row > div");
    expect(css).toContain(".settings-provider-trigger");
    expect(css).toContain(".settings-provider-details");
  });
});

async function clickButtonByText(container: HTMLElement, text: string) {
  const button = Array.from(container.querySelectorAll("button")).find(
    (item) => item.textContent?.includes(text),
  );
  expect(button).not.toBeUndefined();

  await act(async () => {
    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}
