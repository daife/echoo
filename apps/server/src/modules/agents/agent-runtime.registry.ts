import type { AgentType } from "@echoo/shared";
import type { AgentRuntimeHandler } from "./agent-runtime.handler.js";
import { PrimeWorldPlaceholderRuntime } from "./kinds/prime-world/prime-world-placeholder.runtime.js";
import { SliceFigureRuntime } from "./kinds/slice-figure/slice-figure.runtime.js";

export class AgentRuntimeRegistry {
  private readonly runtimes = new Map<AgentType, AgentRuntimeHandler>();

  constructor(runtimes: AgentRuntimeHandler[] = [new SliceFigureRuntime(), new PrimeWorldPlaceholderRuntime()]) {
    runtimes.forEach((runtime) => this.runtimes.set(runtime.type, runtime));
  }

  get(type: AgentType) {
    return this.runtimes.get(type) ?? null;
  }
}
