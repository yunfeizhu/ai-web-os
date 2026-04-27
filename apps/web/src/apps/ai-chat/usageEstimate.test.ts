import { describe, expect, it } from "vitest";

import { buildUsageEstimateLabels } from "./usageEstimate";

describe("buildUsageEstimateLabels", () => {
  it("shows token counts without any cost labels", () => {
    const labels = buildUsageEstimateLabels({
      inputTokens: 21,
      outputTokens: 993,
      reasoningTokens: 195,
      totalTokens: 1209,
    });

    expect(labels).toEqual([
      "Token 估算",
      "输入 21",
      "输出 993",
      "思考 195",
      "总计 1209",
    ]);
    expect(labels.join(" ")).not.toMatch(/成本|费用|provider usage/i);
  });
});
