import { describe, expect, it, vi } from "vitest";

import {
  AVATAR_DEFAULT_SIZE,
  AVATAR_MAX_SIZE,
  clampAvatarPlacement,
  clampAvatarDockPlacement,
  getDefaultAvatarPlacement,
} from "./avatar-layout";
import { useAvatarStore } from "@/stores/avatarStore";

describe("avatar layout", () => {
  it("places the default avatar near the desktop bottom-left above the Dock", () => {
    expect(getDefaultAvatarPlacement({ width: 1440, height: 900 })).toEqual({
      x: 24,
      y: 288,
    });
  });

  it("uses a larger default avatar with room to scale up further", () => {
    expect(AVATAR_DEFAULT_SIZE).toEqual({ width: 360, height: 520 });
    expect(AVATAR_MAX_SIZE).toEqual({ width: 560, height: 800 });
  });

  it("uses the small-screen edge gap and keeps the avatar on screen", () => {
    const placement = getDefaultAvatarPlacement({ width: 360, height: 640 });

    expect(placement.x).toBe(8);
    expect(placement.y).toBeGreaterThanOrEqual(8);
  });

  it("clamps placement inside the viewport", () => {
    expect(
      clampAvatarPlacement(
        { x: -100, y: 9999 },
        AVATAR_DEFAULT_SIZE,
        { width: 800, height: 600 },
      ),
    ).toEqual({ x: 8, y: 72 });
  });

  it("clamps placement above the Dock when using the dock-aware helper", () => {
    expect(
      clampAvatarDockPlacement(
        { x: -100, y: 9999 },
        AVATAR_DEFAULT_SIZE,
        { width: 800, height: 600 },
      ),
    ).toEqual({ x: 8, y: 8 });
  });

  it("pins oversized avatars to the clamp gap in tiny viewports", () => {
    expect(
      clampAvatarPlacement(
        { x: 999, y: 999 },
        AVATAR_DEFAULT_SIZE,
        { width: 100, height: 100 },
      ),
    ).toEqual({ x: 8, y: 8 });
  });

  it("returns safe non-negative placement for dock-aware clamping in tiny viewports", () => {
    expect(
      clampAvatarDockPlacement(
        { x: 999, y: 999 },
        AVATAR_DEFAULT_SIZE,
        { width: 100, height: 100 },
      ),
    ).toEqual({ x: 8, y: 8 });
  });

  it("uses custom size when computing the default placement", () => {
    expect(
      getDefaultAvatarPlacement(
        { width: 1440, height: 900 },
        { width: 150, height: 210 },
      ),
    ).toEqual({ x: 24, y: 598 });
  });

  it("uses deterministic store placement until the desktop viewport is available", async () => {
    const originalInnerWidth = window.innerWidth;
    const originalInnerHeight = window.innerHeight;

    try {
      window.localStorage.removeItem("ainative-avatar");
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: 360,
      });
      Object.defineProperty(window, "innerHeight", {
        configurable: true,
        value: 640,
      });

      vi.resetModules();
      const { useAvatarStore: isolatedAvatarStore } = await import(
        "@/stores/avatarStore"
      );

      expect(isolatedAvatarStore.getInitialState().position).toEqual({
        x: 24,
        y: 288,
      });
    } finally {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: originalInnerWidth,
      });
      Object.defineProperty(window, "innerHeight", {
        configurable: true,
        value: originalInnerHeight,
      });
      vi.resetModules();
    }
  });

  it("normalizes persisted placement when the viewport shrinks", () => {
    useAvatarStore.setState({
      visible: true,
      bubbleOpen: false,
      position: { x: 1200, y: 700 },
      size: AVATAR_DEFAULT_SIZE,
      modelSourceType: "url",
      modelUrl: "",
      localModelName: "",
      currentEmotion: "neutral",
      personalityPreset: "default",
    });

    useAvatarStore.getState().normalizePlacement({ width: 800, height: 600 });

    expect(useAvatarStore.getState().position).toEqual({ x: 432, y: 8 });
  });

  it("clamps setSize using the resized avatar dimensions when a viewport is provided", () => {
    useAvatarStore.setState({
      visible: true,
      bubbleOpen: false,
      position: { x: 700, y: 500 },
      size: AVATAR_DEFAULT_SIZE,
      modelSourceType: "url",
      modelUrl: "",
      localModelName: "",
      currentEmotion: "neutral",
      personalityPreset: "default",
    });

    useAvatarStore
      .getState()
      .setSize({ width: 360, height: 520 }, { width: 800, height: 600 });

    expect(useAvatarStore.getState().size).toEqual({ width: 360, height: 520 });
    expect(useAvatarStore.getState().position).toEqual({ x: 432, y: 8 });
  });

  it("switches to local file model source when a legacy public model URL is configured", () => {
    useAvatarStore.setState({
      visible: true,
      bubbleOpen: false,
      position: { x: 24, y: 188 },
      size: AVATAR_DEFAULT_SIZE,
      modelSourceType: "zip",
      modelUrl: "",
      localModelName: "hiyori_free_en.zip",
      live2dError: "previous error",
      currentEmotion: "neutral",
      personalityPreset: "default",
    });

    useAvatarStore
      .getState()
      .setModelUrl("/avatar/live2d/hiyori_free_en/hiyori.model3.json");

    expect(useAvatarStore.getState()).toMatchObject({
      modelSourceType: "url",
      modelUrl: "/avatar/assets/live2d/hiyori_free_en/hiyori.model3.json",
      localModelName: "hiyori_free_en.zip",
      live2dError: "",
    });
  });

  it("switches to local ZIP source when a cached model name is configured", () => {
    useAvatarStore.setState({
      visible: true,
      bubbleOpen: false,
      position: { x: 24, y: 188 },
      size: AVATAR_DEFAULT_SIZE,
      modelSourceType: "url",
      modelUrl: "/avatar/assets/live2d/hiyori_free_en/hiyori.model3.json",
      localModelName: "",
      currentEmotion: "neutral",
      personalityPreset: "default",
    });

    useAvatarStore.getState().setLocalModelName("hiyori_free_en.zip");

    expect(useAvatarStore.getState()).toMatchObject({
      modelSourceType: "zip",
      modelUrl: "/avatar/assets/live2d/hiyori_free_en/hiyori.model3.json",
      localModelName: "hiyori_free_en.zip",
    });
  });

  it("does not persist transient avatar emotion across reloads", () => {
    window.localStorage.removeItem("ainative-avatar");

    useAvatarStore.setState({
      visible: true,
      bubbleOpen: false,
      position: { x: 24, y: 188 },
      size: AVATAR_DEFAULT_SIZE,
      modelSourceType: "url",
      modelUrl: "/avatar/assets/live2d/mao_pro_zh/runtime/mao_pro.model3.json",
      localModelName: "",
      currentEmotion: "neutral",
      personalityPreset: "default",
    });

    useAvatarStore.getState().setCurrentEmotion("relaxed");

    const persisted = JSON.parse(
      window.localStorage.getItem("ainative-avatar") ?? "{}",
    ) as { state?: Record<string, unknown> };

    expect(persisted.state?.currentEmotion).toBeUndefined();
  });

  it("emits repeatable avatar motion requests without persisting them", () => {
    window.localStorage.removeItem("ainative-avatar");

    useAvatarStore.setState({
      visible: true,
      bubbleOpen: false,
      position: { x: 24, y: 188 },
      size: AVATAR_DEFAULT_SIZE,
      modelSourceType: "url",
      modelUrl: "/avatar/assets/live2d/mao_pro_zh/runtime/mao_pro.model3.json",
      localModelName: "",
      currentEmotion: "neutral",
      motionRequest: null,
      personalityPreset: "default",
    });

    useAvatarStore.getState().requestMotion("heart");
    const firstRequest = useAvatarStore.getState().motionRequest;
    useAvatarStore.getState().requestMotion("heart");
    const secondRequest = useAvatarStore.getState().motionRequest;

    expect(firstRequest).toMatchObject({ motion: "heart", sequence: 1 });
    expect(secondRequest).toMatchObject({ motion: "heart", sequence: 2 });

    const persisted = JSON.parse(
      window.localStorage.getItem("ainative-avatar") ?? "{}",
    ) as { state?: Record<string, unknown> };

    expect(persisted.state?.motionRequest).toBeUndefined();
  });

  it("resets placement to the default size and bottom-left dock position", () => {
    useAvatarStore.setState({
      visible: true,
      bubbleOpen: true,
      position: { x: 700, y: 500 },
      size: { width: 360, height: 520 },
      modelSourceType: "url",
      modelUrl: "",
      localModelName: "",
      currentEmotion: "happy",
      personalityPreset: "default",
    });

    useAvatarStore.getState().resetPlacement({ width: 800, height: 600 });

    expect(useAvatarStore.getState().size).toEqual(AVATAR_DEFAULT_SIZE);
    expect(useAvatarStore.getState().position).toEqual({ x: 24, y: 8 });
    expect(useAvatarStore.getState().bubbleOpen).toBe(true);
  });
});
