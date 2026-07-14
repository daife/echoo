import type { PrimeFigureDetail, PrimeFigureStateUpdates } from "@echoo/shared";
import { execute } from "../../../../infra/database/mysql.js";

export class PrimeFigureRepository {
  async applyRuntimeUpdates(
    agentId: string,
    current: Pick<
      PrimeFigureDetail,
      "currentSituation" | "schedule" | "itinerary"
    >,
    updates: PrimeFigureStateUpdates = {},
  ) {
    const schedule = updates.schedule ?? current.schedule;
    await execute(
      `UPDATE agents SET definition = JSON_SET(definition,
        '$.detail.currentSituation', ?, '$.detail.schedule', CAST(? AS JSON), '$.detail.itinerary', ?),
        updated_at = ? WHERE id = ?`,
      [
        updates.currentSituation ?? current.currentSituation,
        JSON.stringify({ segments: schedule.segments }),
        updates.itinerary ?? current.itinerary,
        Date.now(),
        agentId,
      ],
    );
  }
}
