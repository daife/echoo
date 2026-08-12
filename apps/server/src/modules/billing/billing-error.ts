export const INSUFFICIENT_PLATFORM_BALANCE_CODE =
  "INSUFFICIENT_PLATFORM_BALANCE";
export const INSUFFICIENT_PLATFORM_BALANCE_MESSAGE =
  "平台余额不足，请充值后再使用平台提供的 AI 服务。";

export class InsufficientPlatformBalanceError extends Error {
  readonly code = INSUFFICIENT_PLATFORM_BALANCE_CODE;
}

export function isInsufficientPlatformBalanceError(error: unknown): boolean {
  if (error instanceof InsufficientPlatformBalanceError) return true;
  if (typeof error === "string")
    return error === INSUFFICIENT_PLATFORM_BALANCE_MESSAGE;
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    code?: unknown;
    message?: unknown;
    cause?: unknown;
  };
  return (
    candidate.code === INSUFFICIENT_PLATFORM_BALANCE_CODE ||
    candidate.message === INSUFFICIENT_PLATFORM_BALANCE_MESSAGE ||
    (candidate.cause !== error &&
      isInsufficientPlatformBalanceError(candidate.cause))
  );
}
