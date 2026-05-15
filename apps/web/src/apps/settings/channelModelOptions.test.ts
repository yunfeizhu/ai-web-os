import { describe, expect, it } from "vitest";

import {
  buildChannelModelOptions,
  findChannelModelOption,
} from "./channelModelOptions";

describe("channel model options", () => {
  it("lists configured built-in provider models with resolved runtime fields", () => {
    const options = buildChannelModelOptions({
      qwen: {
        apiKey: "qwen-key",
        enabledModels: ["qwen-max"],
      },
    });

    expect(options).toEqual([
      expect.objectContaining({
        value: "qwen::qwen-max",
        providerId: "qwen",
        providerLabel: "阿里通义",
        modelId: "qwen-max",
        apiKey: "qwen-key",
        apiBase: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        compatType: "openai",
        isCustom: false,
      }),
    ]);
  });

  it("lists configured custom provider models and preserves compat type", () => {
    const options = buildChannelModelOptions({
      "openai-compatible": {
        name: "自定义兼容接口",
        isCustom: true,
        compatType: "anthropic",
        apiKey: "custom-key",
        baseUrl: "https://example.com/v1",
        enabledModels: ["kimi-k2.5"],
      },
    });

    expect(options).toEqual([
      expect.objectContaining({
        value: "openai-compatible::kimi-k2.5",
        providerId: "openai-compatible",
        providerLabel: "自定义兼容接口",
        modelId: "kimi-k2.5",
        apiKey: "custom-key",
        apiBase: "https://example.com/v1",
        compatType: "anthropic",
        isCustom: true,
      }),
    ]);
  });

  it("excludes providers without a key or enabled models", () => {
    const options = buildChannelModelOptions({
      openai: {
        apiKey: "",
        enabledModels: ["gpt-5.2"],
      },
      moonshot: {
        apiKey: "moonshot-key",
        enabledModels: [],
      },
    });

    expect(options).toEqual([]);
  });

  it("finds an option by encoded model value", () => {
    const options = buildChannelModelOptions({
      moonshot: {
        apiKey: "moonshot-key",
        enabledModels: ["kimi-k2.5"],
      },
    });

    expect(findChannelModelOption(options, "moonshot::kimi-k2.5")?.modelId).toBe(
      "kimi-k2.5",
    );
  });
});
