import { STORAGE_KEYS, type AuthTokens } from "@echoo/shared";
import type { AuthRuntime } from "../contracts";

export class WebAuthRuntime implements AuthRuntime {
  private readonly sessionExpiredHandlers = new Set<() => void>();

  async saveTokens(tokens: AuthTokens): Promise<void> {
    localStorage.setItem(STORAGE_KEYS.accessToken, tokens.accessToken);
    localStorage.setItem(STORAGE_KEYS.refreshToken, tokens.refreshToken);
    localStorage.setItem(STORAGE_KEYS.tokenExpiresAt, String(tokens.expiresAt));
  }

  async getAccessToken(): Promise<string | null> {
    const token = localStorage.getItem(STORAGE_KEYS.accessToken);
    return token || null;
  }

  async getRefreshToken(): Promise<string | null> {
    return localStorage.getItem(STORAGE_KEYS.refreshToken);
  }

  async clearTokens(): Promise<void> {
    localStorage.removeItem(STORAGE_KEYS.accessToken);
    localStorage.removeItem(STORAGE_KEYS.refreshToken);
    localStorage.removeItem(STORAGE_KEYS.tokenExpiresAt);
  }

  async expireSession(): Promise<void> {
    await this.clearTokens();
    this.sessionExpiredHandlers.forEach((handler) => handler());
  }

  onSessionExpired(handler: () => void) {
    this.sessionExpiredHandlers.add(handler);
    return () => this.sessionExpiredHandlers.delete(handler);
  }
}
