import type { AppWorkflowSummary } from "./types";

export function summarizeWorkflowForDisplay(
  summary?: AppWorkflowSummary,
): string | null {
  if (!summary) return null;

  const parts = [`${summary.completedSteps} 个完成`];
  if (summary.failedSteps > 0) {
    parts.push(`${summary.failedSteps} 个失败`);
  }
  if (summary.pendingSteps > 0) {
    parts.push(`${summary.pendingSteps} 个待处理`);
  }

  return `多 App 汇总：${parts.join("，")}`;
}
