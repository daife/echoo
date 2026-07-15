import type { StoredPrimeFigureRuntimeConfig } from "../../../runtime-config/runtime-config.types.js";

export type PrimeOptionalOutputType =
  "image" | "voice" | "sticker" | "transfer";

export function isPrimeOutputEnabled(
  config: StoredPrimeFigureRuntimeConfig,
  type: PrimeOptionalOutputType,
) {
  return config.outputs[type].enabled;
}

export function isPrimeOutputMessageTypeEnabled(
  config: StoredPrimeFigureRuntimeConfig,
  type: string,
) {
  return (
    type === "text" ||
    ((type === "image" || type === "voice" || type === "sticker") &&
      isPrimeOutputEnabled(config, type))
  );
}

export function filterPrimeActionsByCapabilities<T>(
  actions: T[],
  config: StoredPrimeFigureRuntimeConfig,
  sourceIndices: number[] = actions.map((_, index) => index),
) {
  const retainedActions: T[] = [];
  const retainedSourceIndices: number[] = [];
  actions.forEach((action, index) => {
    const type = readPrimeActionOutputType(action);
    if (type === "schedule_wakeup" && !config.wakeups.proactive.enabled) return;
    if (
      (type === "image" ||
        type === "voice" ||
        type === "sticker" ||
        type === "transfer") &&
      !isPrimeOutputEnabled(config, type)
    )
      return;
    retainedActions.push(action);
    retainedSourceIndices.push(sourceIndices[index] ?? index);
  });
  return {
    actions: retainedActions,
    sourceIndices: retainedSourceIndices,
  };
}

function readPrimeActionOutputType(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const action = value as Record<string, unknown>;
  if (action.type === "schedule_wakeup") return "schedule_wakeup";
  if (action.type === "transfer") return "transfer";
  const message = action.message;
  if (message && typeof message === "object" && !Array.isArray(message)) {
    const type = (message as Record<string, unknown>).type;
    if (
      type === "text" ||
      type === "image" ||
      type === "voice" ||
      type === "sticker"
    )
      return type;
  }
  return action.type === "image" ||
    action.type === "voice" ||
    action.type === "sticker" ||
    action.type === "transfer"
    ? action.type
    : null;
}
