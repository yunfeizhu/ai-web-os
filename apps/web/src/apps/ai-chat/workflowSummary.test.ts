import { describe, expect, it } from "vitest";

import { summarizeWorkflowForDisplay } from "./workflowSummary";
import type { AppWorkflowSummary } from "./types";

describe("summarizeWorkflowForDisplay", () => {
  it("formats finished and pending workflow steps", () => {
    const summary: AppWorkflowSummary = {
      status: "workflow_summary",
      workflowId: "wf_1",
      appCount: 3,
      completedSteps: 2,
      failedSteps: 0,
      pendingSteps: 1,
      hasFailures: false,
      apps: [
        { appId: "notes", appName: "笔记" },
        { appId: "documents", appName: "文档" },
        { appId: "calendar", appName: "日历" },
      ],
      steps: [],
      results: [],
    };

    expect(summarizeWorkflowForDisplay(summary)).toBe(
      "多 App 汇总：2 个完成，1 个待处理",
    );
  });

  it("surfaces failed steps before pending steps", () => {
    const summary: AppWorkflowSummary = {
      status: "workflow_summary",
      workflowId: "wf_2",
      appCount: 2,
      completedSteps: 1,
      failedSteps: 1,
      pendingSteps: 1,
      hasFailures: true,
      apps: [],
      steps: [],
      results: [],
    };

    expect(summarizeWorkflowForDisplay(summary)).toBe(
      "多 App 汇总：1 个完成，1 个失败，1 个待处理",
    );
  });
});
