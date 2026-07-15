export interface VisibleMessageAnchor {
  messageId: string;
  offsetTop: number;
}

export function captureVisibleMessageAnchor(
  scrollElement: HTMLElement,
): VisibleMessageAnchor | null {
  const viewportTop = scrollElement.getBoundingClientRect().top;
  const rows = scrollElement.querySelectorAll<HTMLElement>("[data-message-id]");
  for (const row of rows) {
    const bounds = row.getBoundingClientRect();
    if (bounds.bottom > viewportTop)
      return {
        messageId: row.dataset.messageId ?? "",
        offsetTop: bounds.top - viewportTop,
      };
  }
  return null;
}

export function restoreVisibleMessageAnchor(
  scrollElement: HTMLElement,
  anchor: VisibleMessageAnchor,
) {
  const viewportTop = scrollElement.getBoundingClientRect().top;
  const rows = scrollElement.querySelectorAll<HTMLElement>("[data-message-id]");
  const row = Array.from(rows).find(
    (item) => item.dataset.messageId === anchor.messageId,
  );
  if (!row) return;
  const currentOffset = row.getBoundingClientRect().top - viewportTop;
  scrollElement.scrollTop += currentOffset - anchor.offsetTop;
}
