import type { MessageRuntime } from "../runtimes/contracts";

export class RealtimeService {
  constructor(private readonly messageRuntime: MessageRuntime) {}

  start() {
    return this.messageRuntime.startRealtime();
  }

  stop() {
    return this.messageRuntime.stopRealtime();
  }
}
