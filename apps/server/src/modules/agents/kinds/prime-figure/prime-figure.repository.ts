import type {
  CreatePrimeFigureRequest,
  PrimeFigureDetail,
  PrimeFigureStateUpdates,
  UpdatePrimeFigureRequest,
} from "@echoo/shared";
import { getDatabase } from "../../../../infra/database/sqlite.js";

export class PrimeFigureRepository {
  private readonly db = getDatabase();

  create(agentId: string, input: CreatePrimeFigureRequest) {
    this.db
      .prepare(
        `
          INSERT INTO agent_prime_figures (
            agent_id,
            status,
            prologue_html,
            linked_agent_ids_json,
            unlock_conditions_json,
            persona,
            background,
            personality,
            response_style,
            decision_style,
            current_situation,
            schedule_json,
            itinerary_json,
            variable_definitions_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        agentId,
        "active",
        input.prologueHtml ?? "",
        JSON.stringify(input.linkedAgentIds ?? []),
        input.unlockConditions ? JSON.stringify(input.unlockConditions) : null,
        input.persona,
        input.background,
        input.personality,
        input.responseStyle,
        input.decisionStyle ?? "",
        input.currentSituation ?? "",
        JSON.stringify(input.schedule ?? {}),
        JSON.stringify(input.itinerary ?? {}),
        JSON.stringify(input.variableDefinitions ?? [])
      );
  }

  update(agentId: string, input: UpdatePrimeFigureRequest) {
    this.db
      .prepare(
        `
          UPDATE agent_prime_figures
          SET
            prologue_html = ?,
            linked_agent_ids_json = ?,
            unlock_conditions_json = ?,
            persona = ?,
            background = ?,
            personality = ?,
            response_style = ?,
            decision_style = ?,
            current_situation = ?,
            schedule_json = ?,
            itinerary_json = ?,
            variable_definitions_json = ?
          WHERE agent_id = ?
        `
      )
      .run(
        input.prologueHtml ?? "",
        JSON.stringify(input.linkedAgentIds ?? []),
        input.unlockConditions ? JSON.stringify(input.unlockConditions) : null,
        input.persona,
        input.background,
        input.personality,
        input.responseStyle,
        input.decisionStyle ?? "",
        input.currentSituation ?? "",
        JSON.stringify(input.schedule ?? {}),
        JSON.stringify(input.itinerary ?? {}),
        JSON.stringify(input.variableDefinitions ?? []),
        agentId
      );
  }

  applyRuntimeUpdates(
    agentId: string,
    current: Pick<PrimeFigureDetail, "currentSituation" | "schedule" | "itinerary">,
    updates: PrimeFigureStateUpdates = {},
  ) {
    this.db
      .prepare(
        `
          UPDATE agent_prime_figures
          SET current_situation = ?, schedule_json = ?, itinerary_json = ?
          WHERE agent_id = ?
        `,
      )
      .run(
        updates.currentSituation ?? current.currentSituation,
        JSON.stringify(updates.schedule ?? current.schedule),
        JSON.stringify(updates.itinerary ?? current.itinerary),
        agentId,
      );
  }
}
