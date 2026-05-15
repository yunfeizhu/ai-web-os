import type { CSSProperties } from "react";

export const DESKTOP_ICON_GRID_ROW_HEIGHT = 92;
export const DESKTOP_ICON_GRID_COLUMN_WIDTH = 76;

export const DESKTOP_ICON_GRID_STYLE: CSSProperties = {
  zIndex: 1,
  display: "grid",
  gridAutoFlow: "column",
  gridTemplateRows: `repeat(auto-fill, ${DESKTOP_ICON_GRID_ROW_HEIGHT}px)`,
  gridAutoColumns: DESKTOP_ICON_GRID_COLUMN_WIDTH,
  gap: "4px 12px",
  height: "calc(100dvh - 24px - var(--taskbar-h))",
  alignContent: "start",
  justifyContent: "end",
  direction: "rtl",
  pointerEvents: "none",
};

export const DESKTOP_ICON_GRID_ITEM_STYLE: CSSProperties = {
  direction: "ltr",
  pointerEvents: "auto",
};
