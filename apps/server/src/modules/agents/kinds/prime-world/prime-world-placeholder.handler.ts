import type { AgentKindHandler } from "../../agent-kind.handler.js";

export class PrimeWorldPlaceholderHandler implements AgentKindHandler {
  readonly type = "prime-world" as const;

  create(): never {
    throw new Error("Prime World creation is not implemented yet.");
  }

  update(): never {
    throw new Error("Prime World update is not implemented yet.");
  }
}
