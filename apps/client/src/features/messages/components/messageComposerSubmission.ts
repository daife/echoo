export interface TextSubmitKey {
  key: string;
  isComposing: boolean;
  keyCode?: number;
}

export function shouldSubmitTextInput(event: TextSubmitKey) {
  return event.key === "Enter" && !event.isComposing;
}

export function shouldSubmitTextBeforeInput(event: {
  inputType: string;
  isComposing: boolean;
}) {
  return (
    !event.isComposing &&
    (event.inputType === "insertLineBreak" ||
      event.inputType === "insertParagraph")
  );
}

export function shouldSuppressComposerActionClick(
  suppressUntil: number,
  now = Date.now(),
) {
  return now < suppressUntil;
}

export function resolveTextSubmission(
  liveInputValue: string | undefined,
  draft: string,
) {
  const text = (liveInputValue ?? draft).trim();
  return text || null;
}
