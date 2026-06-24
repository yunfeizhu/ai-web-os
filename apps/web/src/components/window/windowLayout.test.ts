import { describe, expect, it } from "vitest";

import {
  DESKTOP_DOCK_CLEARANCE,
  WINDOW_EDGE_GAP,
  clampWindowRectToWorkArea,
  getDesktopWorkArea,
  getResponsiveInitialWindowLayout,
  getResponsiveSnapTarget,
} from "./windowLayout";

describe("desktop window layout", () => {
  it("keeps large-screen default windows at their preferred size", () => {
    const layout = getResponsiveInitialWindowLayout({
      preferredSize: { width: 1100, height: 720 },
      minSize: { width: 400, height: 350 },
      viewport: { width: 1440, height: 900 },
      offset: 0,
    });

    expect(layout).toEqual({
      size: { width: 1100, height: 720 },
      minSize: { width: 400, height: 350 },
      position: { x: 170, y: 42 },
    });
  });

  it("shrinks default windows to fit above the Dock on short screens", () => {
    const layout = getResponsiveInitialWindowLayout({
      preferredSize: { width: 1100, height: 720 },
      minSize: { width: 400, height: 350 },
      viewport: { width: 1280, height: 720 },
      offset: 0,
    });

    expect(layout.size).toEqual({ width: 1100, height: 592 });
    expect(layout.position).toEqual({ x: 90, y: WINDOW_EDGE_GAP });
    expect(layout.position.y + layout.size.height).toBeLessThanOrEqual(
      720 - DESKTOP_DOCK_CLEARANCE - WINDOW_EDGE_GAP,
    );
  });

  it("allows app minimum sizes to relax when the viewport is smaller than the app", () => {
    const layout = getResponsiveInitialWindowLayout({
      preferredSize: { width: 1220, height: 760 },
      minSize: { width: 900, height: 560 },
      viewport: { width: 800, height: 600 },
      offset: 0,
    });

    expect(layout).toEqual({
      size: { width: 768, height: 472 },
      minSize: { width: 768, height: 472 },
      position: { x: WINDOW_EDGE_GAP, y: WINDOW_EDGE_GAP },
    });
  });

  it("uses the Dock-aware work area for left and right snap targets", () => {
    expect(
      getResponsiveSnapTarget("left", { width: 1280, height: 720 }),
    ).toEqual({
      position: { x: 0, y: 0 },
      size: { width: 640, height: 624 },
    });

    expect(
      getResponsiveSnapTarget("right", { width: 1280, height: 720 }),
    ).toEqual({
      position: { x: 640, y: 0 },
      size: { width: 640, height: 624 },
    });
  });

  it("clamps dragged or resized windows back above the Dock", () => {
    const rect = clampWindowRectToWorkArea({
      position: { x: 700, y: 999 },
      size: { width: 500, height: 300 },
      minSize: { width: 400, height: 300 },
      viewport: { width: 800, height: 600 },
    });

    const workArea = getDesktopWorkArea({ width: 800, height: 600 });

    expect(rect).toEqual({
      position: { x: 300, y: 204 },
      size: { width: 500, height: 300 },
    });
    expect(rect.position.y + rect.size.height).toBe(workArea.height);
  });
});
