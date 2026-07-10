import {
  createPrimeFigureSchema,
  updatePrimeFigureSchema,
} from "@echoo/shared";
import type {
  Agent,
  CreatePrimeFigureRequest,
  UpdatePrimeFigureRequest,
} from "@echoo/shared";
import type { PrimeFigureKindHandler } from "../../agent-kind.handler.js";
import { AgentRepository } from "../../agent.repository.js";
import { PrimeFigureRepository } from "./prime-figure.repository.js";
import { PrimeFigureSessionRepository } from "./prime-figure-session.repository.js";
import { PrimeFigureStateRepository } from "./prime-figure-state.repository.js";

export class PrimeFigureHandler implements PrimeFigureKindHandler {
  readonly type = "prime-figure" as const;

  constructor(
    private readonly agents = new AgentRepository(),
    private readonly primeFigures = new PrimeFigureRepository(),
    private readonly states = new PrimeFigureStateRepository(),
    private readonly sessions = new PrimeFigureSessionRepository(),
  ) {}

  create(ownerUserId: string, input: CreatePrimeFigureRequest): Agent {
    const body = createPrimeFigureSchema.parse(input);
    let agentId = "";

    this.agents.transaction(() => {
      const base = this.agents.createBase(ownerUserId, body);
      agentId = base.id;
      this.primeFigures.create(base.id, body);
      this.states.createInitial({
        ownerUserId,
        agentId: base.id,
        figure: body,
        now: base.createdAt,
      });
      this.sessions.createInitialConversation({
        ownerUserId,
        agentId: base.id,
        name: body.name,
        preview: body.introduction || body.currentSituation || body.persona,
        now: base.createdAt,
      });
    });

    const agent = this.agents.findById(ownerUserId, agentId);
    if (!agent) throw new Error("无法加载刚创建的本初角色。");
    return agent;
  }

  update(
    ownerUserId: string,
    agentId: string,
    input: UpdatePrimeFigureRequest,
  ): Agent | null {
    const existing = this.agents.findById(ownerUserId, agentId);
    if (!existing || existing.type !== this.type) return null;

    const body = updatePrimeFigureSchema.parse(input);
    const now = Date.now();

    this.agents.transaction(() => {
      this.agents.updateBase(ownerUserId, agentId, body, now);
      this.primeFigures.update(agentId, body);
      this.states.reconcileVariables(ownerUserId, agentId, body);
      this.sessions.updateConversationPreview({
        ownerUserId,
        agentId,
        title: body.name,
        preview: body.introduction || body.currentSituation || body.persona,
        updatedAt: now,
      });
    });

    return this.agents.findById(ownerUserId, agentId);
  }
}
