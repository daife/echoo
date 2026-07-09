import type { AgentKindHandler } from "../../agent-kind.handler.js";

export class PrimeFigurePlaceholderHandler implements AgentKindHandler {
  readonly type = "prime-figure" as const;

  create(): never {
    throw new Error("Prime Figure creation is not implemented yet.");
  }

  update(): never {
    throw new Error("Prime Figure update is not implemented yet.");
  }
}

