import type { VoiceClone, VoiceCloneState } from "@echoo/shared/voice-clones";
import type { RowDataPacket } from "mysql2";
import { execute, queryOne, queryRows, withTransaction } from "../../infra/database/mysql.js";
import { createId } from "../../shared/utils/id.js";

interface VoiceCloneRow extends RowDataPacket {
  id: string;
  owner_user_id: string;
  quota_slot: number;
  name: string;
  description: string;
  reference_id: string | null;
  state: VoiceCloneState | "creating";
  consent_confirmed_at: number;
  created_at: number;
  updated_at: number;
}

export class VoiceCloneRepository {
  async reserve(ownerUserId: string, name: string, description: string) {
    return withTransaction(async (connection) => {
      await queryOne<RowDataPacket>(
        "SELECT id FROM users WHERE id = ? FOR UPDATE",
        [ownerUserId],
        connection,
      );
      await execute(
        `DELETE FROM voice_clones WHERE owner_user_id = ? AND state = 'creating'
          AND updated_at < ?`,
        [ownerUserId, Date.now() - 10 * 60_000],
        connection,
      );
      const rows = await queryRows<VoiceCloneRow>(
        "SELECT quota_slot FROM voice_clones WHERE owner_user_id = ?",
        [ownerUserId],
        connection,
      );
      const occupied = new Set(rows.map((row) => row.quota_slot));
      const slot = [1, 2, 3, 4, 5].find((value) => !occupied.has(value));
      if (!slot) return null;
      const id = createId("vclone");
      const now = Date.now();
      await execute(
        `INSERT INTO voice_clones (
          id, owner_user_id, quota_slot, name, description, state,
          consent_confirmed_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'creating', ?, ?, ?)`,
        [id, ownerUserId, slot, name, description, now, now, now],
        connection,
      );
      return { id };
    });
  }

  async complete(id: string, referenceId: string, state: VoiceCloneState) {
    await execute(
      `UPDATE voice_clones SET reference_id = ?, state = ?, updated_at = ?
       WHERE id = ? AND state = 'creating'`,
      [referenceId, state, Date.now(), id],
    );
    return this.findInternal(id);
  }

  async release(id: string) {
    await execute("DELETE FROM voice_clones WHERE id = ? AND state = 'creating'", [id]);
  }

  async list(ownerUserId: string) {
    const rows = await queryRows<VoiceCloneRow>(
      `SELECT * FROM voice_clones WHERE owner_user_id = ? AND state != 'creating'
       ORDER BY created_at DESC`,
      [ownerUserId],
    );
    return rows.map(toVoiceClone);
  }

  async findForOwner(ownerUserId: string, id: string) {
    const row = await queryOne<VoiceCloneRow>(
      "SELECT * FROM voice_clones WHERE id = ? AND owner_user_id = ? AND state != 'creating'",
      [id, ownerUserId],
    );
    return row ? toVoiceClone(row) : null;
  }

  async updateState(id: string, state: VoiceCloneState) {
    await execute("UPDATE voice_clones SET state = ?, updated_at = ? WHERE id = ?", [
      state,
      Date.now(),
      id,
    ]);
  }

  async deleteForOwner(ownerUserId: string, id: string) {
    const result = await execute(
      "DELETE FROM voice_clones WHERE id = ? AND owner_user_id = ?",
      [id, ownerUserId],
    );
    return result.affectedRows > 0;
  }

  private async findInternal(id: string) {
    const row = await queryOne<VoiceCloneRow>("SELECT * FROM voice_clones WHERE id = ?", [id]);
    return row?.reference_id ? toVoiceClone(row) : null;
  }
}

function toVoiceClone(row: VoiceCloneRow): VoiceClone {
  if (!row.reference_id || row.state === "creating")
    throw new Error("Voice clone is not ready for presentation.");
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    referenceId: row.reference_id,
    state: row.state,
    consentConfirmedAt: row.consent_confirmed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
