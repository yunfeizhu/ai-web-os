export type AvatarSize = {
  width: number;
  height: number;
};

export type AvatarPosition = {
  x: number;
  y: number;
};

export type ViewportSize = {
  width: number;
  height: number;
};

export const AVATAR_DEFAULT_SIZE: AvatarSize = { width: 360, height: 520 };
export const AVATAR_MIN_SIZE: AvatarSize = { width: 150, height: 210 };
export const AVATAR_MAX_SIZE: AvatarSize = { width: 560, height: 800 };
export const AVATAR_EDGE_GAP = 24;
export const AVATAR_SMALL_EDGE_GAP = 16;
export const AVATAR_DOCK_CLEARANCE = 68;
export const AVATAR_CLAMP_GAP = 8;

export const AVATAR_FALLBACK_VIEWPORT: ViewportSize = {
  width: 1440,
  height: 900,
};
const SMALL_VIEWPORT_WIDTH = 480;

function getViewportSize(viewport?: ViewportSize): ViewportSize {
  if (viewport) {
    return viewport;
  }

  if (typeof window !== "undefined") {
    return {
      width: window.innerWidth,
      height: window.innerHeight,
    };
  }

  return AVATAR_FALLBACK_VIEWPORT;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function clampAvatarPlacementWithBottomClearance(
  position: AvatarPosition,
  size: AvatarSize,
  viewport?: ViewportSize,
  bottomClearance = 0,
): AvatarPosition {
  const resolvedViewport = getViewportSize(viewport);
  const maxX = Math.max(
    AVATAR_CLAMP_GAP,
    resolvedViewport.width - size.width - AVATAR_CLAMP_GAP,
  );
  const maxY = Math.max(
    AVATAR_CLAMP_GAP,
    resolvedViewport.height -
      size.height -
      bottomClearance -
      AVATAR_CLAMP_GAP,
  );

  return {
    x: clamp(Math.round(position.x), AVATAR_CLAMP_GAP, maxX),
    y: clamp(Math.round(position.y), AVATAR_CLAMP_GAP, maxY),
  };
}

export function clampAvatarPlacement(
  position: AvatarPosition,
  size: AvatarSize,
  viewport?: ViewportSize,
): AvatarPosition {
  return clampAvatarPlacementWithBottomClearance(position, size, viewport);
}

export function clampAvatarDockPlacement(
  position: AvatarPosition,
  size: AvatarSize,
  viewport?: ViewportSize,
): AvatarPosition {
  return clampAvatarPlacementWithBottomClearance(
    position,
    size,
    viewport,
    AVATAR_DOCK_CLEARANCE,
  );
}

export function getDefaultAvatarPlacement(
  viewport?: ViewportSize,
  size: AvatarSize = AVATAR_DEFAULT_SIZE,
): AvatarPosition {
  const resolvedViewport = getViewportSize(viewport);
  const edgeGap =
    resolvedViewport.width < SMALL_VIEWPORT_WIDTH
      ? AVATAR_SMALL_EDGE_GAP
      : AVATAR_EDGE_GAP;

  return clampAvatarDockPlacement(
    {
      x: edgeGap,
      y: resolvedViewport.height - size.height - edgeGap - AVATAR_DOCK_CLEARANCE,
    },
    size,
    resolvedViewport,
  );
}
