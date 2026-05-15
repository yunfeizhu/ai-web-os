import type { ProviderConfig } from "@/stores/settingsStore";

import { PROVIDERS, encodeModel } from "./providers";

export type ChannelModelOption = {
  value: string;
  providerId: string;
  providerLabel: string;
  modelId: string;
  apiKey: string;
  apiBase: string;
  compatType: "openai" | "anthropic";
  isCustom: boolean;
};

export function buildChannelModelOptions(
  providers: Record<string, ProviderConfig>,
): ChannelModelOption[] {
  const builtin = PROVIDERS.flatMap((provider) => {
    const config = providers[provider.id];
    if (!isSelectableProvider(config)) return [];
    return config.enabledModels.map((modelId) =>
      createOption({
        providerId: provider.id,
        providerLabel: provider.nameCn !== provider.name ? provider.nameCn : provider.name,
        modelId,
        config,
        fallbackBaseUrl: provider.defaultBaseUrl,
        isCustom: false,
      }),
    );
  });

  const custom = Object.entries(providers).flatMap(([providerId, config]) => {
    if (!config.isCustom || !isSelectableProvider(config)) return [];
    return config.enabledModels.map((modelId) =>
      createOption({
        providerId,
        providerLabel: config.name?.trim() || providerId,
        modelId,
        config,
        fallbackBaseUrl: "",
        isCustom: true,
      }),
    );
  });

  return [...builtin, ...custom];
}

export function findChannelModelOption(
  options: ChannelModelOption[],
  value: string,
): ChannelModelOption | undefined {
  return options.find((option) => option.value === value);
}

function isSelectableProvider(config: ProviderConfig | undefined): config is ProviderConfig {
  return Boolean(config?.apiKey?.trim() && config.enabledModels?.length);
}

function createOption({
  providerId,
  providerLabel,
  modelId,
  config,
  fallbackBaseUrl,
  isCustom,
}: {
  providerId: string;
  providerLabel: string;
  modelId: string;
  config: ProviderConfig;
  fallbackBaseUrl: string;
  isCustom: boolean;
}): ChannelModelOption {
  return {
    value: encodeModel(providerId, modelId),
    providerId,
    providerLabel,
    modelId,
    apiKey: config.apiKey,
    apiBase: config.baseUrl?.trim() || fallbackBaseUrl,
    compatType: config.compatType ?? "openai",
    isCustom,
  };
}
