import type { CreateSliceFigureRequest, UpdateSliceFigureRequest } from "@echoo/shared";
import { getDatabase } from "../../../../infra/database/sqlite.js";

export class SliceFigureRepository {
  private readonly db = getDatabase();

  create(agentId: string, input: CreateSliceFigureRequest) {
    this.db
      .prepare(
        `
          INSERT INTO agent_slice_figures (
            agent_id,
            prologue_html,
            current_situation,
            opening_line,
            linked_agent_ids_json,
            unlock_conditions_json,
            persona,
            background,
            personality,
            response_style,
            system_prompt
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        agentId,
        input.prologueHtml ?? "",
        input.currentSituation ?? "",
        input.openingLine ?? "",
        JSON.stringify(input.linkedAgentIds ?? []),
        input.unlockConditions ? JSON.stringify(input.unlockConditions) : null,
        input.persona,
        input.background,
        input.personality,
        input.responseStyle,
        input.systemPrompt
      );
  }

  update(agentId: string, input: UpdateSliceFigureRequest) {
    this.db
      .prepare(
        `
          UPDATE agent_slice_figures
          SET
            prologue_html = ?,
            current_situation = ?,
            opening_line = ?,
            linked_agent_ids_json = ?,
            unlock_conditions_json = ?,
            persona = ?,
            background = ?,
            personality = ?,
            response_style = ?,
            system_prompt = ?
          WHERE agent_id = ?
        `
      )
      .run(
        input.prologueHtml ?? "",
        input.currentSituation ?? "",
        input.openingLine ?? "",
        JSON.stringify(input.linkedAgentIds ?? []),
        input.unlockConditions ? JSON.stringify(input.unlockConditions) : null,
        input.persona,
        input.background,
        input.personality,
        input.responseStyle,
        input.systemPrompt,
        agentId
      );
  }
}
