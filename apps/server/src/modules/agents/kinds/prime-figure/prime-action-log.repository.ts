import type { PrimeFigureAction } from "@echoo/shared";
import { AgentRunFailureRepository } from "../../agent-run-failure.repository.js";

export class PrimeActionLogRepository {
  constructor(private readonly failures = new AgentRunFailureRepository()) {}

  async save(input: {
    ownerUserId: string;
    agentId: string;
    conversationId: string;
    action: PrimeFigureAction | { type: string; [key: string]: unknown };
    rationale?: string;
    status: "applied" | "failed";
    errorMessage?: string;
    diagnostics?: Record<string, unknown>;
    rawOutput?: string;
    cause?: unknown;
    now?: number;
  }) {
    if (input.status !== "failed") return;
    await this.failures.record({
      ownerUserId: input.ownerUserId,
      conversationId: input.conversationId,
      kind: "prime-figure",
      phase: String(input.action.type || "prime_action"),
      errorMessage: input.errorMessage ?? "本初角色动作执行失败。",
      ...(input.rawOutput !== undefined ? { rawOutput: input.rawOutput } : {}),
      diagnostics: {
        agentId: input.agentId,
        action: input.action,
        ...(input.rationale ? { rationale: input.rationale } : {}),
        ...(input.diagnostics ?? {}),
      },
      ...(input.cause !== undefined ? { cause: input.cause } : {}),
      now: input.now,
    });
  }
}
