import { createSliceFigureSchema, updateSliceFigureSchema } from "@echoo/shared";
import type { Agent, CreateSliceFigureRequest, UpdateSliceFigureRequest } from "@echoo/shared";
import type { SliceFigureKindHandler } from "../../agent-kind.handler.js";
import { AgentRepository } from "../../agent.repository.js";
import { SliceFigureRepository } from "./slice-figure.repository.js";
import { SliceFigureSessionRepository } from "./slice-figure-session.repository.js";

export class SliceFigureHandler implements SliceFigureKindHandler {
  readonly type = "slice-figure" as const;

  constructor(
    private readonly agents = new AgentRepository(),
    private readonly sliceFigures = new SliceFigureRepository(),
    private readonly sessions = new SliceFigureSessionRepository()
  ) {}

  create(ownerUserId: string, input: CreateSliceFigureRequest): Agent {
    const body = createSliceFigureSchema.parse(input);
    let agentId = "";

    this.agents.transaction(() => {
      const base = this.agents.createBase(ownerUserId, body);
      agentId = base.id;
      this.sliceFigures.create(base.id, body);
      this.sessions.createInitialConversation({
        ownerUserId,
        agentId: base.id,
        name: body.name,
        preview: body.openingLine || body.introduction || body.persona,
        openingLine: body.openingLine,
        now: base.createdAt
      });
    });

    const agent = this.agents.findById(ownerUserId, agentId);
    if (!agent) throw new Error("Created Slice Figure could not be loaded.");
    return agent;
  }

  update(ownerUserId: string, agentId: string, input: UpdateSliceFigureRequest): Agent | null {
    const existing = this.agents.findById(ownerUserId, agentId);
    if (!existing || existing.type !== this.type) return null;

    const body = updateSliceFigureSchema.parse(input);
    const now = Date.now();

    this.agents.transaction(() => {
      this.agents.updateBase(ownerUserId, agentId, body, now);
      this.sliceFigures.update(agentId, body);
      this.sessions.updateConversationPreview({
        ownerUserId,
        agentId,
        title: body.name,
        preview: body.openingLine || body.introduction || body.persona,
        updatedAt: now
      });
    });

    return this.agents.findById(ownerUserId, agentId);
  }
}

