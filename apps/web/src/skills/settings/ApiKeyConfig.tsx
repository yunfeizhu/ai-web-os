"use client";

import { useState } from "react";
import { Eye, EyeOff, Check, Trash2 } from "lucide-react";
import { useSettingsStore } from "@/stores/settingsStore";
import { SectionTitle } from "./Settings";

const PROVIDERS = [
  { id: "anthropic", name: "Anthropic", placeholder: "sk-ant-api03-...", color: "#D97706" },
  { id: "openai",    name: "OpenAI",    placeholder: "sk-proj-...",        color: "#10A37F" },
  { id: "google",    name: "Google AI", placeholder: "AIza...",            color: "#4285F4" },
  { id: "deepseek",  name: "DeepSeek",  placeholder: "sk-...",             color: "#6366F1" },
];

export function ApiKeyConfig() {
  const { apiKeys, setApiKey, removeApiKey, defaultModel, setDefaultModel } = useSettingsStore();
  const [reveal, setReveal] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState<Record<string, string>>({});

  const handleSave = (id: string) => {
    const v = editing[id];
    if (v !== undefined) {
      setApiKey(id, v.trim());
      setEditing((p) => { const n = { ...p }; delete n[id]; return n; });
    }
  };

  return (
    <div>
      <SectionTitle>API Key 管理</SectionTitle>
      <p className="text-[12px] mb-5" style={{ color: "var(--t3)" }}>
        所有 Key 仅保存在本地浏览器中。
      </p>

      <div className="space-y-3">
        {PROVIDERS.map((p) => {
          const existing = apiKeys[p.id];
          const isEditing = editing[p.id] !== undefined;
          const val = isEditing ? editing[p.id] : (existing?.key ?? "");
          return (
            <div
              key={p.id}
              className="rounded-xl p-4"
              style={{
                background: "rgba(0,0,0,0.02)",
                border: `0.5px solid ${existing?.isSet ? p.color + "40" : "rgba(0,0,0,0.08)"}`,
              }}
            >
              <div className="flex items-center justify-between mb-2.5">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full" style={{ background: existing?.isSet ? p.color : "rgba(0,0,0,0.15)" }} />
                  <span className="text-[13px] font-semibold">{p.name}</span>
                </div>
                {existing?.isSet && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                    style={{ background: p.color + "18", color: p.color }}>
                    已配置
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1 relative">
                  <input
                    type={reveal[p.id] ? "text" : "password"}
                    value={val}
                    placeholder={p.placeholder}
                    onChange={(e) => setEditing((prev) => ({ ...prev, [p.id]: e.target.value }))}
                    className="w-full pr-8 pl-3 py-1.5 rounded-lg text-[12px] outline-none transition-all"
                    style={{
                      background: "#fff",
                      border: "0.5px solid rgba(0,0,0,0.12)",
                      color: "var(--t1)",
                      fontFamily: "var(--font-mono)",
                    }}
                  />
                  <button className="absolute right-2 top-1/2 -translate-y-1/2"
                    onClick={() => setReveal((r) => ({ ...r, [p.id]: !r[p.id] }))}>
                    {reveal[p.id]
                      ? <EyeOff size={13} color="rgba(0,0,0,0.3)" />
                      : <Eye size={13} color="rgba(0,0,0,0.3)" />}
                  </button>
                </div>
                {isEditing && (
                  <button
                    onClick={() => handleSave(p.id)}
                    className="h-8 px-3 rounded-lg text-[12px] font-medium flex items-center gap-1"
                    style={{ background: "var(--accent)", color: "#fff" }}
                  >
                    <Check size={12} /> 保存
                  </button>
                )}
                {existing?.isSet && !isEditing && (
                  <button
                    onClick={() => removeApiKey(p.id)}
                    className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-red-50"
                  >
                    <Trash2 size={13} color="var(--red)" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-5">
        <p className="text-[12px] font-semibold mb-2" style={{ color: "var(--t2)" }}>默认模型</p>
        <select
          value={defaultModel}
          onChange={(e) => setDefaultModel(e.target.value)}
          className="w-full px-3 py-1.5 rounded-lg text-[12px] outline-none"
          style={{ background: "#fff", border: "0.5px solid rgba(0,0,0,0.12)", color: "var(--t1)", fontFamily: "var(--font-mono)" }}
        >
          <optgroup label="Anthropic">
            <option value="claude-sonnet-4-20250514">Claude Sonnet 4</option>
            <option value="claude-opus-4-20250514">Claude Opus 4</option>
          </optgroup>
          <optgroup label="OpenAI">
            <option value="gpt-4o">GPT-4o</option>
            <option value="gpt-4o-mini">GPT-4o Mini</option>
          </optgroup>
          <optgroup label="Google">
            <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
          </optgroup>
          <optgroup label="DeepSeek">
            <option value="deepseek-chat">DeepSeek Chat</option>
          </optgroup>
        </select>
      </div>
    </div>
  );
}
