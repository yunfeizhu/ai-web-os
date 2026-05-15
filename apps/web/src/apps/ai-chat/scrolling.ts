export function scrollMessagesToBottom(
  container: Pick<HTMLElement, "scrollHeight" | "scrollTo"> | null,
  behavior: ScrollBehavior,
) {
  if (!container) return;
  container.scrollTo({
    top: container.scrollHeight,
    behavior,
  });
}
