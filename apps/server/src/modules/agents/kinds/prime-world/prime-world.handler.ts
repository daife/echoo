import { createPrimeWorldSchema, updatePrimeWorldSchema } from "@echoo/shared";
import type {
  CreatePrimeWorldRequest,
  PrimeWorldRuntimeState,
  UpdatePrimeWorldRequest,
} from "@echoo/shared";
import type { PrimeWorldKindHandler as PrimeWorldKindHandlerContract } from "../../agent-kind.handler.js";
import { AgentRepository } from "../../agent.repository.js";
import { compilePrimeWorld } from "./prime-world-compiler.js";
import { ResourceRepository } from "../../../resources/resource.repository.js";
import { collectPrimeWorldResourceIds } from "./prime-world-node-registry.js";
import { compilePrimeWorldJsonSchema } from "./prime-world-json-schema.js";

export class PrimeWorldHandler implements PrimeWorldKindHandlerContract {
  readonly type = "prime-world" as const;
  constructor(
    private readonly agents = new AgentRepository(),
    private readonly resources = new ResourceRepository(),
  ) {}

  async create(ownerUserId: string, input: CreatePrimeWorldRequest) {
    const parsed = createPrimeWorldSchema.parse(
      input,
    ) as CreatePrimeWorldRequest;
    const normalized = {
      ...parsed,
      detail: { ...parsed.detail, definitionRevision: 1 },
    };
    compilePrimeWorld(normalized.detail);
    await this.assertResources(ownerUserId, normalized.detail);
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
    await this.assertResources(ownerUserId, normalized.detail);
    if (parsed.preserveRuntimeState) {
      if (!normalized.detail.stateSchema)
        throw new Error("保留运行状态时必须提供 stateSchema。");
      const state = await this.agents.getRuntimeState<PrimeWorldRuntimeState>(ownerUserId, agentId);
      const validate = compilePrimeWorldJsonSchema(normalized.detail.stateSchema);
      if (!state || !validate(state.variables))
        throw new Error("现有运行状态不符合新的 stateSchema，无法保留运行状态。");
    }
    return this.agents.update(ownerUserId, agentId, normalized);
  }

  private async assertResources(ownerUserId: string, detail: CreatePrimeWorldRequest["detail"]) {
    const ids = collectPrimeWorldResourceIds(detail.workflow.nodes, detail.presentation.startView);
    for (const id of ids) {
      const resource = await this.resources.findById(id);
      if (!resource || resource.ownerUserId !== ownerUserId || resource.status !== "ready")
        throw new Error(`世界资源不存在、未就绪或不属于作者：${id}。`);
    }
  }
}
