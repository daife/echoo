import type { AuthTokens } from "@echoo/shared";

export interface AuthRuntime {
  saveTokens(tokens: AuthTokens): Promise<void>;
  getAccessToken(): Promise<string | null>;
  getRefreshToken(): Promise<string | null>;
  clearTokens(): Promise<void>;
  expireSession(): Promise<void>;
  hydrateTokens?(): Promise<void>;
  onSessionExpired?(handler: () => void): () => void;
}
