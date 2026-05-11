import type { ToolCall } from "./types";

const INTERNAL_RESULT_PREFIXES = ["ToolPolicyGuard:", "内部执行提示："];

export function isSyntheticToolPolicyResult(result?: string | null) {
  if (typeof result !== "string") return false;
  const text = result.trimStart();
  return INTERNAL_RESULT_PREFIXES.some((prefix) => text.startsWith(prefix));
}

export function isInternalToolEvent(
  event: Pick<ToolCall, "internal" | "skipped" | "result" | "error">,
) {
  if (event.internal || event.skipped) return true;
  return event.error === false && isSyntheticToolPolicyResult(event.result);
}

export function isVisibleToolCall(tc: ToolCall) {
  return !isInternalToolEvent(tc);
}
