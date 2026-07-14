import {
  createSliceFigureSchema,
  updateSliceFigureSchema,
} from "@echoo/shared";
import type {
  CreateSliceFigureRequest,
  UpdateSliceFigureRequest,
} from "@echoo/shared";
import type { SliceFigureKindHandler } from "../../agent-kind.handler.js";
import { AgentRepository } from "../../agent.repository.js";

export class SliceFigureHandler implements SliceFigureKindHandler {
  readonly type = "slice-figure" as const;
  constructor(private readonly agents = new AgentRepository()) {}
  create(ownerUserId: string, input: CreateSliceFigureRequest) {
    return this.agents.create(
      ownerUserId,
      createSliceFigureSchema.parse(input),
    );
  }
  async update(
    ownerUserId: string,
    agentId: string,
    input: UpdateSliceFigureRequest,
  ) {
    const existing = await this.agents.findById(ownerUserId, agentId);
    if (!existing || existing.type !== this.type) return null;
    return this.agents.update(
      ownerUserId,
      agentId,
      updateSliceFigureSchema.parse(input),
    );
  }
}
