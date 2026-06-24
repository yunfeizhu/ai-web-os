import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WindowState } from "@/types/window";
import { TitleBar } from "./TitleBar";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const baseWindow: WindowState = {
  id: "window-1",
  appId: "notes",
  title: "笔记",
  icon: "FileText",
  position: { x: 24, y: 24 },
  size: { width: 640, height: 420 },
  minSize: { width: 360, height: 260 },
  state: "normal",
  zIndex: 100,
  isFocused: true,
  isAnimating: false,
};

describe("TitleBar", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
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

  it("renders traffic-light glyphs as SVG icons instead of text characters", () => {
    act(() => {
      root.render(
        <TitleBar
          window={baseWindow}
          onClose={vi.fn()}
          onMinimize={vi.fn()}
          onToggleMaximize={vi.fn()}
        />,
      );
    });

    const trafficLights = container.querySelectorAll<HTMLButtonElement>(
      "[data-window-control]",
    );

    expect(trafficLights).toHaveLength(3);
    trafficLights.forEach((button) => {
      expect(button.querySelector("svg")).not.toBeNull();
      expect(button.textContent).toBe("");
    });
  });
});
