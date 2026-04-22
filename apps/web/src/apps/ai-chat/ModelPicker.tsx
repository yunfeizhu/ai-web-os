"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Settings } from "lucide-react";
import { useSettingsStore } from "@/stores/settingsStore";
import { PROVIDERS, encodeModel, decodeModel } from "@/apps/settings/providers";
import { useWindowStore } from "@/stores/windowStore";

interface Props {
  value: string;           // "providerId::modelId"
  onChange: (v: string) => void;
}

export function ModelPicker({ value, onChange }: Props) {
  const { providers } = useSettingsStore();
  const { openWindow } = useWindowStore();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // 关闭下拉
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // 内置 Provider（已配置 + 有模型）
  const configuredBuiltin = PROVIDERS.filter(
    (p) => providers[p.id]?.apiKey && (providers[p.id]?.enabledModels?.length ?? 0) > 0
  );

  // 自定义 Provider（isCustom + 已配置 + 有模型）
  const configuredCustom = Object.entries(providers)
    .filter(([, cfg]) => cfg.isCustom && cfg.apiKey && (cfg.enabledModels?.length ?? 0) > 0)
    .map(([id, cfg]) => ({ id, name: cfg.name ?? id, color: "#8B5CF6", models: cfg.enabledModels }));

  const { providerId: currentProvider, modelId: currentModel } = value
    ? decodeModel(value)
    : { providerId: "", modelId: "" };

  const providerDef = PROVIDERS.find((p) => p.id === currentProvider);
  const customProviderName = providers[currentProvider]?.isCustom ? (providers[currentProvider]?.name ?? currentProvider) : null;
  const label = currentModel || "选择模型";

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[13px] font-medium transition-colors"
        style={{
          background: "var(--control-bg)",
          border: "0.5px solid var(--border)",
          color: "var(--t2)",
          maxWidth: 240,
        }}
      >
        {(providerDef || customProviderName) && (
          <div
            className="w-3 h-3 rounded-sm shrink-0"
            style={{ background: providerDef?.color ?? "#8B5CF6" }}
          />
        )}
        <span className="truncate" style={{ fontFamily: currentModel ? "var(--font-mono)" : "inherit", fontSize: currentModel ? 12 : 13 }}>{label}</span>
        <ChevronDown size={11} className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div
          className="absolute top-full mt-1 right-0 z-50 rounded-xl overflow-hidden"
          style={{
            minWidth: 240,
            maxHeight: 320,
            overflowY: "auto",
            background: "var(--surface-solid)",
            backdropFilter: "blur(20px)",
            border: "0.5px solid var(--border)",
            boxShadow: "var(--shadow-window)",
          }}
        >
          {configuredBuiltin.length === 0 && configuredCustom.length === 0 ? (
            <div className="px-4 py-5 text-center">
              <p className="text-[13px] mb-2" style={{ color: "var(--t2)" }}>尚未配置任何模型</p>
              <button
                onClick={() => {
                  openWindow("settings", "设置", "⚙️");
                  setOpen(false);
                }}
                className="flex items-center gap-1 mx-auto text-[13px] px-3 py-1.5 rounded-lg"
                style={{ background: "var(--accent)", color: "#fff" }}
              >
                <Settings size={11} /> 去配置
              </button>
            </div>
          ) : (
            <div className="py-1.5">
              {/* 内置 Provider */}
              {configuredBuiltin.map((p) => {
                const models = providers[p.id]?.enabledModels ?? [];
                return (
                  <div key={p.id} className="mb-1">
                    <div className="flex items-center gap-1.5 px-3 pt-1 pb-0.5">
                      <div className="w-2 h-2 rounded-sm" style={{ background: p.color }} />
                      <span className="text-[11px] font-semibold tracking-wide" style={{ color: "var(--t3)" }}>
                        {p.nameCn !== p.name ? p.nameCn : p.name}
                      </span>
                    </div>
                    {models.map((modelId) => {
                      const encoded = encodeModel(p.id, modelId);
                      const active = encoded === value;
                      return (
                        <button key={encoded} onClick={() => { onChange(encoded); setOpen(false); }}
                          className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left"
                          style={{ background: active ? p.color + "12" : "transparent" }}
                          onMouseEnter={(e) => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = "var(--control-bg)"; }}
                          onMouseLeave={(e) => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
                        >
                          <div className="w-5 h-5 rounded-full shrink-0 flex items-center justify-center text-[9px] font-bold text-white" style={{ background: p.color }}>
                            {p.name.slice(0, 1).toUpperCase()}
                          </div>
                          <span className="flex-1 text-[13px] truncate" style={{ color: active ? p.color : "var(--t1)", fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: active ? 500 : 400 }}>
                            {modelId}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                );
              })}

              {/* 自定义 Provider */}
              {configuredCustom.map(({ id, name, color, models }) => (
                <div key={id} className="mb-1">
                  <div className="flex items-center gap-1.5 px-3 pt-1 pb-0.5">
                    <div className="w-2 h-2 rounded-sm" style={{ background: color }} />
                    <span className="text-[11px] font-semibold tracking-wide" style={{ color: "var(--t3)" }}>{name}</span>
                  </div>
                  {models.map((modelId) => {
                    const encoded = encodeModel(id, modelId);
                    const active = encoded === value;
                    return (
                      <button key={encoded} onClick={() => { onChange(encoded); setOpen(false); }}
                        className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left"
                        style={{ background: active ? color + "12" : "transparent" }}
                        onMouseEnter={(e) => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = "var(--control-bg)"; }}
                        onMouseLeave={(e) => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
                      >
                        <div className="w-5 h-5 rounded-full shrink-0 flex items-center justify-center text-[9px] font-bold text-white" style={{ background: color }}>
                          {name.slice(0, 1).toUpperCase()}
                        </div>
                        <span className="flex-1 text-[13px] truncate" style={{ color: active ? color : "var(--t1)", fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: active ? 500 : 400 }}>
                          {modelId}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))}

              {/* 去设置入口 */}
              <div style={{ borderTop: "0.5px solid var(--border)" }}>
                <button
                  onClick={() => { openWindow("settings", "设置", "⚙️"); setOpen(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-[13px] transition-colors"
                  style={{ color: "var(--t3)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--control-bg)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <Settings size={11} /> 管理模型提供商
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
