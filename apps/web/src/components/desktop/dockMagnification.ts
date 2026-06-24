export const DOCK_BASE_ICON_SIZE = 56;
export const DOCK_ITEM_GAP = 8;
export const DOCK_ITEM_CENTER_SPACING = DOCK_BASE_ICON_SIZE + DOCK_ITEM_GAP;
export const DOCK_MAX_SCALE = 1.28;
export const DOCK_INFLUENCE_RADIUS = DOCK_ITEM_CENTER_SPACING * 1.7;
export const DOCK_MAX_LIFT = 15;

export type DockMagnificationState = {
  scale: number;
  translateX: number;
  translateY: number;
  width: number;
};

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function getDockMagnification({
  itemCenterX,
  pointerX,
}: {
  itemCenterX: number;
  pointerX: number | null;
}): DockMagnificationState {
  if (pointerX === null) {
    return { scale: 1, translateX: 0, translateY: 0, width: DOCK_BASE_ICON_SIZE };
  }

  const distance = Math.abs(pointerX - itemCenterX);
  const normalizedDistance = clamp(distance / DOCK_INFLUENCE_RADIUS, 0, 1);
  const influence =
    normalizedDistance >= 1
      ? 0
      : (Math.cos(normalizedDistance * Math.PI) + 1) / 2;
  if (influence === 0) {
    return { scale: 1, translateX: 0, translateY: 0, width: DOCK_BASE_ICON_SIZE };
  }

  const scale = 1 + (DOCK_MAX_SCALE - 1) * influence;

  return {
    scale: round(scale),
    translateX: 0,
    translateY: round(-DOCK_MAX_LIFT * influence),
    width: DOCK_BASE_ICON_SIZE,
  };
}

export function getDockItemCenterX({
  dockLeft,
  index,
}: {
  dockLeft: number;
  index: number;
}): number {
  return dockLeft + index * DOCK_ITEM_CENTER_SPACING + DOCK_BASE_ICON_SIZE / 2;
}

export function getRenderableDockAppIds(
  dockAppIds: string[],
  availableAppIds: ReadonlySet<string>,
): string[] {
  return dockAppIds.filter((appId) => availableAppIds.has(appId));
}
