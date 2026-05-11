import { describe, expect, it } from "vitest";

import { buildReasoningDisplayText } from "./reasoningDisplay";

describe("buildReasoningDisplayText", () => {
  it("keeps Chinese reasoning visible", () => {
    expect(
      buildReasoningDisplayText("我需要先查询天气，再根据搜索结果总结。"),
    ).toBe("我需要先查询天气，再根据搜索结果总结。");
  });

  it("replaces mostly English reasoning with a Chinese status", () => {
    const text =
      "The user wants to check the weather for Hangzhou next week. " +
      "I have some search results, but they are not very specific. " +
      "I should summarize from existing search results and avoid another query.";

    expect(buildReasoningDisplayText(text)).toBe(
      "模型正在思考，并会用中文整理结果…",
    );
  });

  it("allows short English tool names and URLs inside Chinese reasoning", () => {
    const text =
      "我需要使用 TavilyMcp Search 查询，并保留 https://example.com 这样的来源链接。";

    expect(buildReasoningDisplayText(text)).toBe(text);
  });
});
