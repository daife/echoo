import type { MessageRuntime } from "../../runtimes/contracts";

export async function initRealtime(message: MessageRuntime) {
  return message.startRealtime();
}
