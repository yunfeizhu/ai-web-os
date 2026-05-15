import { describe, expect, it } from "vitest";

import {
  DESKTOP_ICON_GRID_COLUMN_WIDTH,
  DESKTOP_ICON_GRID_ROW_HEIGHT,
  DESKTOP_ICON_GRID_STYLE,
  DESKTOP_ICON_GRID_ITEM_STYLE,
} from "./desktopIconLayout";

describe("desktop icon responsive layout", () => {
  it("uses a height-bounded column flow so overflowing icons wrap into more columns", () => {
    expect(DESKTOP_ICON_GRID_STYLE).toMatchObject({
      display: "grid",
      gridAutoFlow: "column",
      gridTemplateRows: `repeat(auto-fill, ${DESKTOP_ICON_GRID_ROW_HEIGHT}px)`,
      gridAutoColumns: DESKTOP_ICON_GRID_COLUMN_WIDTH,
      height: "calc(100dvh - 24px - var(--taskbar-h))",
      direction: "rtl",
      pointerEvents: "none",
    });
  });

  it("keeps icon content left-to-right inside the right-to-left column layout", () => {
    expect(DESKTOP_ICON_GRID_ITEM_STYLE).toMatchObject({
      direction: "ltr",
      pointerEvents: "auto",
    });
  });
});
