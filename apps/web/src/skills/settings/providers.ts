export interface ProviderDef {
  id: string;
  name: string;
  nameCn: string;
  color: string;
  defaultBaseUrl: string;
  apiKeyUrl: string;
  supportsModelFetch: boolean;
}

// 内置知名 Provider，不含自定义兼容项（自定义由 store 动态管理）
export const PROVIDERS: ProviderDef[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    nameCn: "Anthropic",
    color: "#D97706",
    defaultBaseUrl: "https://api.anthropic.com/v1",
    apiKeyUrl: "https://console.anthropic.com/account/keys",
    supportsModelFetch: true,
  },
  {
    id: "openai",
    name: "OpenAI",
    nameCn: "OpenAI",
    color: "#10A37F",
    defaultBaseUrl: "https://api.openai.com/v1",
    apiKeyUrl: "https://platform.openai.com/account/api-keys",
    supportsModelFetch: true,
  },
  {
    id: "google",
    name: "Google Gemini",
    nameCn: "Google Gemini",
    color: "#4285F4",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    apiKeyUrl: "https://aistudio.google.com/app/apikey",
    supportsModelFetch: true,
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    nameCn: "深度求索",
    color: "#6366F1",
    defaultBaseUrl: "https://api.deepseek.com",
    apiKeyUrl: "https://platform.deepseek.com/api_keys",
    supportsModelFetch: true,
  },
  {
    id: "qwen",
    name: "Qwen",
    nameCn: "阿里通义",
    color: "#FF6A00",
    defaultBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    apiKeyUrl: "https://dashscope.console.aliyun.com/api-key",
    supportsModelFetch: true,
  },
  {
    id: "zhipu",
    name: "Zhipu",
    nameCn: "智谱清言",
    color: "#2B5FD9",
    defaultBaseUrl: "https://open.bigmodel.cn/api/paas/v4",
    apiKeyUrl: "https://open.bigmodel.cn/usercenter/apikeys",
    supportsModelFetch: true,
  },
  {
    id: "moonshot",
    name: "Moonshot",
    nameCn: "月之暗面",
    color: "#1A1A2E",
    defaultBaseUrl: "https://api.moonshot.cn/v1",
    apiKeyUrl: "https://platform.moonshot.cn/console/api-keys",
    supportsModelFetch: true,
  },
  {
    id: "doubao",
    name: "Doubao",
    nameCn: "豆包",
    color: "#1664FF",
    defaultBaseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    apiKeyUrl: "https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey",
    supportsModelFetch: true,
  },
];

export function getProvider(id: string): ProviderDef | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

/** "providerId::modelId" 格式互转 */
export function encodeModel(providerId: string, modelId: string) {
  return `${providerId}::${modelId}`;
}

export function decodeModel(encoded: string): { providerId: string; modelId: string } {
  const [providerId, ...rest] = encoded.split("::");
  return { providerId, modelId: rest.join("::") };
}

/** 生成自定义 Provider ID */
export function generateCustomProviderId(): string {
  return `custom_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}
