import type { WindowPosition, WindowSize } from "@/types/window";

export type ViewportSize = {
  width: number;
  height: number;
};

export type WorkArea = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ResponsiveInitialWindowLayout = {
  position: WindowPosition;
  size: WindowSize;
  minSize: WindowSize;
};

export type ResponsiveSnapZone = "left" | "right" | "maximize" | null;

export const DESKTOP_DOCK_CLEARANCE = 96;
export const WINDOW_EDGE_GAP = 16;
export const FALLBACK_VIEWPORT: ViewportSize = { width: 1920, height: 1080 };

function getViewportSize(viewport?: ViewportSize): ViewportSize {
  if (viewport) return viewport;

  if (typeof window !== "undefined") {
    return {
      width: window.innerWidth,
      height: window.innerHeight,
    };
  }

  return FALLBACK_VIEWPORT;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function normalizeDimension(value: number): number {
  return Math.max(1, Math.round(value));
}

function getInitialEdgeGap(workArea: WorkArea): number {
  return workArea.width > WINDOW_EDGE_GAP * 2 &&
    workArea.height > WINDOW_EDGE_GAP * 2
    ? WINDOW_EDGE_GAP
    : 0;
}

export function getDesktopWorkArea(
  viewport?: ViewportSize,
  options?: { reserveDock?: boolean },
): WorkArea {
  const resolvedViewport = getViewportSize(viewport);
  const reserveDock = options?.reserveDock ?? true;
  const dockClearance = reserveDock ? DESKTOP_DOCK_CLEARANCE : 0;

  return {
    x: 0,
    y: 0,
    width: normalizeDimension(resolvedViewport.width),
    height: Math.max(
      1,
      normalizeDimension(resolvedViewport.height) - dockClearance,
    ),
  };
}

function fitWindowSizeInside(
  preferredSize: WindowSize,
  minSize: WindowSize,
  maxSize: WindowSize,
): { size: WindowSize; minSize: WindowSize } {
  const normalizedMax = {
    width: normalizeDimension(maxSize.width),
    height: normalizeDimension(maxSize.height),
  };
  const effectiveMinSize = {
    width: Math.min(normalizeDimension(minSize.width), normalizedMax.width),
    height: Math.min(normalizeDimension(minSize.height), normalizedMax.height),
  };

  return {
    size: {
      width: clamp(
        normalizeDimension(preferredSize.width),
        effectiveMinSize.width,
        normalizedMax.width,
      ),
      height: clamp(
        normalizeDimension(preferredSize.height),
        effectiveMinSize.height,
        normalizedMax.height,
      ),
    },
    minSize: effectiveMinSize,
  };
}

export function getResponsiveInitialWindowLayout({
  preferredSize,
  minSize,
  viewport,
  offset = 0,
}: {
  preferredSize: WindowSize;
  minSize: WindowSize;
  viewport?: ViewportSize;
  offset?: number;
}): ResponsiveInitialWindowLayout {
  const workArea = getDesktopWorkArea(viewport);
  const edgeGap = getInitialEdgeGap(workArea);
  const maxSize = {
    width: Math.max(1, workArea.width - edgeGap * 2),
    height: Math.max(1, workArea.height - edgeGap * 2),
  };
  const fitted = fitWindowSizeInside(preferredSize, minSize, maxSize);
  const maxX = Math.max(edgeGap, workArea.width - fitted.size.width - edgeGap);
  const maxY = Math.max(edgeGap, workArea.height - fitted.size.height - edgeGap);

  return {
    size: fitted.size,
    minSize: fitted.minSize,
    position: {
      x: clamp(
        Math.round((workArea.width - fitted.size.width) / 2) + offset,
        edgeGap,
        maxX,
      ),
      y: clamp(
        Math.round((workArea.height - fitted.size.height) / 2) + offset,
        edgeGap,
        maxY,
      ),
    },
  };
}

export function clampWindowRectToWorkArea({
  position,
  size,
  minSize,
  viewport,
}: {
  position: WindowPosition;
  size: WindowSize;
  minSize: WindowSize;
  viewport?: ViewportSize;
}): { position: WindowPosition; size: WindowSize } {
  const workArea = getDesktopWorkArea(viewport);
  const fitted = fitWindowSizeInside(size, minSize, {
    width: workArea.width,
    height: workArea.height,
  });

  return {
    size: fitted.size,
    position: {
      x: clamp(
        Math.round(position.x),
        workArea.x,
        Math.max(workArea.x, workArea.width - fitted.size.width),
      ),
      y: clamp(
        Math.round(position.y),
        workArea.y,
        Math.max(workArea.y, workArea.height - fitted.size.height),
      ),
    },
  };
}

export function getResponsiveSnapTarget(
  zone: ResponsiveSnapZone,
  viewport?: ViewportSize,
): { position: WindowPosition; size: WindowSize } {
  const workArea = getDesktopWorkArea(viewport);
  const halfWidth = Math.round(workArea.width / 2);

  switch (zone) {
    case "left":
      return {
        position: { x: workArea.x, y: workArea.y },
        size: { width: halfWidth, height: workArea.height },
      };
    case "right":
      return {
        position: { x: workArea.x + halfWidth, y: workArea.y },
        size: { width: workArea.width - halfWidth, height: workArea.height },
      };
    case "maximize":
      return {
        position: { x: workArea.x, y: workArea.y },
        size: { width: workArea.width, height: workArea.height },
      };
    default:
      return {
        position: { x: workArea.x, y: workArea.y },
        size: { width: Math.min(800, workArea.width), height: Math.min(600, workArea.height) },
      };
  }
}
