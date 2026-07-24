import type { AppNavigationRuntime } from "../contracts";

export class WebAppNavigationRuntime implements AppNavigationRuntime {
  async listenBackButton(_handler: () => void): Promise<() => void> {
    return () => undefined;
  }
}
