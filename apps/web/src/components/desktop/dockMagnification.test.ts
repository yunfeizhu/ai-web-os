import { describe, expect, it } from "vitest";

import {
  DOCK_BASE_ICON_SIZE,
  DOCK_INFLUENCE_RADIUS,
  DOCK_ITEM_CENTER_SPACING,
  DOCK_ITEM_GAP,
  getRenderableDockAppIds,
  getDockItemCenterX,
  getDockMagnification,
} from "./dockMagnification";

describe("dock magnification", () => {
  it("uses an 8px resting gap and derives centers from that spacing", () => {
    expect(DOCK_ITEM_GAP).toBe(8);
    expect(DOCK_ITEM_CENTER_SPACING).toBe(64);
    expect(DOCK_INFLUENCE_RADIUS).toBeCloseTo(DOCK_ITEM_CENTER_SPACING * 1.7, 3);
  });

  it("keeps icons at the resting size when the pointer is outside the Dock", () => {
    expect(getDockMagnification({ itemCenterX: 120, pointerX: null })).toEqual({
      scale: 1,
      translateX: 0,
      translateY: 0,
      width: DOCK_BASE_ICON_SIZE,
    });
  });

  it("magnifies the icon under the pointer and lifts it upward", () => {
    const state = getDockMagnification({ itemCenterX: 240, pointerX: 240 });

    expect(state.scale).toBeCloseTo(1.28, 2);
    expect(state.translateX).toBe(0);
    expect(state.translateY).toBeLessThan(-12);
    expect(state.width).toBe(DOCK_BASE_ICON_SIZE);
  });

  it("creates a wave without changing item slots or pushing icons sideways", () => {
    const left = getDockMagnification({ itemCenterX: 180, pointerX: 240 });
    const near = getDockMagnification({ itemCenterX: 300, pointerX: 240 });
    const far = getDockMagnification({ itemCenterX: 430, pointerX: 240 });

    expect(left.translateX).toBe(0);
    expect(left.width).toBe(DOCK_BASE_ICON_SIZE);
    expect(near.scale).toBeGreaterThan(1);
    expect(near.scale).toBeLessThan(1.28);
    expect(near.translateX).toBe(0);
    expect(near.translateY).toBeLessThan(0);
    expect(near.width).toBe(DOCK_BASE_ICON_SIZE);
    expect(far.scale).toBe(1);
    expect(far.translateX).toBe(0);
    expect(far.translateY).toBe(0);
    expect(far.width).toBe(DOCK_BASE_ICON_SIZE);
  });

  it("uses resting icon centers so magnification does not feed back into hit testing", () => {
    expect(getDockItemCenterX({ dockLeft: 100, index: 0 })).toBe(
      100 + DOCK_BASE_ICON_SIZE / 2,
    );
    expect(getDockItemCenterX({ dockLeft: 100, index: 3 })).toBe(
      100 + DOCK_ITEM_CENTER_SPACING * 3 + DOCK_BASE_ICON_SIZE / 2,
    );
  });

  it("computes rendered order after unavailable Dock apps are skipped", () => {
    expect(
      getRenderableDockAppIds(
        ["notes", "document-editor", "text-editor", "calendar", "mail"],
        new Set(["notes", "document-editor", "calendar", "mail"]),
      ),
    ).toEqual(["notes", "document-editor", "calendar", "mail"]);

    const renderedMailIndex = getRenderableDockAppIds(
      ["notes", "document-editor", "text-editor", "calendar", "mail"],
      new Set(["notes", "document-editor", "calendar", "mail"]),
    ).indexOf("mail");

    expect(getDockItemCenterX({ dockLeft: 100, index: renderedMailIndex })).toBe(
      100 + DOCK_ITEM_CENTER_SPACING * 3 + DOCK_BASE_ICON_SIZE / 2,
    );
  });
});
