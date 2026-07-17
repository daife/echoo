import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import type { SyncEntityType, SyncOperation } from "@echoo/shared";
import {
  execute,
  getDatabase,
  queryOne,
  queryRows,
} from "../../infra/database/mysql.js";
import { getRedis } from "../../infra/redis/redis.js";

export const CHANGE_EVENT_WAKE_CHANNEL = "echoo:change-events:wake";
export const CHANGE_EVENT_RETENTION_MS = 7 * 24 * 60 * 60_000;

export interface ChangeEventRow extends RowDataPacket {
  seq: number;
  owner_user_id: string;
  entity_type: SyncEntityType;
  entity_id: string;
  conversation_id: string | null;
  operation: SyncOperation;
  published_at: number | null;
  created_at: number;
}

type DatabaseConnection = Pool | PoolConnection;

export class ChangeEventRepository {
  async append(
    input: {
      ownerUserId: string;
      entityType: SyncEntityType;
      entityId: string;
      conversationId?: string | null;
      operation: SyncOperation;
      createdAt?: number;
    },
    connection: DatabaseConnection = getDatabase(),
  ) {
    const result = await execute(
      `INSERT INTO change_events
       (owner_user_id, entity_type, entity_id, conversation_id, operation, published_at, created_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?)`,
      [
        input.ownerUserId,
        input.entityType,
        input.entityId,
        input.conversationId ?? null,
        input.operation,
        input.createdAt ?? Date.now(),
      ],
      connection,
    );
    const wakeTimer = setTimeout(() => {
      void getRedis()
        .then((redis) => redis.publish(CHANGE_EVENT_WAKE_CHANNEL, String(result.insertId)))
        .catch(() => undefined);
    }, 25);
    wakeTimer.unref();
    return result.insertId;
  }

  listAfter(ownerUserId: string, after: number, limit: number) {
    return queryRows<ChangeEventRow>(
      `SELECT * FROM change_events WHERE owner_user_id = ? AND seq > ?
       ORDER BY seq ASC LIMIT ?`,
      [ownerUserId, after, limit],
    );
  }

  listUnpublished(limit = 200) {
    return queryRows<ChangeEventRow>(
      "SELECT * FROM change_events WHERE published_at IS NULL ORDER BY seq ASC LIMIT ?",
      [limit],
    );
  }

  async markPublished(sequence: number, publishedAt = Date.now()) {
    await execute(
      "UPDATE change_events SET published_at = ? WHERE seq = ? AND published_at IS NULL",
      [publishedAt, sequence],
    );
  }

  async head(ownerUserId: string) {
    const row = await queryOne<RowDataPacket & { head: number | null }>(
      "SELECT MAX(seq) AS head FROM change_events WHERE owner_user_id = ?",
      [ownerUserId],
    );
    return Number(row?.head ?? 0);
  }

  async oldest(ownerUserId: string) {
    const row = await queryOne<RowDataPacket & { oldest: number | null }>(
      "SELECT MIN(seq) AS oldest FROM change_events WHERE owner_user_id = ?",
      [ownerUserId],
    );
    return Number(row?.oldest ?? 0);
  }

  async prune(now = Date.now()) {
    await execute("DELETE FROM change_events WHERE created_at < ?", [
      now - CHANGE_EVENT_RETENTION_MS,
    ]);
  }

  async outboxMetrics(now = Date.now()) {
    const row = await queryOne<RowDataPacket & {
      pending: number;
      oldest_created_at: number | null;
    }>(
      `SELECT COUNT(*) AS pending, MIN(created_at) AS oldest_created_at
       FROM change_events WHERE published_at IS NULL`,
    );
    const oldest = row?.oldest_created_at;
    return {
      pending: Number(row?.pending ?? 0),
      oldestPendingAgeMs: oldest == null ? 0 : Math.max(0, now - Number(oldest)),
    };
  }
}
