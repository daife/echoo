export function resolveTextSubmission(
  liveInputValue: string | undefined,
  draft: string,
) {
  const text = (liveInputValue ?? draft).trim();
  return text || null;
}
