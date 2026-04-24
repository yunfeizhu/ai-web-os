import { describe, expect, it } from "vitest";

import {
  AVATAR_DEFAULT_SIZE,
  clampAvatarPlacement,
  getDefaultAvatarPlacement,
} from "./avatar-layout";

describe("avatar layout", () => {
  it("places the default avatar near the desktop bottom-left above the Dock", () => {
    expect(getDefaultAvatarPlacement({ width: 1440, height: 900 })).toEqual({
      x: 24,
      y: 488,
    });
  });

  it("uses the small-screen edge gap and keeps the avatar on screen", () => {
    const placement = getDefaultAvatarPlacement({ width: 360, height: 640 });

    expect(placement.x).toBe(16);
    expect(placement.y).toBeGreaterThanOrEqual(16);
  });

  it("clamps placement inside the viewport", () => {
    expect(
      clampAvatarPlacement(
        { x: -100, y: 9999 },
        AVATAR_DEFAULT_SIZE,
        { width: 800, height: 600 },
      ),
    ).toEqual({ x: 8, y: 272 });
  });
});
