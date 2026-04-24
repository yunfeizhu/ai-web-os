"use client";

import { Bot } from "lucide-react";
import { useEffect, useRef, useState } from "react";

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

const CUBISM_CORE_SRC = "/vendor/live2d/live2dcubismcore.min.js";

function getSourceFallbackMessage(
  modelUrl: string,
  modelSourceType: "url" | "zip",
  localModelName: string,
): RuntimeState | null {
  if (modelSourceType === "zip") {
    if (!localModelName.trim()) {
      return {
        message: "鏈€夋嫨 Live2D ZIP / No local Live2D ZIP selected",
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

function fitModelToHost(model: Live2DModelInstance, host: HTMLDivElement) {
  const width = host.clientWidth || host.offsetWidth || 240;
  const height = host.clientHeight || host.offsetHeight || 240;
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

export function Live2DCanvas({ modelUrl, emotion }: Live2DCanvasProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const modelRef = useRef<Live2DModelInstance | null>(null);
  const emotionRef = useRef(emotion);
  const modelSourceType = useAvatarStore((state) => state.modelSourceType);
  const localModelName = useAvatarStore((state) => state.localModelName);
  const [runtimeState, setRuntimeState] = useState<RuntimeState>(() =>
    getSourceFallbackMessage(modelUrl, modelSourceType, localModelName) ?? {
      message: "正在加载 Live2D / Loading Live2D",
      tone: "info",
    },
  );

  emotionRef.current = emotion;

  useEffect(() => {
    let disposed = false;
    let app: PixiApplication | null = null;
    let model: Live2DModelInstance | null = null;
    let preparedZip: PreparedZipModel | null = null;
    const host = hostRef.current;
    const sourceFallback = getSourceFallbackMessage(
      modelUrl,
      modelSourceType,
      localModelName,
    );

    modelRef.current = null;

    if (sourceFallback) {
      setRuntimeState(sourceFallback);
      return () => {
        disposed = true;
      };
    }

    if (!host) {
      setRuntimeState({
        message: "Live2D 容器尚未准备好 / Live2D host is not ready",
        tone: "error",
      });
      return () => {
        disposed = true;
      };
    }

    setRuntimeState({
      message: "正在加载 Live2D / Loading Live2D",
      tone: "info",
    });

    const initialize = async () => {
      try {
        let modelSource = modelUrl;

        if (modelSourceType === "zip") {
          const zipFile = await loadAvatarZip();

          if (disposed) return;

          if (!zipFile) {
            setRuntimeState({
              message:
                "Local Live2D ZIP is no longer available. Please choose the ZIP again.",
              tone: "info",
            });
            return;
          }

          preparedZip = await prepareZipModelBlob(zipFile);
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
          resolution: window.devicePixelRatio || 1,
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

        fitModelToHost(model, host);
        app.stage.addChild(model);
        modelRef.current = model;
        setRuntimeState({ message: "", tone: "info" });
        await applyEmotion(model, emotionRef.current);
      } catch {
        destroyModel(model);
        destroyApp(app);
        revokeObjectUrls(preparedZip);
        preparedZip = null;
        app = null;
        model = null;
        modelRef.current = null;

        if (!disposed) {
          if (modelSourceType === "zip") {
            setRuntimeState({
              message:
                "Local Live2D ZIP could not be loaded. Please check the ZIP contains a valid model settings file.",
              tone: "error",
            });
            return;
          }

          setRuntimeState({
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
      modelRef.current = null;
      destroyModel(model);
      destroyApp(app);
      revokeObjectUrls(preparedZip);
      host.replaceChildren();
    };
  }, [localModelName, modelSourceType, modelUrl]);

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
      <div
        ref={hostRef}
        className="absolute inset-0"
        aria-hidden={Boolean(runtimeState.message)}
      />
      {runtimeState.message && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-4 text-center"
          style={{
            background:
              "linear-gradient(180deg, rgba(255,255,255,0.72), rgba(226,232,240,0.52))",
            border: "1px solid rgba(255,255,255,0.55)",
            color:
              runtimeState.tone === "error"
                ? "rgba(127,29,29,0.84)"
                : "rgba(30,41,59,0.72)",
          }}
          role="status"
        >
          <Bot size={46} strokeWidth={1.35} />
          <span className="max-w-full text-balance text-xs font-medium leading-5">
            {runtimeState.message}
          </span>
        </div>
      )}
    </div>
  );
}
