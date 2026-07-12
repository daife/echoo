import { createPrimeFigureSchema, updatePrimeFigureSchema } from "@echoo/shared";
import type { CreatePrimeFigureRequest, UpdatePrimeFigureRequest } from "@echoo/shared";
import type { PrimeFigureKindHandler } from "../../agent-kind.handler.js";
import { AgentRepository } from "../../agent.repository.js";

export class PrimeFigureHandler implements PrimeFigureKindHandler {
  readonly type = "prime-figure" as const;
  constructor(private readonly agents = new AgentRepository()) {}
  create(ownerUserId: string, input: CreatePrimeFigureRequest) {
    return this.agents.create(ownerUserId, createPrimeFigureSchema.parse(input));
  }
  async update(ownerUserId: string, agentId: string, input: UpdatePrimeFigureRequest) {
    const existing = await this.agents.findById(ownerUserId, agentId);
    if (!existing || existing.type !== this.type) return null;
    return this.agents.update(ownerUserId, agentId, updatePrimeFigureSchema.parse(input));
  }
}
