import { WebAuthRuntime } from "../web/WebAuthRuntime";
import { tauriInvoke } from "./tauriInvoke";

interface NativeAuthState {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export class TauriAuthRuntime extends WebAuthRuntime {
  private hydrated = false;

  async hydrateTokens(): Promise<void> {
    if (this.hydrated) return;
    this.hydrated = true;
    const state = await tauriInvoke<NativeAuthState>(
      "plugin:keepalive|handoff",
    ).catch(() => null);
    if (!state?.accessToken || !state.refreshToken) return;
    await this.saveTokens(state);
  }

  override async clearTokens(): Promise<void> {
    await super.clearTokens();
    await tauriInvoke("plugin:keepalive|stop").catch(() => undefined);
  }
}
