import type { AgentUsageEstimate } from "./types";

export function buildUsageEstimateLabels(
  usage: AgentUsageEstimate,
): string[] {
  const labels = [
    "Token 估算",
    `输入 ${usage.inputTokens}`,
    `输出 ${usage.outputTokens}`,
  ];

  if (usage.reasoningTokens > 0) {
    labels.push(`思考 ${usage.reasoningTokens}`);
  }

  labels.push(`总计 ${usage.totalTokens}`);
  return labels;
}
