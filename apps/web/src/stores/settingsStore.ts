import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface ProviderConfig {
  apiKey: string;
  baseUrl?: string;
  enabledModels: string[];
  // 自定义 Provider 专用
  name?: string;                        // 用户给的名字，如 "SiliconFlow"
  isCustom?: boolean;                   // true = 用户动态添加的自定义 Provider
  compatType?: "openai" | "anthropic";  // 兼容协议类型，默认 openai
}

export interface EmbeddingConfig {
  name?: string;    // 用户标注，如 "Qwen3-Embedding-8B"
  provider: string; // 协议类型，目前固定 "openai"（兼容所有 OpenAI 兼容接口）
  model: string;
  apiKey: string;
  baseUrl: string;
  dims: number;
}

export interface SettingsState {
  providers: Record<string, ProviderConfig>;
  defaultModel: string;
  avatarModel: string;
  language: string;
  toolKeys: Record<string, string>;
  embeddingConfig: EmbeddingConfig | null;

  setProvider: (id: string, cfg: Partial<ProviderConfig>) => void;
  removeProvider: (id: string) => void;
  setDefaultModel: (model: string) => void;
  setAvatarModel: (model: string) => void;
  setLanguage: (lang: string) => void;
  setToolKey: (name: string, key: string) => void;
  removeToolKey: (name: string) => void;
  setEmbeddingConfig: (cfg: EmbeddingConfig | null) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      providers: {},
      defaultModel: "",
      avatarModel: "",
      language: "zh-CN",
      toolKeys: {},
      embeddingConfig: null,

      setProvider: (id, cfg) =>
        set((s) => ({
          providers: {
            ...s.providers,
            [id]: { ...s.providers[id], ...cfg },
          },
        })),

      removeProvider: (id) =>
        set((s) => {
          const { [id]: _, ...rest } = s.providers;
          return { providers: rest };
        }),

      setDefaultModel: (model) => set({ defaultModel: model }),
      setAvatarModel: (model) => set({ avatarModel: model }),
      setLanguage: (lang) => set({ language: lang }),

      setToolKey: (name, key) =>
        set((s) => ({ toolKeys: { ...s.toolKeys, [name]: key } })),

      removeToolKey: (name) =>
        set((s) => {
          const { [name]: _, ...rest } = s.toolKeys;
          return { toolKeys: rest };
        }),

      setEmbeddingConfig: (cfg) => set({ embeddingConfig: cfg }),
    }),
    {
      name: "ai-os-settings",
      partialize: (s) => ({
        providers: s.providers,
        defaultModel: s.defaultModel,
        avatarModel: s.avatarModel,
        language: s.language,
        toolKeys: s.toolKeys,
        embeddingConfig: s.embeddingConfig,
      }),
    },
  ),
);
