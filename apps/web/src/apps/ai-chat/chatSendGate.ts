type DuplicateSubmitInput = {
  content: string;
  inFlightContent: string | null;
  queuedContent: string | null;
};

function normalizeMessageContent(value: string | null | undefined): string {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

export function shouldSuppressDuplicateSubmit({
  content,
  inFlightContent,
  queuedContent,
}: DuplicateSubmitInput): boolean {
  const normalized = normalizeMessageContent(content);
  if (!normalized) return true;

  return (
    normalizeMessageContent(inFlightContent) === normalized ||
    normalizeMessageContent(queuedContent) === normalized
  );
}
