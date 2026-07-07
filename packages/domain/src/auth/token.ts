import type { AuthTokens } from "@echoo/shared";

export function isTokenExpired(tokens: Pick<AuthTokens, "expiresAt">, now = Date.now()): boolean {
  return tokens.expiresAt <= now;
}
