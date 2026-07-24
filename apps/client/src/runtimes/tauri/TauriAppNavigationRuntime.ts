import type { AppNavigationRuntime } from "../contracts";

export class TauriAppNavigationRuntime implements AppNavigationRuntime {
  async listenBackButton(handler: () => void): Promise<() => Promise<void>> {
    const { onBackButtonPress } = await import("@tauri-apps/api/app");
    const listener = await onBackButtonPress(handler);
    return () => listener.unregister();
  }
}
