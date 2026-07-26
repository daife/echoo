import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2";
import { execute, queryOne, withTransaction } from "../../infra/database/mysql.js";

export const refreshSessionTtlMs = 90 * 24 * 60 * 60_000;

interface SessionDatabase {
  execute: typeof execute;
  queryOne: typeof queryOne;
  withTransaction: typeof withTransaction;
}

interface SessionRow extends RowDataPacket {
  id: string;
  user_id: string;
  expires_at: number;
  revoked_at: number | null;
}

export class AuthSessionRepository {
  constructor(
    private readonly database: SessionDatabase = {
      execute,
      queryOne,
      withTransaction,
    },
  ) {}

  async create(userId: string) {
    const token = randomBytes(48).toString("base64url");
    const now = Date.now();
    await this.database.execute(
      `INSERT INTO auth_sessions
       (id, user_id, refresh_token_hash, expires_at, revoked_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, ?, ?)`,
      [randomUUID(), userId, hash(token), now + refreshSessionTtlMs, now, now],
    );
    return { token, expiresAt: now + refreshSessionTtlMs };
  }

  async renew(token: string) {
    return this.database.withTransaction(async (connection) => {
      const row = await this.database.queryOne<SessionRow>(
        `SELECT * FROM auth_sessions WHERE refresh_token_hash = ? FOR UPDATE`,
        [hash(token)],
        connection,
      );
      if (!row || row.revoked_at || row.expires_at <= Date.now()) return null;
      const now = Date.now();
      await this.database.execute(
        `UPDATE auth_sessions SET expires_at = ?, updated_at = ?
         WHERE id = ?`,
        [now + refreshSessionTtlMs, now, row.id],
        connection,
      );
      return { userId: row.user_id, token, expiresAt: now + refreshSessionTtlMs };
    });
  }

  async revoke(token: string) {
    const now = Date.now();
    await this.database.execute(
      `UPDATE auth_sessions SET revoked_at = ?, updated_at = ?
       WHERE refresh_token_hash = ? AND revoked_at IS NULL`,
      [now, now, hash(token)],
    );
  }
}

function hash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
