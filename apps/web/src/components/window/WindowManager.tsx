"use client";

import { useEffect, useMemo, useState } from "react";
import { useWindowStore } from "@/stores/windowStore";
import { Window } from "./Window";
import { AppRenderer } from "@/apps/AppRenderer";
import { WindowSnapZoneOverlay, type SnapZone } from "./WindowSnapZone";
import type { WindowState } from "@/types/window";

type Rect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

type ViewportSize = {
  width: number;
  height: number;
};

const DEFAULT_VIEWPORT: ViewportSize = { width: 1920, height: 1080 };

// Apps that still keep important in-component state or live sessions today.
// They stay mounted while hidden until those apps expose reliable suspend/resume snapshots.
const KEEP_ALIVE_APP_IDS = new Set([
  "ai-chat",
  "browser",
  "terminal",
  "notes",
  "document-editor",
  "text-editor",
  "spreadsheet-viewer",
  "whiteboard",
  "mail",
]);

export function WindowManager() {
  const windows = useWindowStore((s) => s.windows);
  const [activeSnapZone, setActiveSnapZone] = useState<SnapZone>(null);
  const viewport = useViewportSize();
  const visibilityById = useMemo(
    () => computeWindowVisibility(Object.values(windows), viewport),
    [windows, viewport],
  );

  return (
    <div
      className="absolute inset-0 overflow-hidden"
      onContextMenu={(event) => {
        if (event.target === event.currentTarget) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <WindowSnapZoneOverlay activeZone={activeSnapZone} />
      {Object.values(windows).map((win) => (
        <Window
          key={win.id}
          window={win}
          onSnapZoneChange={setActiveSnapZone}
          contentVirtualized={!visibilityById[win.id]?.shouldRenderContent}
        >
          {visibilityById[win.id]?.shouldRenderContent ? (
            <AppRenderer appId={win.appId} appState={win.appState} windowId={win.id} />
          ) : null}
        </Window>
      ))}
    </div>
  );
}

function useViewportSize(): ViewportSize {
  const [viewport, setViewport] = useState<ViewportSize>(() => {
    if (typeof window === "undefined") return DEFAULT_VIEWPORT;
    return { width: window.innerWidth, height: window.innerHeight };
  });

  useEffect(() => {
    const update = () => {
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return viewport;
}

function computeWindowVisibility(
  windows: WindowState[],
  viewport: ViewportSize,
): Record<string, { visible: boolean; shouldRenderContent: boolean }> {
  const visibleWindows = windows
    .filter((win) => win.state !== "minimized")
    .sort((a, b) => a.zIndex - b.zIndex);

  const result: Record<string, { visible: boolean; shouldRenderContent: boolean }> = {};

  for (const win of windows) {
    if (win.state === "minimized") {
      result[win.id] = { visible: false, shouldRenderContent: false };
      continue;
    }

    const rect = getWindowRect(win, viewport);
    const clipped = intersectRects(rect, {
      left: 0,
      top: 0,
      right: viewport.width,
      bottom: viewport.height,
    });
    const visible = clipped
      ? !isFullyCovered(
          clipped,
          visibleWindows
            .filter((candidate) => candidate.zIndex > win.zIndex)
            .map((candidate) => getWindowRect(candidate, viewport)),
        )
      : false;

    result[win.id] = {
      visible,
      shouldRenderContent: visible || win.isFocused || KEEP_ALIVE_APP_IDS.has(win.appId),
    };
  }

  return result;
}

function getWindowRect(win: WindowState, viewport: ViewportSize): Rect {
  if (win.state === "maximized") {
    return {
      left: 0,
      top: 0,
      right: viewport.width,
      bottom: viewport.height,
    };
  }

  return {
    left: win.position.x,
    top: win.position.y,
    right: win.position.x + win.size.width,
    bottom: win.position.y + win.size.height,
  };
}

function isFullyCovered(rect: Rect, coveringRects: Rect[]): boolean {
  let fragments = [rect];

  for (const cover of coveringRects) {
    fragments = fragments.flatMap((fragment) => subtractRect(fragment, cover));
    if (fragments.length === 0) return true;
  }

  return false;
}

function subtractRect(source: Rect, cover: Rect): Rect[] {
  const overlap = intersectRects(source, cover);
  if (!overlap) return [source];

  const fragments: Rect[] = [];

  if (overlap.top > source.top) {
    fragments.push({
      left: source.left,
      top: source.top,
      right: source.right,
      bottom: overlap.top,
    });
  }

  if (overlap.bottom < source.bottom) {
    fragments.push({
      left: source.left,
      top: overlap.bottom,
      right: source.right,
      bottom: source.bottom,
    });
  }

  if (overlap.left > source.left) {
    fragments.push({
      left: source.left,
      top: overlap.top,
      right: overlap.left,
      bottom: overlap.bottom,
    });
  }

  if (overlap.right < source.right) {
    fragments.push({
      left: overlap.right,
      top: overlap.top,
      right: source.right,
      bottom: overlap.bottom,
    });
  }

  return fragments.filter((fragment) => (
    fragment.right - fragment.left > 0 && fragment.bottom - fragment.top > 0
  ));
}

function intersectRects(a: Rect, b: Rect): Rect | null {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.right, b.right);
  const bottom = Math.min(a.bottom, b.bottom);

  if (right <= left || bottom <= top) return null;
  return { left, top, right, bottom };
}
