export interface StableContextWindow {
  minimum: number;
  maximum: number;
}

export interface FigureContextWindowConfig {
  sliceFigureRounds: StableContextWindow;
  primeFigureMessages: StableContextWindow;
  sliceFigureMemorySummaryRounds: number;
}

export function getFigureContextWindowConfig(): FigureContextWindowConfig {
  return {
    sliceFigureRounds: readStableContextWindow(
      "SLICE_FIGURE_CONTEXT_MIN_ROUNDS",
      "SLICE_FIGURE_CONTEXT_MAX_ROUNDS",
      100,
      199,
    ),
    primeFigureMessages: readStableContextWindow(
      "PRIME_FIGURE_CONTEXT_MIN_MESSAGES",
      "PRIME_FIGURE_CONTEXT_MAX_MESSAGES",
      150,
      249,
    ),
    sliceFigureMemorySummaryRounds: readPositiveInteger(
      "SLICE_FIGURE_MEMORY_SUMMARY_ROUNDS",
      500,
    ),
  };
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

function readStableContextWindow(
  minimumName: string,
  maximumName: string,
  defaultMinimum: number,
  defaultMaximum: number,
): StableContextWindow {
  const minimum = readPositiveInteger(minimumName, defaultMinimum);
  const maximum = readPositiveInteger(maximumName, defaultMaximum);
  if (maximum < minimum) {
    throw new Error(
      `${maximumName} must be greater than or equal to ${minimumName}.`,
    );
  }
  return { minimum, maximum };
}

function readPositiveInteger(name: string, fallback: number) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;

  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}
