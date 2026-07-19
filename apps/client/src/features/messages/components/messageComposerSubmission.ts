export interface TextSubmitKey {
  key: string;
  isComposing: boolean;
  keyCode: number;
}

export function shouldSubmitTextInput(event: TextSubmitKey) {
  return event.key === "Enter" && !event.isComposing && event.keyCode !== 229;
}
