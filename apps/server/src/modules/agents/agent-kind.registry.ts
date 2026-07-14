import type { AgentType } from "@echoo/shared";
import type { AgentKindHandler } from "./agent-kind.handler.js";
import { PrimeFigureHandler } from "./kinds/prime-figure/prime-figure.handler.js";
import { PrimeWorldPlaceholderHandler } from "./kinds/prime-world/prime-world-placeholder.handler.js";
import { SliceFigureHandler } from "./kinds/slice-figure/slice-figure.handler.js";

export class AgentKindRegistry {
  private readonly handlers = new Map<AgentType, AgentKindHandler>();

  constructor(
    handlers: AgentKindHandler[] = [
      new SliceFigureHandler(),
      new PrimeFigureHandler(),
      new PrimeWorldPlaceholderHandler(),
    ],
  ) {
    handlers.forEach((handler) => this.handlers.set(handler.type, handler));
  }

  get(type: AgentType) {
    return this.handlers.get(type) ?? null;
  }
}
