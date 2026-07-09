import type { Agent, AgentType, CreatePrimeFigureRequest, CreateSliceFigureRequest, UpdatePrimeFigureRequest, UpdateSliceFigureRequest } from "@echoo/shared";

export interface AgentKindHandler {
  readonly type: AgentType;
  create(ownerUserId: string, input: unknown): Agent;
  update(ownerUserId: string, agentId: string, input: unknown): Agent | null;
}

export interface SliceFigureKindHandler extends AgentKindHandler {
  readonly type: "slice-figure";
  create(ownerUserId: string, input: CreateSliceFigureRequest): Agent;
  update(ownerUserId: string, agentId: string, input: UpdateSliceFigureRequest): Agent | null;
}

export interface PrimeFigureKindHandler extends AgentKindHandler {
  readonly type: "prime-figure";
  create(ownerUserId: string, input: CreatePrimeFigureRequest): Agent;
  update(ownerUserId: string, agentId: string, input: UpdatePrimeFigureRequest): Agent | null;
}
