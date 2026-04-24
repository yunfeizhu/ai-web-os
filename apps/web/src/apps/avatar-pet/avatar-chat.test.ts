import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ProviderConfig } from "@/stores/settingsStore";
import {
  AVATAR_APP_ID,
  getOrCreateAvatarConversation,
  resolveAvatarModel,
} from "./avatar-chat";

describe("resolveAvatarModel", () => {
  it("falls back to the first configured provider in built-in provider order", () => {
    const providers: Record<string, ProviderConfig> = {
      openai: {
        apiKey: "openai-key",
        enabledModels: ["gpt-4.1-mini"],
      },
      anthropic: {
        apiKey: "anthropic-key",
        enabledModels: ["claude-sonnet-4-5"],
        baseUrl: "https://anthropic.example/v1",
      },
    };

    const resolved = resolveAvatarModel("", providers);

    expect(resolved).toMatchObject({
      providerId: "anthropic",
      modelId: "claude-sonnet-4-5",
      encodedModel: "anthropic::claude-sonnet-4-5",
      apiBase: "https://anthropic.example/v1",
    });
    expect(resolved?.provider).toBe(providers.anthropic);
  });

  it("uses the provider default base URL when a selected model has no custom base URL", () => {
    const providers: Record<string, ProviderConfig> = {
      openai: {
        apiKey: "openai-key",
        enabledModels: ["gpt-4.1-mini"],
      },
    };

    expect(resolveAvatarModel("openai::gpt-4.1-mini", providers)).toMatchObject({
      providerId: "openai",
      modelId: "gpt-4.1-mini",
      encodedModel: "openai::gpt-4.1-mini",
      apiBase: "https://api.openai.com/v1",
    });
  });

  it("returns null when the resolved provider has no API key", () => {
    const providers: Record<string, ProviderConfig> = {
      openai: {
        apiKey: "",
        enabledModels: ["gpt-4.1-mini"],
      },
    };

    expect(resolveAvatarModel("openai::gpt-4.1-mini", providers)).toBeNull();
    expect(resolveAvatarModel("", providers)).toBeNull();
  });
});

describe("getOrCreateAvatarConversation", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("reuses the first existing avatar conversation", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          id: "conv-existing",
          title: "旧对话",
          model: "gpt-4.1-mini",
          updatedAt: "2026-04-24T00:00:00.000Z",
        },
      ],
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getOrCreateAvatarConversation("gpt-4.1-mini")).resolves.toEqual({
      id: "conv-existing",
      title: "旧对话",
      model: "gpt-4.1-mini",
      updatedAt: "2026-04-24T00:00:00.000Z",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain(
      `/agents/conversations?app_id=${AVATAR_APP_ID}`,
    );
  });

  it("creates an avatar conversation when none exists", async () => {
    const created = {
      id: "conv-created",
      title: "虚拟伙伴",
      model: "gpt-4.1-mini",
      updatedAt: "2026-04-24T00:00:00.000Z",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => created,
      });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getOrCreateAvatarConversation("gpt-4.1-mini")).resolves.toEqual(
      created,
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toContain("/agents/conversations");
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "虚拟伙伴",
        model: "gpt-4.1-mini",
        app_id: AVATAR_APP_ID,
      }),
    });
  });
});
