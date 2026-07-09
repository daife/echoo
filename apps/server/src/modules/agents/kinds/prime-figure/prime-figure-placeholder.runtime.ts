import type { AgentRuntimeHandler } from "../../agent-runtime.handler.js";

export class PrimeFigurePlaceholderRuntime implements AgentRuntimeHandler {
  readonly type = "prime-figure" as const;

  buildChatMessages(): never {
    throw new Error("Prime Figure runtime is not implemented yet.");
  }
}

