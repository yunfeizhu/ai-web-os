const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff]/g;
const LATIN_RE = /[A-Za-z]/g;

export function buildReasoningDisplayText(content?: string): string {
  const text = content?.trim() ?? "";
  if (!text) return "";
  if (isMostlyEnglishReasoning(text)) {
    return "模型正在思考，并会用中文整理结果…";
  }
  return text;
}

function isMostlyEnglishReasoning(text: string): boolean {
  const cjkCount = text.match(CJK_RE)?.length ?? 0;
  const latinCount = text.match(LATIN_RE)?.length ?? 0;
  if (latinCount < 80) return false;
  return latinCount > cjkCount * 3;
}
