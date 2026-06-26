import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ProviderConfig } from "@/stores/settingsStore";
import {
  AVATAR_APP_ID,
  buildAvatarEmbeddingPayload,
  buildAvatarSystemPrompt,
  confirmAvatarAction,
  getOrCreateAvatarConversation,
  resolveAvatarAppLaunchIntent,
  resolveAvatarConversationModel,
  resolveAvatarModel,
} from "./avatar-chat";

describe("resolveAvatarConversationModel", () => {
  it("uses the avatar-specific model when one is configured", () => {
    expect(
      resolveAvatarConversationModel("moonshot::kimi-k2.6", "openai::gpt-4.1-mini"),
    ).toBe("moonshot::kimi-k2.6");
  });

  it("falls back to the global default model when avatar model is blank", () => {
    expect(
      resolveAvatarConversationModel("  ", "openai::gpt-4.1-mini"),
    ).toBe("openai::gpt-4.1-mini");
  });
});

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

  it("throws the backend response body when loading conversations fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      text: async () => "conversation list failed",
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      getOrCreateAvatarConversation("gpt-4.1-mini"),
    ).rejects.toThrow("conversation list failed");
  });
});

describe("confirmAvatarAction", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("posts the confirmation decision for a pending avatar stream request", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    vi.stubGlobal("fetch", fetchMock);

    await confirmAvatarAction("request-123", true);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(
        "/agents/confirm?request_id=request-123&approved=true",
      ),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("URL-encodes request ids and posts rejected decisions", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    vi.stubGlobal("fetch", fetchMock);

    await confirmAvatarAction("request with spaces", false);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(
        "/agents/confirm?request_id=request%20with%20spaces&approved=false",
      ),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("throws the backend response body when confirmation fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      text: async () => "confirmation denied",
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(confirmAvatarAction("request-123", true)).rejects.toThrow(
      "confirmation denied",
    );
  });
});

describe("buildAvatarSystemPrompt", () => {
  it("keeps every supported emotion tag in the assistant instruction", () => {
    const prompt = buildAvatarSystemPrompt();

    for (const emotion of [
      "happy",
      "neutral",
      "surprised",
      "sad",
      "angry",
      "relaxed",
      "closed",
    ]) {
      expect(prompt).toContain(`[emotion:${emotion}]`);
    }
  });

  it("instructs the avatar to use hidden motion tags for Live2D actions", () => {
    const prompt = buildAvatarSystemPrompt();

    expect(prompt).toContain("[motion:heart]");
    expect(prompt).toContain("画爱心");
  });

  it("uses a companion persona without exposing product placement wording", () => {
    const prompt = buildAvatarSystemPrompt();

    expect(prompt).toContain("虚拟伙伴");
    expect(prompt).toContain("温和");
    expect(prompt).toContain("俏皮");
    expect(prompt).toContain("不要制造情感依赖");
    expect(prompt).toContain("切换到可靠助手模式");
    expect(prompt).not.toContain("AI-Web OS");
    expect(prompt).not.toContain("桌面上");
  });
});

describe("buildAvatarEmbeddingPayload", () => {
  it("omits embedding config when none is configured", () => {
    expect(buildAvatarEmbeddingPayload(null)).toBeUndefined();
  });

  it("passes configured embedding settings through unchanged", () => {
    const embeddingConfig = {
      provider: "openai",
      model: "text-embedding-3-small",
      apiKey: "embedding-key",
      baseUrl: "https://embedding.example/v1",
      dims: 1536,
    };

    expect(buildAvatarEmbeddingPayload(embeddingConfig)).toBe(embeddingConfig);
  });
});

describe("resolveAvatarAppLaunchIntent", () => {
  it("recognizes opening mail as a local app launch command", () => {
    expect(resolveAvatarAppLaunchIntent("打开邮件")).toMatchObject({
      appId: "mail",
      title: "邮件",
      icon: "Mail",
      appState: { activeFolder: "inbox", source: "avatar-pet" },
    });
  });

  it("recognizes other built-in app launch commands", () => {
    expect(resolveAvatarAppLaunchIntent("启动日历")).toMatchObject({
      appId: "calendar",
      title: "日历",
    });
    expect(resolveAvatarAppLaunchIntent("进入设置")).toMatchObject({
      appId: "settings",
      title: "设置",
    });
  });

  it("does not treat risky mail sending as a simple launch command", () => {
    expect(resolveAvatarAppLaunchIntent("帮我发一封邮件给小明")).toBeNull();
  });
});
