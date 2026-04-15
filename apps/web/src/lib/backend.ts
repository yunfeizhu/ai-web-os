import { decodeModel, PROVIDERS } from "@/apps/settings/providers";
import { useSettingsStore } from "@/stores/settingsStore";

const DEFAULT_API_BASE = "http://localhost:8000/api/v1";
const API_BASE = (process.env.NEXT_PUBLIC_API_BASE || DEFAULT_API_BASE).replace(/\/$/, "");

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, init);
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return res.json();
}

export function getActiveModelContext() {
  const { providers, defaultModel } = useSettingsStore.getState();
  const encoded = defaultModel || (() => {
    const [providerId, cfg] = Object.entries(providers).find(([, value]) => {
      return Boolean(value.apiKey && value.enabledModels?.length);
    }) ?? [];
    if (!providerId || !cfg?.enabledModels?.length) return "";
    return `${providerId}::${cfg.enabledModels[0]}`;
  })();

  if (!encoded) return null;

  const { providerId, modelId } = decodeModel(encoded);
  const providerCfg = providers[providerId];
  const providerDef = PROVIDERS.find((provider) => provider.id === providerId);
  if (!providerCfg?.apiKey) return null;

  return {
    providerId,
    modelId,
    apiKey: providerCfg.apiKey,
    apiBase: providerCfg.baseUrl || providerDef?.defaultBaseUrl,
    compatType: providerCfg.compatType ?? "openai",
  };
}

export async function completeOnce(message: string, systemPrompt: string) {
  const ctx = getActiveModelContext();
  if (!ctx) {
    throw new Error("请先在设置中配置并选择可用模型。");
  }

  return apiFetch<{ content: string }>("/agents/complete", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": ctx.apiKey,
    },
    body: JSON.stringify({
      message,
      model: ctx.modelId,
      provider_id: ctx.providerId,
      compat_type: ctx.compatType,
      api_base: ctx.apiBase,
      system_prompt: systemPrompt,
    }),
  });
}
