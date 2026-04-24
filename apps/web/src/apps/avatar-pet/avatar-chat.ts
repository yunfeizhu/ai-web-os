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

export type AvatarAppLaunchIntent = {
  appId: string;
  title: string;
  icon: string;
  keywords: readonly string[];
  appState?: Record<string, unknown>;
  reply: string;
};

const AVATAR_APP_LAUNCH_INTENTS: readonly AvatarAppLaunchIntent[] = [
  {
    appId: "mail",
    title: "邮件",
    icon: "Mail",
    keywords: ["邮件", "邮箱", "收件箱", "发件箱", "草稿箱", "未读", "附件"],
    appState: { activeFolder: "inbox", source: "avatar-pet" },
    reply: "[emotion:happy]已为你打开系统邮件。",
  },
  {
    appId: "calendar",
    title: "日历",
    icon: "Calendar",
    keywords: ["日历", "日程", "会议", "行程", "待办"],
    reply: "[emotion:happy]已为你打开日历。",
  },
  {
    appId: "browser",
    title: "浏览器",
    icon: "Globe",
    keywords: ["浏览器", "网页"],
    reply: "[emotion:happy]已为你打开浏览器。",
  },
  {
    appId: "file-manager",
    title: "文件管理器",
    icon: "FolderOpen",
    keywords: ["文件", "文件管理器", "目录"],
    reply: "[emotion:happy]已为你打开文件管理器。",
  },
  {
    appId: "notes",
    title: "笔记",
    icon: "FileText",
    keywords: ["笔记", "备忘录"],
    reply: "[emotion:happy]已为你打开笔记。",
  },
  {
    appId: "document-editor",
    title: "文档",
    icon: "FilePenLine",
    keywords: ["文档", "富文本"],
    reply: "[emotion:happy]已为你打开文档。",
  },
  {
    appId: "whiteboard",
    title: "白板",
    icon: "PenTool",
    keywords: ["白板", "画布"],
    reply: "[emotion:happy]已为你打开白板。",
  },
  {
    appId: "terminal",
    title: "终端",
    icon: "Terminal",
    keywords: ["终端", "命令行"],
    reply: "[emotion:happy]已为你打开终端。",
  },
  {
    appId: "settings",
    title: "设置",
    icon: "Settings",
    keywords: ["设置", "系统设置"],
    reply: "[emotion:happy]已为你打开设置。",
  },
];

const APP_LAUNCH_PATTERN = /^(打开|启动|进入|切到|切换到)/;
const RISKY_MAIL_ACTION_PATTERN = /(发|发送|寄|回复).{0,8}邮件|邮件.{0,8}(发|发送|寄|回复)/;

export function resolveAvatarAppLaunchIntent(
  input: string,
): AvatarAppLaunchIntent | null {
  const text = input.trim();
  if (!APP_LAUNCH_PATTERN.test(text)) return null;
  if (RISKY_MAIL_ACTION_PATTERN.test(text)) return null;

  return (
    AVATAR_APP_LAUNCH_INTENTS.find((intent) =>
      [intent.title, ...intent.keywords].some((keyword) =>
        text.includes(keyword),
      ),
    ) ?? null
  );
}

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

export async function confirmAvatarAction(
  requestId: string,
  approved: boolean,
): Promise<void> {
  const res = await fetch(
    `${API}/confirm?request_id=${encodeURIComponent(requestId)}&approved=${approved}`,
    {
      method: "POST",
    },
  );
  if (!res.ok) {
    throw new Error(await res.text());
  }
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

export function resolveAvatarConversationModel(
  avatarModel: string,
  defaultModel: string,
): string {
  return avatarModel.trim() || defaultModel;
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
