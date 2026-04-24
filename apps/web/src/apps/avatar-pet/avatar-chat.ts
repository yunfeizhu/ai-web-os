import { decodeModel, encodeModel, PROVIDERS } from "@/apps/settings/providers";
import type { Conversation } from "@/apps/ai-chat/types";
import { API_BASE } from "@/lib/backend";
import type { EmbeddingConfig, ProviderConfig } from "@/stores/settingsStore";

export const AVATAR_APP_ID = "avatar-pet";

const API = `${API_BASE}/agents`;
const AVATAR_CONVERSATION_TITLE = "虚拟伙伴";

type AvatarConversationCreate = {
  title: string;
  model: string;
  app_id: typeof AVATAR_APP_ID;
};

export type ResolvedAvatarModel = {
  providerId: string;
  modelId: string;
  provider: ProviderConfig;
  encodedModel: string;
  apiBase?: string;
};

async function avatarApiFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return res.json();
}

export async function getOrCreateAvatarConversation(
  modelId: string,
): Promise<Conversation> {
  const conversations = await avatarApiFetch<Conversation[]>(
    `/conversations?app_id=${encodeURIComponent(AVATAR_APP_ID)}`,
  );

  const existing = conversations[0];
  if (existing) {
    return existing;
  }

  const body: AvatarConversationCreate = {
    title: AVATAR_CONVERSATION_TITLE,
    model: modelId,
    app_id: AVATAR_APP_ID,
  };

  return avatarApiFetch<Conversation>("/conversations", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function resolveEncodedModel(
  defaultModel: string,
  providers: Record<string, ProviderConfig>,
): string | null {
  if (defaultModel.trim()) {
    return defaultModel;
  }

  for (const providerDef of PROVIDERS) {
    const provider = providers[providerDef.id];
    const modelId = provider?.enabledModels?.[0];
    if (provider?.apiKey && modelId) {
      return encodeModel(providerDef.id, modelId);
    }
  }

  return null;
}

export function resolveAvatarModel(
  defaultModel: string,
  providers: Record<string, ProviderConfig>,
): ResolvedAvatarModel | null {
  const encodedModel = resolveEncodedModel(defaultModel, providers);
  if (!encodedModel) {
    return null;
  }

  const { providerId, modelId } = decodeModel(encodedModel);
  const provider = providers[providerId];
  if (!provider?.apiKey || !modelId) {
    return null;
  }

  const providerDef = PROVIDERS.find((item) => item.id === providerId);

  return {
    providerId,
    modelId,
    provider,
    encodedModel,
    apiBase: provider.baseUrl || providerDef?.defaultBaseUrl,
  };
}

export function buildAvatarSystemPrompt(): string {
  return [
    "你是 AI-Native OS 桌面上的虚拟伙伴，陪伴用户完成日常工作与探索。",
    "回答要简洁、温和、可靠，优先给出能直接执行的下一步。",
    "请遵循 avatar-pet App 的人格与情绪协议：在合适时用 [emotion:happy]、[emotion:neutral]、[emotion:surprised]、[emotion:sad]、[emotion:angry] 或 [emotion:relaxed] 标记当前情绪。",
    "情绪标签只用于驱动桌宠表现，不要解释标签本身。",
  ].join("\n");
}

export function buildAvatarEmbeddingPayload(
  embeddingConfig: EmbeddingConfig | null,
) {
  return embeddingConfig ?? undefined;
}
