import type { CreatePrimeFigureRequest, UpdatePrimeFigureRequest } from "@echoo/shared";
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
            persona,
            background,
            personality,
            response_style,
            decision_style,
            current_situation,
            schedule_json,
            itinerary_json,
            variable_definitions_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        agentId,
        "active",
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
}
