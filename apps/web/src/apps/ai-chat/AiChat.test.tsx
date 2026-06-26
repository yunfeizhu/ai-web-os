import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSettingsStore } from "@/stores/settingsStore";
import { useWindowStore } from "@/stores/windowStore";
import { AiChat } from "./AiChat";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/hooks/useStream", () => ({
  streamChat: vi.fn(),
}));

describe("AiChat", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: vi.fn(),
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })),
    );

    useSettingsStore.setState({
      providers: {},
      defaultModel: "",
      avatarModel: "",
      language: "zh-CN",
      toolKeys: {},
      embeddingConfig: null,
    });
    useWindowStore.setState({
      windows: {},
      focusOrder: [],
      nextZIndex: 100,
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
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("renders a macOS-style chat shell with translucent sidebar and floating composer", async () => {
    await act(async () => {
      root.render(<AiChat />);
    });

    await act(async () => {});

    const shell = container.querySelector<HTMLElement>('[data-testid="ai-chat-shell"]');
    const sidebar = container.querySelector<HTMLElement>('[data-testid="ai-chat-sidebar"]');
    const header = container.querySelector<HTMLElement>('[data-testid="ai-chat-header"]');
    const composer = container.querySelector<HTMLElement>('[data-testid="ai-chat-composer"]');

    expect(shell).not.toBeNull();
    expect(sidebar).not.toBeNull();
    expect(header).not.toBeNull();
    expect(composer).not.toBeNull();
    expect(sidebar?.style.backdropFilter).toContain("blur");
    expect(header?.style.backdropFilter).toContain("blur");
    expect(composer?.style.borderRadius).toBe("24px");
  });

  it("keeps the empty state below the header instead of vertically clipping it", async () => {
    await act(async () => {
      root.render(<AiChat />);
    });

    await act(async () => {});

    const emptyState = container.querySelector<HTMLElement>(
      '[data-testid="ai-chat-empty-state"]',
    );

    expect(emptyState).not.toBeNull();
    expect(emptyState?.className).toContain("justify-start");
    expect(emptyState?.className).toContain("pt-10");
    expect(emptyState?.className).not.toContain("justify-center");
    expect(emptyState?.querySelector("svg")).toBeNull();
  });
});
