import type { AgentRuntimeHandler } from "../../agent-runtime.handler.js";

export class PrimeWorldPlaceholderRuntime implements AgentRuntimeHandler {
  readonly type = "prime-world" as const;

  buildChatMessages(): never {
    throw new Error("Prime World runtime is not implemented yet.");
  }
}
