import { createPrimeWorldSchema, updatePrimeWorldSchema } from "@echoo/shared";
import type {
  CreatePrimeWorldRequest,
  UpdatePrimeWorldRequest,
} from "@echoo/shared";
import type { PrimeWorldKindHandler as PrimeWorldKindHandlerContract } from "../../agent-kind.handler.js";
import { AgentRepository } from "../../agent.repository.js";
import { compilePrimeWorld } from "./prime-world-compiler.js";

export class PrimeWorldHandler implements PrimeWorldKindHandlerContract {
  readonly type = "prime-world" as const;
  constructor(private readonly agents = new AgentRepository()) {}

  create(ownerUserId: string, input: CreatePrimeWorldRequest) {
    const parsed = createPrimeWorldSchema.parse(
      input,
    ) as CreatePrimeWorldRequest;
    const normalized = {
      ...parsed,
      detail: { ...parsed.detail, definitionRevision: 1 },
    };
    compilePrimeWorld(normalized.detail);
    return this.agents.create(ownerUserId, normalized);
  }

  async update(
    ownerUserId: string,
    agentId: string,
    input: UpdatePrimeWorldRequest,
  ) {
    const existing = await this.agents.findById(ownerUserId, agentId);
    if (!existing || existing.type !== this.type) return null;
    const parsed = updatePrimeWorldSchema.parse(
      input,
    ) as UpdatePrimeWorldRequest;
    const normalized = {
      ...parsed,
      detail: {
        ...parsed.detail,
        definitionRevision: existing.detail.definitionRevision + 1,
      },
    };
    compilePrimeWorld(normalized.detail);
    return this.agents.update(ownerUserId, agentId, normalized);
  }
}
