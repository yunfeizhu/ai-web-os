import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useAvatarStore } from "@/stores/avatarStore";
import {
  fitModelToHost,
  getLive2DInteractionMotionGroups,
  getLive2DModelCapabilities,
  getLive2DRenderResolution,
  playLive2DInteraction,
} from "./Live2DCanvas";
import { Live2DCanvas } from "./Live2DCanvas";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

describe("getLive2DRenderResolution", () => {
  it("renders Live2D at no less than 2x device resolution", () => {
    expect(getLive2DRenderResolution(1)).toBe(2);
    expect(getLive2DRenderResolution(1.25)).toBe(2);
  });

  it("uses high-density screens up to a bounded resolution", () => {
    expect(getLive2DRenderResolution(2.5)).toBe(2.5);
    expect(getLive2DRenderResolution(4)).toBe(3);
  });

  it("falls back to the minimum high-resolution ratio for invalid inputs", () => {
    expect(getLive2DRenderResolution(0)).toBe(2);
    expect(getLive2DRenderResolution(Number.NaN)).toBe(2);
  });
});

describe("fitModelToHost", () => {
  it("keeps the same scale when fitting the same model repeatedly", () => {
    const host = document.createElement("div");
    Object.defineProperty(host, "clientWidth", {
      configurable: true,
      value: 300,
    });
    Object.defineProperty(host, "clientHeight", {
      configurable: true,
      value: 420,
    });

    let currentScale = 1;
    const model = {
      get width() {
        return 1200 * currentScale;
      },
      get height() {
        return 1800 * currentScale;
      },
      anchor: {
        set: () => undefined,
      },
      scale: {
        set: (value: number) => {
          currentScale = value;
        },
      },
      position: {
        set: () => undefined,
      },
    } as unknown as Parameters<typeof fitModelToHost>[0];

    fitModelToHost(model, host);
    const firstScale = currentScale;

    fitModelToHost(model, host);

    expect(currentScale).toBe(firstScale);
  });
});

describe("Live2D click interactions", () => {
  it("extracts available motion groups and expression names from a loaded model", () => {
    const model = {
      internalModel: {
        motionManager: {
          definitions: {
            Idle: [{ File: "idle.motion3.json" }],
            "": [{ File: "special_01.motion3.json" }],
            "Tap@Body": [{ File: "tap_body.motion3.json" }],
          },
          expressionManager: {
            definitions: [
              { Name: "exp_01", File: "exp_01.exp3.json" },
              { Name: "exp_02", File: "exp_02.exp3.json" },
            ],
          },
        },
      },
    };

    expect(
      getLive2DModelCapabilities(
        model as unknown as Parameters<typeof getLive2DModelCapabilities>[0],
      ),
    ).toEqual({
      motionGroups: ["Idle", "", "Tap@Body"],
      expressionNames: ["exp_01", "exp_02"],
    });
  });

  it("prefers body tap motions when the body hit area is clicked", () => {
    expect(getLive2DInteractionMotionGroups(["Body"])).toEqual([
      "Tap@Body",
      "TapBody",
      "Tap",
      "Flick@Body",
      "Happy",
      "",
      "Idle",
    ]);
  });

  it("prefers head tap motions when the head hit area is clicked", () => {
    expect(getLive2DInteractionMotionGroups(["Head"])).toEqual([
      "TapHead",
      "Tap@Head",
      "FlickHead",
      "Tap",
      "Happy",
      "",
      "Idle",
    ]);
  });

  it("keeps only motion groups that exist when model capabilities are available", () => {
    expect(
      getLive2DInteractionMotionGroups(["Body"], {
        motionGroups: ["Idle", "", "Tap@Body"],
        expressionNames: [],
      }),
    ).toEqual(["Tap@Body", "", "Idle"]);
  });

  it("tries candidate motions until one starts", async () => {
    const calls: string[] = [];
    const model = {
      motion: async (group: string) => {
        calls.push(group);
        return group === "Happy";
      },
      expression: async () => false,
    };

    await expect(
      playLive2DInteraction(
        model as unknown as Parameters<typeof playLive2DInteraction>[0],
        ["Body"],
      ),
    ).resolves.toBe(true);

    expect(calls).toEqual(["Tap@Body", "TapBody", "Tap", "Flick@Body", "Happy"]);
  });

  it("tries an empty motion group when the model exposes unnamed motions", async () => {
    const calls: string[] = [];
    const model = {
      motion: async (group: string) => {
        calls.push(group);
        return group === "";
      },
      expression: async () => false,
    };

    await expect(
      playLive2DInteraction(
        model as unknown as Parameters<typeof playLive2DInteraction>[0],
        [""],
        { motionGroups: ["Idle", ""], expressionNames: [] },
      ),
    ).resolves.toBe(true);

    expect(calls).toEqual([""]);
  });

  it("falls back to a happy expression when no interaction motion is available", async () => {
    const expressions: Array<string | number | undefined> = [];
    const model = {
      motion: async () => false,
      expression: async (name?: string | number) => {
        expressions.push(name);
        return name === "happy";
      },
    };

    await expect(
      playLive2DInteraction(
        model as unknown as Parameters<typeof playLive2DInteraction>[0],
        [],
      ),
    ).resolves.toBe(true);

    expect(expressions).toEqual(["happy"]);
  });

  it("uses exported expression names when generic expression names are unavailable", async () => {
    const expressions: Array<string | number | undefined> = [];
    const model = {
      motion: async () => false,
      expression: async (name?: string | number) => {
        expressions.push(name);
        return name === "exp_01";
      },
    };

    await expect(
      playLive2DInteraction(
        model as unknown as Parameters<typeof playLive2DInteraction>[0],
        [],
        { motionGroups: [], expressionNames: ["exp_01", "exp_02"] },
      ),
    ).resolves.toBe(true);

    expect(expressions).toEqual(["happy", "smile", "surprised", "exp_01"]);
  });
});

describe("Live2DCanvas desktop status", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    window.localStorage.clear();
    useAvatarStore.setState({
      modelSourceType: "url",
      modelUrl: "",
      localModelName: "",
      currentEmotion: "neutral",
      live2dError: "",
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("does not render a desktop fallback when no Live2D model is configured", () => {
    act(() => {
      root.render(createElement(Live2DCanvas, { modelUrl: "", emotion: "neutral" }));
    });

    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(useAvatarStore.getState().live2dError).toBe("");
  });

  it("reports invalid Live2D source errors to the avatar store without rendering a desktop fallback", () => {
    act(() => {
      root.render(
        createElement(Live2DCanvas, {
          modelUrl: "/avatar/live2d/model.png",
          emotion: "neutral",
        }),
      );
    });

    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(useAvatarStore.getState().live2dError).toContain(".model3.json");
  });
});
