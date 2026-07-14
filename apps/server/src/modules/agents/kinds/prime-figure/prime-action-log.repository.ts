import type { PrimeFigureAction } from "@echoo/shared";

/** Runtime diagnostics belong in structured logs, not in a duplicate SQL audit table. */
export class PrimeActionLogRepository {
  async save(input: {
    ownerUserId: string;
    agentId: string;
    conversationId: string;
    action: PrimeFigureAction | { type: string; [key: string]: unknown };
    rationale?: string;
    status: "applied" | "failed";
    errorMessage?: string;
    now?: number;
  }) {
    const payload = {
      event: "prime_action",
      ...input,
      at: input.now ?? Date.now(),
    };
    if (input.status === "failed") console.error(JSON.stringify(payload));
  }
}
