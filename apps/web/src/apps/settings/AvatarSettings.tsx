"use client";

import { useRef, type ChangeEvent } from "react";
import { Eye, EyeOff, RotateCcw, Upload } from "lucide-react";

import { SectionTitle } from "./Settings";
import {
  useAvatarStore,
  type AvatarModelSourceType,
} from "@/stores/avatarStore";

const SOURCE_OPTIONS: { id: AvatarModelSourceType; label: string }[] = [
  { id: "url", label: "URL" },
  { id: "zip", label: "Local ZIP" },
];

export function AvatarSettings() {
  const fileRef = useRef<HTMLInputElement>(null);
  const visible = useAvatarStore((state) => state.visible);
  const modelSourceType = useAvatarStore((state) => state.modelSourceType);
  const modelUrl = useAvatarStore((state) => state.modelUrl);
  const localModelName = useAvatarStore((state) => state.localModelName);
  const setVisible = useAvatarStore((state) => state.setVisible);
  const resetPlacement = useAvatarStore((state) => state.resetPlacement);
  const setModelUrl = useAvatarStore((state) => state.setModelUrl);
  const setLocalModelName = useAvatarStore((state) => state.setLocalModelName);
  const setModelSourceType = useAvatarStore((state) => state.setModelSourceType);

  const handleZipChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setLocalModelName(file.name);
    }
    event.target.value = "";
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
            Cubism 3/4 .model3.json URL
          </span>
          <input
            value={modelUrl}
            onChange={(event) => setModelUrl(event.target.value)}
            onFocus={() => setModelSourceType("url")}
            placeholder="/avatar/live2d/my-model/my-model.model3.json"
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
            Local ZIP
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
          <p className="mt-2 text-[12px]" style={{ color: "var(--t3)" }}>
            ZIP 暂只记录文件名；持久化将在后续任务中启用。
          </p>
        </div>
      </div>
    </div>
  );
}
