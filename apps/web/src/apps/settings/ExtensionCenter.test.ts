import { describe, expect, it } from "vitest";

import { summarizeExtensions, type ExtensionSummary } from "./ExtensionCenter";

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

    expect(summary.total).toBe(3);
    expect(summary.apps).toBe(1);
    expect(summary.mcp).toBe(1);
    expect(summary.skills).toBe(1);
    expect(summary.available).toBe(1);
    expect(summary.disabled).toBe(1);
    expect(summary.attention).toBe(1);
    expect(summary.tools).toBe(2);
  });
});
