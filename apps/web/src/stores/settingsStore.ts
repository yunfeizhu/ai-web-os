import { create } from "zustand";
import { persist } from "zustand/middleware";

interface ApiKeyConfig {
  provider: string;
  key: string;
  isSet: boolean;
}

interface SettingsState {
  apiKeys: Record<string, ApiKeyConfig>;
  defaultModel: string;
  language: string;

  setApiKey: (provider: string, key: string) => void;
  removeApiKey: (provider: string) => void;
  setDefaultModel: (model: string) => void;
  setLanguage: (lang: string) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      apiKeys: {},
      defaultModel: "claude-sonnet-4-20250514",
      language: "zh-CN",

      setApiKey: (provider, key) =>
        set((s) => ({
          apiKeys: {
            ...s.apiKeys,
            [provider]: {
              provider,
              key,
              isSet: key.length > 0,
            },
          },
        })),

      removeApiKey: (provider) =>
        set((s) => {
          const { [provider]: _, ...rest } = s.apiKeys;
          return { apiKeys: rest };
        }),

      setDefaultModel: (model) => set({ defaultModel: model }),
      setLanguage: (lang) => set({ language: lang }),
    }),
    {
      name: "ai-os-settings",
      partialize: (state) => ({
        apiKeys: state.apiKeys,
        defaultModel: state.defaultModel,
        language: state.language,
      }),
    },
  ),
);
