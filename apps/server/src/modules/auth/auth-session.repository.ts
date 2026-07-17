import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2";
import { execute, queryOne, withTransaction } from "../../infra/database/mysql.js";

const REFRESH_TTL_MS = 30 * 24 * 60 * 60_000;

interface SessionRow extends RowDataPacket {
  id: string;
  user_id: string;
  expires_at: number;
  revoked_at: number | null;
}

export class AuthSessionRepository {
  async create(userId: string) {
    const token = randomBytes(48).toString("base64url");
    const now = Date.now();
    await execute(
      `INSERT INTO auth_sessions
       (id, user_id, refresh_token_hash, expires_at, revoked_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, ?, ?)`,
      [randomUUID(), userId, hash(token), now + REFRESH_TTL_MS, now, now],
    );
    return { token, expiresAt: now + REFRESH_TTL_MS };
  }

  async rotate(token: string) {
    return withTransaction(async (connection) => {
      const row = await queryOne<SessionRow>(
        `SELECT * FROM auth_sessions WHERE refresh_token_hash = ? FOR UPDATE`,
        [hash(token)],
        connection,
      );
      if (!row || row.revoked_at || row.expires_at <= Date.now()) return null;
      const nextToken = randomBytes(48).toString("base64url");
      const now = Date.now();
      await execute(
        `UPDATE auth_sessions SET refresh_token_hash = ?, expires_at = ?, updated_at = ?
         WHERE id = ?`,
        [hash(nextToken), now + REFRESH_TTL_MS, now, row.id],
        connection,
      );
      return { userId: row.user_id, token: nextToken, expiresAt: now + REFRESH_TTL_MS };
    });
  }

  async revoke(token: string) {
    const now = Date.now();
    await execute(
      `UPDATE auth_sessions SET revoked_at = ?, updated_at = ?
       WHERE refresh_token_hash = ? AND revoked_at IS NULL`,
      [now, now, hash(token)],
    );
  }
}

function hash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
