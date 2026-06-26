import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WhiteboardApp } from "./WhiteboardApp";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

describe("WhiteboardApp", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })),
    );

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

  it("uses a macOS-style sidebar and icon-first creation control", async () => {
    await act(async () => {
      root.render(<WhiteboardApp windowId="whiteboard-test" />);
    });

    await act(async () => {});

    const shell = container.querySelector<HTMLElement>('[data-testid="whiteboard-macos-shell"]');
    const sidebar = container.querySelector<HTMLElement>('[data-testid="whiteboard-sidebar"]');
    const createButton = container.querySelector<HTMLElement>('button[aria-label="新建白板"]');

    expect(shell).not.toBeNull();
    expect(sidebar).not.toBeNull();
    expect(sidebar?.style.backdropFilter).toContain("blur");
    expect(createButton).not.toBeNull();
    expect(createButton?.textContent).not.toContain("新建白板");
    expect(createButton?.style.background).toBe("rgba(255, 255, 255, 0.66)");
  });
});
