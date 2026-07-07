import type { MessageRuntime } from "../contracts";
import { tauriInvoke } from "./tauriInvoke";

export class TauriMessageRuntime implements MessageRuntime {
  async startRealtime(): Promise<void> {
    await tauriInvoke("plugin:keepalive|start").catch(() => undefined);
  }

  async stopRealtime(): Promise<void> {
    await tauriInvoke("plugin:keepalive|stop").catch(() => undefined);
  }

  async getStatus(): Promise<"running" | "stopped" | "unsupported"> {
    return tauriInvoke<"running" | "stopped" | "unsupported">("plugin:keepalive|status").catch(() => "unsupported");
  }
}
