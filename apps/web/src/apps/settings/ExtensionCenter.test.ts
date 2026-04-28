import { describe, expect, it } from "vitest";

import {
  formatRuntimeStatus,
  getExtensionToolCount,
  getSourceBadgeLabel,
  isManageableExtension,
  shouldShowTransportBadge,
  summarizeExtensions,
  type ExtensionSummary,
} from "./ExtensionCenter";

describe("summarizeExtensions", () => {
  it("counts extensions by kind and status", () => {
    const extensions: ExtensionSummary[] = [
      {
        id: "calendar",
        kind: "app",
        name: "Calendar",
        description: "",
        version: "0.1.0",
        source: "builtin",
        sourcePath: "",
        enabled: true,
        status: "ok",
        runtimeStatus: "active",
        category: "builtin",
        permissions: [],
        tools: [],
      },
      {
        id: "tavily-mcp",
        kind: "mcp",
        name: "Tavily MCP",
        description: "",
        version: "1.0.0",
        source: "local",
        sourcePath: "",
        enabled: false,
        status: "disabled",
        runtimeStatus: "disabled",
        category: "research",
        permissions: ["network"],
        tools: [{ name: "search" }],
      },
      {
        id: "stock",
        kind: "skill",
        name: "Stock Skill",
        description: "",
        version: "local",
        source: "local",
        sourcePath: "",
        enabled: true,
        status: "error",
        runtimeStatus: "available",
        category: "skill",
        permissions: ["env:STOCK_API_KEY"],
        tools: [{ name: "skill_stock" }],
      },
    ];

    const summary = summarizeExtensions(extensions);

    expect(summary.total).toBe(1);
    expect(summary.apps).toBe(0);
    expect(summary.mcp).toBe(1);
    expect(summary.skills).toBe(0);
    expect(summary.available).toBe(0);
    expect(summary.disabled).toBe(1);
    expect(summary.attention).toBe(0);
    expect(summary.tools).toBe(1);
  });

  it("keeps built-in apps out of the extension center", () => {
    const extensions: ExtensionSummary[] = [
      {
        id: "ai-chat",
        kind: "app",
        name: "AI Assistant",
        description: "",
        version: "1.0.0",
        source: "builtin",
        sourcePath: "",
        enabled: true,
        status: "ok",
        runtimeStatus: "available",
        category: "productivity",
        permissions: [],
        tools: [],
      },
      {
        id: "tavily-mcp",
        kind: "mcp",
        name: "Tavily MCP",
        description: "",
        version: "1.0.0",
        source: "local",
        sourcePath: "",
        enabled: true,
        status: "ok",
        runtimeStatus: "active",
        category: "research",
        permissions: ["network"],
        tools: [{ name: "search" }],
      },
    ];

    expect(extensions.filter(isManageableExtension).map((item) => item.id)).toEqual(["tavily-mcp"]);
    expect(summarizeExtensions(extensions).total).toBe(1);
  });

  it("keeps skills out of the top overview because the skill manager renders them below", () => {
    const extensions: ExtensionSummary[] = [
      {
        id: "stock",
        kind: "skill",
        name: "Stock Skill",
        description: "",
        version: "local",
        source: "local",
        sourcePath: "",
        enabled: true,
        status: "ok",
        runtimeStatus: "available",
        category: "skill",
        permissions: ["env:STOCK_API_KEY"],
        tools: [{ name: "skill_stock" }],
      },
    ];

    expect(extensions.filter(isManageableExtension)).toEqual([]);
    expect(summarizeExtensions(extensions).total).toBe(0);
  });

  it("hides builtin transport badge when source already says builtin", () => {
    const extension: ExtensionSummary = {
      id: "ai-chat",
      kind: "app",
      name: "AI Assistant",
      description: "",
      version: "1.0.0",
      source: "builtin",
      sourcePath: "",
      enabled: true,
      status: "ok",
      runtimeStatus: "available",
      category: "productivity",
      permissions: [],
      tools: [],
      transport: "builtin",
    };

    expect(shouldShowTransportBadge(extension)).toBe(false);
  });

  it("formats internal extension enums into user-facing labels", () => {
    expect(getSourceBadgeLabel("builtin")).toBe("系统内置");
    expect(getSourceBadgeLabel("local")).toBe("本地安装");
    expect(formatRuntimeStatus("available")).toBe("可用");
    expect(formatRuntimeStatus("inactive")).toBe("未连接");
  });

  it("treats disconnected MCP tool counts as unknown instead of zero", () => {
    const extension: ExtensionSummary = {
      id: "context7-mcp",
      kind: "mcp",
      name: "Context7 MCP",
      description: "",
      version: "1.0.0",
      source: "local",
      sourcePath: "",
      enabled: true,
      status: "ok",
      runtimeStatus: "inactive",
      category: "utility",
      permissions: ["network", "subprocess"],
      tools: [],
      transport: "stdio",
    };

    expect(getExtensionToolCount(extension)).toBeNull();
  });
});
