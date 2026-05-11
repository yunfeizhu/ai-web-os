import { describe, expect, it } from "vitest";

import { isVisibleToolCall } from "./toolCallVisibility";
import type { ToolCall } from "./types";

function toolCall(overrides: Partial<ToolCall>): ToolCall {
  return {
    id: "call_1",
    name: "mcp_tavily_search",
    args: {},
    status: "done",
    ...overrides,
  };
}

describe("isVisibleToolCall", () => {
  it("hides OpenAI protocol-only internal skipped tool events", () => {
    expect(
      isVisibleToolCall(
        toolCall({
          internal: true,
          skipped: true,
          skipReason: "search_results_sufficient",
          displayResult: "已跳过不必要的网页正文抓取",
          result: "内部执行提示：已有搜索发现结果覆盖当前任务的关键需求。",
          error: false,
        }),
      ),
    ).toBe(false);
  });

  it("keeps normal tool calls visible", () => {
    expect(
      isVisibleToolCall(
        toolCall({
          result: "{\"results\":[{\"title\":\"天气预报\"}]}",
          error: false,
        }),
      ),
    ).toBe(true);
  });

  it("hides legacy synthetic policy results as a fallback", () => {
    expect(
      isVisibleToolCall(
        toolCall({
          result: "ToolPolicyGuard: previous result is sufficient.",
          error: false,
        }),
      ),
    ).toBe(false);
  });
});
