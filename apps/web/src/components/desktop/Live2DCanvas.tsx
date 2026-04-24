"use client";

import { useEffect, useRef } from "react";

import { getLive2DExpressionPlan } from "@/apps/avatar-pet/emotion-map";
import type { AvatarEmotion } from "@/apps/avatar-pet/emotion-parser";
import {
  classifyLive2DSource,
  loadAvatarZip,
  prepareZipModelBlob,
  type PreparedZipModel,
} from "@/apps/avatar-pet/live2d-loader";
import { useAvatarStore } from "@/stores/avatarStore";

type PixiModule = typeof import("pixi.js");
type Live2DModule = typeof import("pixi-live2d-display/cubism4");
type Live2DModelInstance = Awaited<
  ReturnType<Live2DModule["Live2DModel"]["from"]>
>;
type PixiApplication = InstanceType<PixiModule["Application"]>;

declare global {
  interface Window {
    Live2DCubismCore?: unknown;
    PIXI?: PixiModule;
  }
}

type RuntimeState = {
  message: string;
  tone: "info" | "error";
};

type Live2DCanvasProps = {
  modelUrl: string;
  emotion: AvatarEmotion;
};

type Live2DInteractionModel = Pick<
  Live2DModelInstance,
  "expression" | "motion"
>;

type Live2DPointerTapEvent = {
  data?: {
    global?: {
      x: number;
      y: number;
    };
  };
};

export type Live2DModelCapabilities = {
  motionGroups: string[];
  expressionNames: string[];
};

const CUBISM_CORE_SRC = "/vendor/live2d/live2dcubismcore.min.js";
const MIN_RENDER_RESOLUTION = 2;
const MAX_RENDER_RESOLUTION = 3;
const LIVE2D_FORCE_MOTION_PRIORITY = 3;
const LIVE2D_INTERACTION_EXPRESSIONS = ["happy", "smile", "surprised"] as const;
const LIVE2D_DEFAULT_TAP_MOTION_GROUPS = [
  "Tap@Body",
  "TapBody",
  "TapHead",
  "Tap@Head",
  "Tap",
  "Flick@Body",
  "Happy",
  "",
  "Idle",
] as const;

export function getLive2DRenderResolution(
  devicePixelRatio =
    typeof window === "undefined" ? MIN_RENDER_RESOLUTION : window.devicePixelRatio,
) {
  if (!Number.isFinite(devicePixelRatio) || devicePixelRatio <= 0) {
    return MIN_RENDER_RESOLUTION;
  }

  return Math.min(
    MAX_RENDER_RESOLUTION,
    Math.max(MIN_RENDER_RESOLUTION, devicePixelRatio),
  );
}

function getSourceFallbackMessage(
  modelUrl: string,
  modelSourceType: "url" | "zip",
  localModelName: string,
): RuntimeState | null {
  if (modelSourceType === "zip") {
    if (!localModelName.trim()) {
      return {
        message: "未选择 Live2D ZIP / No local Live2D ZIP selected",
        tone: "info",
      };
    }

    return null;
  }

  const classified = classifyLive2DSource(modelUrl);

  if (classified.kind === "missing") {
    return {
      message: "未设置 Live2D 模型 / No Live2D model configured",
      tone: "info",
    };
  }

  if (classified.kind === "zip") {
    return {
      message: "ZIP 模型导入将在下一步支持 / ZIP import is not available yet",
      tone: "info",
    };
  }

  if (classified.kind === "unknown") {
    return {
      message: "请使用 .model3.json 模型地址 / Use a .model3.json model URL",
      tone: "error",
    };
  }

  return null;
}

function loadCubismCore(): Promise<void> {
  if (window.Live2DCubismCore) {
    return Promise.resolve();
  }

  let existingScript = document.querySelector<HTMLScriptElement>(
    `script[src="${CUBISM_CORE_SRC}"]`,
  );

  if (existingScript?.dataset.live2dCoreStatus === "failed") {
    existingScript.remove();
    existingScript = null;
  }

  if (existingScript?.dataset.live2dCoreStatus === "loaded") {
    return Promise.reject(new Error("Cubism Core loaded without global runtime"));
  }

  const script = existingScript ?? document.createElement("script");

  if (!existingScript) {
    script.src = CUBISM_CORE_SRC;
    script.async = true;
    script.dataset.live2dCoreStatus = "loading";
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const timeoutId = window.setTimeout(() => {
      settleFailed(new Error("Cubism Core script load timed out"));
    }, 15000);

    const cleanup = () => {
      window.clearTimeout(timeoutId);
      script.removeEventListener("load", settleLoaded);
      script.removeEventListener("error", settleFailed);
    };

    const settle = (handler: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      handler();
    };

    const settleLoaded = () => {
      settle(() => {
        script.dataset.live2dCoreStatus = "loaded";
        if (window.Live2DCubismCore) {
          resolve();
          return;
        }
        reject(new Error("Cubism Core loaded without window.Live2DCubismCore"));
      });
    };

    const settleFailed = (
      error: Error | Event = new Error("Cubism Core script failed to load"),
    ) => {
      settle(() => {
        script.dataset.live2dCoreStatus = "failed";
        reject(
          error instanceof Error
            ? error
            : new Error("Cubism Core script failed to load"),
        );
      });
    };

    script.addEventListener("load", settleLoaded, { once: true });
    script.addEventListener("error", settleFailed, { once: true });

    if (!existingScript) {
      document.head.appendChild(script);
    }
  });
}

export function fitModelToHost(
  model: Live2DModelInstance,
  host: HTMLDivElement,
) {
  const width = host.clientWidth || host.offsetWidth || 240;
  const height = host.clientHeight || host.offsetHeight || 240;

  model.scale.set(1);

  const modelWidth =
    Number.isFinite(model.width) && model.width > 0 ? model.width : width;
  const modelHeight =
    Number.isFinite(model.height) && model.height > 0 ? model.height : height;
  const scale = Math.max(
    0.01,
    Math.min((width * 0.86) / modelWidth, (height * 0.92) / modelHeight),
  );

  model.anchor.set(0.5, 0.5);
  model.scale.set(scale);
  model.position.set(width / 2, height * 0.56);
}

function syncLive2DViewport(
  app: PixiApplication,
  model: Live2DModelInstance,
  host: HTMLDivElement,
) {
  const width = host.clientWidth || host.offsetWidth || 240;
  const height = host.clientHeight || host.offsetHeight || 240;

  app.renderer.resize(width, height);
  fitModelToHost(model, host);
}

function destroyModel(model: Live2DModelInstance | null) {
  if (!model) return;

  try {
    model.destroy({ children: true, texture: true, baseTexture: true });
  } catch {
    // The Pixi application can own resources during cleanup.
  }
}

function destroyApp(app: PixiApplication | null) {
  if (!app) return;

  try {
    app.destroy(true, { children: true, texture: true, baseTexture: true });
  } catch {
    // Runtime teardown must never break React unmount.
  }
}

function revokeObjectUrls(preparedZip: PreparedZipModel | null) {
  if (!preparedZip) return;

  for (const objectUrl of preparedZip.objectUrls) {
    URL.revokeObjectURL(objectUrl);
  }
}

async function applyEmotion(model: Live2DModelInstance, emotion: AvatarEmotion) {
  const plan = getLive2DExpressionPlan(emotion);

  for (const expressionName of plan.expressionNames) {
    try {
      const applied = await model.expression(expressionName);
      if (applied) return;
    } catch {
      // Some models do not define every mapped expression.
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getExpressionName(definition: unknown): string | null {
  if (!isRecord(definition)) return null;
  const name = definition.Name ?? definition.name;
  return typeof name === "string" && name.trim() ? name : null;
}

export function getLive2DModelCapabilities(
  model: Live2DModelInstance,
): Live2DModelCapabilities {
  const motionDefinitions =
    model.internalModel?.motionManager?.definitions ?? {};
  const expressionDefinitions =
    model.internalModel?.motionManager?.expressionManager?.definitions ?? [];

  return {
    motionGroups: Object.keys(motionDefinitions),
    expressionNames: Array.isArray(expressionDefinitions)
      ? expressionDefinitions.flatMap((definition) => {
          const name = getExpressionName(definition);
          return name ? [name] : [];
        })
      : [],
  };
}

export function getLive2DInteractionMotionGroups(
  hitAreas: readonly string[],
  capabilities?: Live2DModelCapabilities,
): string[] {
  const normalizedHitAreas = hitAreas.map((area) => area.toLowerCase());
  let candidates: string[];

  if (normalizedHitAreas.some((area) => area.includes("head"))) {
    candidates = ["TapHead", "Tap@Head", "FlickHead", "Tap", "Happy", "", "Idle"];
  } else if (
    normalizedHitAreas.some(
      (area) =>
        area.includes("body") ||
        area.includes("torso") ||
        area.includes("bust"),
    )
  ) {
    candidates = ["Tap@Body", "TapBody", "Tap", "Flick@Body", "Happy", "", "Idle"];
  } else {
    candidates = [...LIVE2D_DEFAULT_TAP_MOTION_GROUPS];
  }

  if (!capabilities) return candidates;

  const availableGroups = new Set(capabilities.motionGroups);
  return candidates.filter((group) => availableGroups.has(group));
}

export async function playLive2DInteraction(
  model: Live2DInteractionModel,
  hitAreas: readonly string[],
  capabilities?: Live2DModelCapabilities,
): Promise<boolean> {
  for (const group of getLive2DInteractionMotionGroups(hitAreas, capabilities)) {
    try {
      if (await model.motion(group, undefined, LIVE2D_FORCE_MOTION_PRIORITY)) {
        return true;
      }
    } catch {
      // Different Live2D models expose different motion groups.
    }
  }

  const expressionNames = [
    ...LIVE2D_INTERACTION_EXPRESSIONS,
    ...(capabilities?.expressionNames ?? []),
  ];

  for (const expressionName of expressionNames) {
    try {
      if (await model.expression(expressionName)) {
        return true;
      }
    } catch {
      // Expression names vary by model; keep trying friendly fallbacks.
    }
  }

  return false;
}

function enableLive2DPointerInteraction(model: Live2DModelInstance) {
  const capabilities = getLive2DModelCapabilities(model);
  model.interactive = true;
  model.cursor = "pointer";

  const handlePointerTap = (event: Live2DPointerTapEvent) => {
    const point = event.data?.global;
    const hitAreas = point ? model.hitTest(point.x, point.y) : [];

    if (point) {
      model.focus(point.x, point.y);
      model.tap(point.x, point.y);
    }

    void playLive2DInteraction(model, hitAreas, capabilities);
  };

  model.on("pointertap", handlePointerTap);

  return () => {
    model.off("pointertap", handlePointerTap);
  };
}

export function Live2DCanvas({ modelUrl, emotion }: Live2DCanvasProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const modelRef = useRef<Live2DModelInstance | null>(null);
  const emotionRef = useRef(emotion);
  const modelSourceType = useAvatarStore((state) => state.modelSourceType);
  const localModelName = useAvatarStore((state) => state.localModelName);
  const setLive2DError = useAvatarStore((state) => state.setLive2DError);
  emotionRef.current = emotion;

  useEffect(() => {
    let disposed = false;
    let app: PixiApplication | null = null;
    let model: Live2DModelInstance | null = null;
    let preparedZip: PreparedZipModel | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let cleanupPointerInteraction: (() => void) | null = null;
    const host = hostRef.current;
    const sourceFallback = getSourceFallbackMessage(
      modelUrl,
      modelSourceType,
      localModelName,
    );
    const publishRuntimeState = (state: RuntimeState | null) => {
      setLive2DError(state?.tone === "error" ? state.message : "");
    };

    modelRef.current = null;

    if (sourceFallback) {
      publishRuntimeState(sourceFallback);
      return () => {
        disposed = true;
      };
    }

    if (!host) {
      publishRuntimeState({
        message: "Live2D 容器尚未准备好 / Live2D host is not ready",
        tone: "error",
      });
      return () => {
        disposed = true;
      };
    }

    publishRuntimeState(null);

    const initialize = async () => {
      try {
        let modelSource = modelUrl;

        if (modelSourceType === "zip") {
          const zipFile = await loadAvatarZip();

          if (disposed) return;

          if (!zipFile) {
            publishRuntimeState({
              message:
                "Local Live2D ZIP is no longer available. Please choose the ZIP again.",
              tone: "info",
            });
            return;
          }

          preparedZip = await prepareZipModelBlob(zipFile);
          if (disposed) {
            revokeObjectUrls(preparedZip);
            preparedZip = null;
            return;
          }

          modelSource = preparedZip.objectUrl;
        } else {
          const classified = classifyLive2DSource(modelUrl);
          modelSource = classified.source;
        }

        await loadCubismCore();

        if (disposed) return;

        const PIXI = await import("pixi.js");
        window.PIXI = PIXI;
        const { Live2DModel } = await import("pixi-live2d-display/cubism4");

        if (disposed) return;

        const width = host.clientWidth || host.offsetWidth || 240;
        const height = host.clientHeight || host.offsetHeight || 240;

        app = new PIXI.Application({
          width,
          height,
          backgroundAlpha: 0,
          antialias: true,
          autoDensity: true,
          resolution: getLive2DRenderResolution(),
        });

        app.view.style.display = "block";
        app.view.style.height = "100%";
        app.view.style.width = "100%";
        host.replaceChildren(app.view);

        model = await Live2DModel.from(modelSource);

        if (disposed) {
          destroyModel(model);
          return;
        }

        app.stage.addChild(model);
        cleanupPointerInteraction = enableLive2DPointerInteraction(model);
        syncLive2DViewport(app, model, host);
        if (typeof ResizeObserver !== "undefined") {
          resizeObserver = new ResizeObserver(() => {
            if (disposed || !app || !model) return;
            syncLive2DViewport(app, model, host);
          });
          resizeObserver.observe(host);
        }
        modelRef.current = model;
        publishRuntimeState(null);
        await applyEmotion(model, emotionRef.current);
      } catch {
        resizeObserver?.disconnect();
        cleanupPointerInteraction?.();
        destroyModel(model);
        destroyApp(app);
        revokeObjectUrls(preparedZip);
        preparedZip = null;
        app = null;
        model = null;
        modelRef.current = null;

        if (!disposed) {
          if (modelSourceType === "zip") {
            publishRuntimeState({
              message:
                "Local Live2D ZIP could not be loaded. Please check the ZIP contains a valid model settings file.",
              tone: "error",
            });
            return;
          }

          publishRuntimeState({
            message:
              "Live2D 初始化失败，请检查模型地址和 Cubism Core / Live2D failed to initialize",
            tone: "error",
          });
        }
      }
    };

    void initialize();

    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      cleanupPointerInteraction?.();
      modelRef.current = null;
      destroyModel(model);
      destroyApp(app);
      revokeObjectUrls(preparedZip);
      host.replaceChildren();
    };
  }, [localModelName, modelSourceType, modelUrl, setLive2DError]);

  useEffect(() => {
    const model = modelRef.current;
    if (!model) return;

    let disposed = false;

    const updateExpression = async () => {
      await applyEmotion(model, emotion);
    };

    void updateExpression().catch(() => {
      if (disposed) return;
    });

    return () => {
      disposed = true;
    };
  }, [emotion]);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-lg">
      <div ref={hostRef} className="absolute inset-0" aria-hidden="true" />
    </div>
  );
}
