import { randomUUID } from "node:crypto";
import type { PrimeFigureAction } from "@echoo/shared";
import { getDatabase } from "../../../../infra/database/sqlite.js";

export class PrimeActionLogRepository {
  private readonly db = getDatabase();

  save(input: {
    ownerUserId: string;
    agentId: string;
    conversationId: string;
    action: PrimeFigureAction | { type: string; [key: string]: unknown };
    rationale?: string;
    status: "applied" | "failed";
    errorMessage?: string;
    now?: number;
  }) {
    const now = input.now ?? Date.now();

    this.db
      .prepare(
        `
          INSERT INTO prime_action_logs (
            id,
            owner_user_id,
            agent_id,
            conversation_id,
            action_type,
            action_json,
            rationale,
            status,
            error_message,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        `pact_${randomUUID()}`,
        input.ownerUserId,
        input.agentId,
        input.conversationId,
        input.action.type,
        JSON.stringify(input.action),
        input.rationale ?? null,
        input.status,
        input.errorMessage ?? null,
        now,
        now
      );
  }
}
