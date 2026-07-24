import type { AppNavigationRuntime } from "../contracts";
import { tauriInvoke } from "./tauriInvoke";

export class TauriAppNavigationRuntime implements AppNavigationRuntime {
  async listenBackButton(handler: () => void): Promise<() => Promise<void>> {
    const { onBackButtonPress } = await import("@tauri-apps/api/app");
    const listener = await onBackButtonPress(handler);
    return () => listener.unregister();
  }

  async moveToBackground(): Promise<void> {
    await tauriInvoke("plugin:keepalive|background");
  }
}
