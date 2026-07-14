export interface StableContextWindow {
  minimum: number;
  maximum: number;
}

export function calculateStableContextStart(
  total: number,
  window: StableContextWindow,
) {
  const normalizedTotal = Math.max(0, Math.trunc(total));
  if (normalizedTotal <= window.maximum) return 0;

  const evictionStep = calculateStableContextEvictionStep(window);
  return (
    Math.floor((normalizedTotal - window.minimum) / evictionStep) * evictionStep
  );
}

export function calculateStableContextEvictionStep(
  window: StableContextWindow,
) {
  return window.maximum - window.minimum + 1;
}
