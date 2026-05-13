"use client";

import { useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  AlertTriangle,
  Eye,
  EyeOff,
  RotateCcw,
  Upload,
  Zap,
} from "lucide-react";

import { decodeModel, encodeModel, PROVIDERS } from "./providers";
import { SectionTitle } from "./Settings";
import {
  useAvatarStore,
  type AvatarModelSourceType,
} from "@/stores/avatarStore";
import {
  useSettingsStore,
  type ProviderConfig,
} from "@/stores/settingsStore";

const SOURCE_OPTIONS: { id: AvatarModelSourceType; label: string }[] = [
  { id: "url", label: "本地文件" },
  { id: "zip", label: "本地 ZIP" },
];

type AvatarModelGroup = {
  id: string;
  name: string;
  models: string[];
};

function buildAvatarModelGroups(
  providers: Record<string, ProviderConfig>,
): AvatarModelGroup[] {
  const builtinGroups = PROVIDERS.flatMap((providerDef) => {
    const provider = providers[providerDef.id];
    const models = provider?.enabledModels ?? [];
    if (!provider?.apiKey || models.length === 0) return [];

    return [
      {
        id: providerDef.id,
        name: providerDef.nameCn !== providerDef.name
          ? providerDef.nameCn
          : providerDef.name,
        models,
      },
    ];
  });

  const customGroups = Object.entries(providers).flatMap(([id, provider]) => {
    const models = provider.enabledModels ?? [];
    if (!provider.isCustom || !provider.apiKey || models.length === 0) {
      return [];
    }

    return [
      {
        id,
        name: provider.name ?? id,
        models,
      },
    ];
  });

  return [...builtinGroups, ...customGroups];
}

function getModelLabel(
  encodedModel: string,
  providers: Record<string, ProviderConfig>,
): string {
  if (!encodedModel.trim()) return "";

  const { providerId, modelId } = decodeModel(encodedModel);
  if (!modelId) return "";

  const builtin = PROVIDERS.find((provider) => provider.id === providerId);
  const providerName =
    providers[providerId]?.name ??
    (builtin?.nameCn !== builtin?.name ? builtin?.nameCn : builtin?.name) ??
    providerId;

  return `${providerName} / ${modelId}`;
}

export function AvatarSettings() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [zipSaveError, setZipSaveError] = useState("");
  const providers = useSettingsStore((state) => state.providers);
  const defaultModel = useSettingsStore((state) => state.defaultModel);
  const avatarModel = useSettingsStore((state) => state.avatarModel);
  const setAvatarModel = useSettingsStore((state) => state.setAvatarModel);
  const visible = useAvatarStore((state) => state.visible);
  const modelSourceType = useAvatarStore((state) => state.modelSourceType);
  const modelUrl = useAvatarStore((state) => state.modelUrl);
  const localModelName = useAvatarStore((state) => state.localModelName);
  const live2dError = useAvatarStore((state) => state.live2dError);
  const setVisible = useAvatarStore((state) => state.setVisible);
  const resetPlacement = useAvatarStore((state) => state.resetPlacement);
  const setModelUrl = useAvatarStore((state) => state.setModelUrl);
  const setLocalModelName = useAvatarStore((state) => state.setLocalModelName);
  const setModelSourceType = useAvatarStore((state) => state.setModelSourceType);
  const modelGroups = useMemo(
    () => buildAvatarModelGroups(providers),
    [providers],
  );
  const defaultModelLabel = useMemo(
    () => getModelLabel(defaultModel, providers),
    [defaultModel, providers],
  );

  const handleZipChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    if (!file) {
      event.target.value = "";
      return;
    }

    setZipSaveError("");

    try {
      const { saveAvatarZip } = await import("@/apps/avatar-pet/live2d-loader");
      const saved = await saveAvatarZip(file);
      setLocalModelName(saved.name);
    } catch {
      setZipSaveError(
        "保存本地 ZIP 失败，请重试或选择更小的文件。",
      );
    } finally {
      event.target.value = "";
    }
  };

  return (
    <div className="space-y-5">
      <SectionTitle>虚拟伙伴</SectionTitle>

      <div
        className="rounded-xl p-4"
        style={{
          background: "var(--panel-bg)",
          border: "0.5px solid var(--border)",
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p
              className="text-[13px] font-semibold"
              style={{ color: "var(--t1)" }}
            >
              Desktop pet
            </p>
            <p className="mt-1 text-[12px]" style={{ color: "var(--t3)" }}>
              显示状态与桌面位置
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setVisible(!visible)}
              className="flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium transition-colors"
              style={{
                background: visible ? "var(--accent)" : "var(--control-bg)",
                border: visible
                  ? "0.5px solid var(--accent)"
                  : "0.5px solid var(--border)",
                color: visible ? "#fff" : "var(--t2)",
              }}
              aria-pressed={visible}
            >
              {visible ? <Eye size={14} /> : <EyeOff size={14} />}
              {visible ? "显示中" : "已隐藏"}
            </button>
            <button
              type="button"
              onClick={() => resetPlacement()}
              className="flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium transition-colors"
              style={{
                background: "var(--control-bg)",
                border: "0.5px solid var(--border)",
                color: "var(--t2)",
              }}
            >
              <RotateCcw size={14} />
              重置位置
            </button>
          </div>
        </div>
      </div>

      {live2dError && (
        <div
          className="flex items-start gap-3 rounded-xl p-4"
          style={{
            background: "rgba(254,242,242,0.82)",
            border: "0.5px solid rgba(248,113,113,0.42)",
            color: "rgba(127,29,29,0.9)",
          }}
          role="alert"
        >
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <div className="min-w-0">
            <p className="text-[13px] font-semibold">Live2D 加载失败</p>
            <p className="mt-1 break-words text-[12px] leading-5">
              {live2dError}
            </p>
          </div>
        </div>
      )}

      <div
        className="rounded-xl p-4"
        style={{
          background: "var(--panel-bg)",
          border: "0.5px solid var(--border)",
        }}
      >
        <div className="mb-3 flex items-start gap-3">
          <div
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
            style={{
              background: "color-mix(in srgb, var(--accent) 12%, transparent)",
              color: "var(--accent)",
            }}
          >
            <Zap size={15} />
          </div>
          <div className="min-w-0 flex-1">
            <p
              className="text-[13px] font-semibold"
              style={{ color: "var(--t1)" }}
            >
              桌宠聊天模型
            </p>
            <p
              className="mt-1 text-[12px] leading-5"
              style={{ color: "var(--t3)" }}
            >
              建议选择不带深度思考的快速模型，让桌宠短对话更轻快；留空则跟随主助手默认模型。
            </p>
          </div>
        </div>

        <select
          value={avatarModel}
          onChange={(event) => setAvatarModel(event.target.value)}
          className="h-9 w-full rounded-lg px-3 text-[13px] outline-none transition-colors"
          style={{
            background: "var(--search-field-bg)",
            border: "0.5px solid var(--search-field-border)",
            color: "var(--t1)",
          }}
        >
          <option value="">
            {defaultModelLabel
              ? `跟随主助手默认模型（${defaultModelLabel}）`
              : "跟随主助手默认模型"}
          </option>
          {modelGroups.map((group) => (
            <optgroup key={group.id} label={group.name}>
              {group.models.map((modelId) => (
                <option
                  key={encodeModel(group.id, modelId)}
                  value={encodeModel(group.id, modelId)}
                >
                  {modelId}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        {modelGroups.length === 0 && (
          <p
            className="mt-2 text-[12px] leading-5"
            style={{ color: "var(--t3)" }}
          >
            先在“模型与密钥”里配置 API Key 和可用模型后，就可以给桌宠单独指定快速模型。
          </p>
        )}
      </div>

      <div>
        <p
          className="mb-3 text-[13px] font-semibold"
          style={{ color: "var(--t2)" }}
        >
          模型来源
        </p>
        <div
          className="inline-flex rounded-lg p-1"
          style={{
            background: "var(--control-bg)",
            border: "0.5px solid var(--border)",
          }}
        >
          {SOURCE_OPTIONS.map((option) => {
            const isActive = modelSourceType === option.id;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => setModelSourceType(option.id)}
                className="h-7 rounded-md px-3 text-[12px] font-medium transition-colors"
                style={{
                  background: isActive ? "var(--panel-bg)" : "transparent",
                  color: isActive ? "var(--t1)" : "var(--t3)",
                  boxShadow: isActive ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
                }}
                aria-pressed={isActive}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-4">
        <label className="block">
          <span
            className="mb-2 block text-[13px] font-medium"
            style={{ color: "var(--t2)" }}
          >
            Cubism 3/4 .model3.json 本地文件
          </span>
          <input
            value={modelUrl}
            onChange={(event) => setModelUrl(event.target.value)}
            onFocus={() => setModelSourceType("url")}
            placeholder="/avatar/assets/live2d/my-model/my-model.model3.json"
            className="h-9 w-full rounded-lg px-3 text-[13px] outline-none transition-colors"
            style={{
              background: "var(--search-field-bg)",
              border:
                modelSourceType === "url"
                  ? "0.5px solid var(--accent)"
                  : "0.5px solid var(--search-field-border)",
              color: "var(--t1)",
            }}
          />
        </label>

        <div>
          <span
            className="mb-2 block text-[13px] font-medium"
            style={{ color: "var(--t2)" }}
          >
            本地 ZIP
          </span>
          <button
            type="button"
            onClick={() => {
              setModelSourceType("zip");
              fileRef.current?.click();
            }}
            className="flex h-9 w-full items-center gap-2 rounded-lg px-3 text-left text-[13px] transition-colors"
            style={{
              background: "var(--panel-bg)",
              border:
                modelSourceType === "zip"
                  ? "0.5px solid var(--accent)"
                  : "0.5px solid var(--border)",
              color: localModelName ? "var(--t1)" : "var(--t3)",
            }}
          >
            <Upload size={14} style={{ color: "var(--t3)", flexShrink: 0 }} />
            <span className="min-w-0 flex-1 truncate">
              {localModelName || "选择包含一个 .model3.json 的 .zip 文件"}
            </span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".zip,application/zip,application/x-zip-compressed"
            className="hidden"
            onChange={handleZipChange}
          />
          {zipSaveError && (
            <p
              className="mt-2 text-[12px] leading-5"
              style={{ color: "rgba(185,28,28,0.88)" }}
              role="alert"
            >
              {zipSaveError}
            </p>
          )}
          <p className="mt-2 text-[12px]" style={{ color: "var(--t3)" }}>
            文件会保存到 ~/.ai-web-os/avatar，并由本地后端加载。
          </p>
        </div>
      </div>
    </div>
  );
}
