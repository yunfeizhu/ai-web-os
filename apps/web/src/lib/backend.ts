import { decodeModel, PROVIDERS } from "@/apps/settings/providers";
import { useSettingsStore } from "@/stores/settingsStore";

export const DEFAULT_API_BASE = "http://localhost:8000/api/v1";
export const API_BASE = (process.env.NEXT_PUBLIC_API_BASE || DEFAULT_API_BASE).replace(/\/$/, "");

export function buildApiUrl(path: string) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE}${normalizedPath}`;
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(buildApiUrl(path), init);
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

export async function completeOnceStream(
  message: string,
  systemPrompt: string,
  onToken: (token: string) => void,
) {
  const ctx = getActiveModelContext();
  if (!ctx) {
    throw new Error("请先在设置中配置并选择可用模型。");
  }

  const res = await fetch(buildApiUrl("/agents/complete/stream"), {
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

  if (!res.ok) {
    throw new Error(await res.text());
  }
  if (!res.body) {
    throw new Error("当前浏览器不支持流式响应。");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";

  const handleEvent = (eventText: string) => {
    const lines = eventText.split(/\r?\n/);
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;

      const data = line.slice(5).trim();
      if (!data) continue;
      if (data === "[DONE]") return true;

      const payload = JSON.parse(data) as {
        token?: unknown;
        x_error?: unknown;
      };
      if (typeof payload.x_error === "string" && payload.x_error.trim()) {
        throw new Error(payload.x_error);
      }
      if (typeof payload.token === "string" && payload.token) {
        content += payload.token;
        onToken(payload.token);
      }
    }
    return false;
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() ?? "";

    for (const eventText of events) {
      if (handleEvent(eventText)) {
        return { content };
      }
    }

    if (done) break;
  }

  if (buffer.trim()) {
    handleEvent(buffer);
  }
  return { content };
}
