import type { NotificationState } from "@echoo/shared/notifications";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import {
  execute,
  queryOne,
  withTransaction,
} from "../../infra/database/mysql.js";
import { ChangeEventRepository } from "../sync/change-event.repository.js";

interface NotificationStateRow extends RowDataPacket {
  activity_unread: number;
  activity_updated_at: number;
}

export class NotificationRepository {
  constructor(private readonly events = new ChangeEventRepository()) {}

  async getState(userId: string): Promise<NotificationState> {
    const row = await queryOne<NotificationStateRow>(
      `SELECT activity_unread, activity_updated_at
       FROM user_notification_states WHERE user_id = ?`,
      [userId],
    );
    return rowToState(row);
  }

  async markActivityRead(userId: string): Promise<NotificationState> {
    return withTransaction(async (connection) => {
      const row = await queryOne<NotificationStateRow>(
        `SELECT activity_unread, activity_updated_at
         FROM user_notification_states WHERE user_id = ? FOR UPDATE`,
        [userId],
        connection,
      );
      if (!row?.activity_unread) return rowToState(row);
      await execute(
        `UPDATE user_notification_states
         SET activity_unread = FALSE, updated_at = ? WHERE user_id = ?`,
        [Date.now(), userId],
        connection,
      );
      await this.events.append(
        {
          ownerUserId: userId,
          entityType: "notification-state",
          entityId: "activity",
          operation: "upsert",
        },
        connection,
      );
      return {
        activityUnread: false,
        activityUpdatedAt: Number(row.activity_updated_at),
      };
    });
  }

  async markActivityUnreadForFollowers(
    authorUserId: string,
    updatedAt: number,
    connection: PoolConnection,
  ) {
    const now = Date.now();
    const result = await execute(
      `INSERT INTO user_notification_states
       (user_id, activity_unread, activity_updated_at, created_at, updated_at)
       SELECT follower_user_id, TRUE, ?, ?, ? FROM user_follows
       WHERE followed_user_id = ?
       ON DUPLICATE KEY UPDATE activity_unread = TRUE,
         activity_updated_at = GREATEST(activity_updated_at, VALUES(activity_updated_at)),
         updated_at = VALUES(updated_at)`,
      [updatedAt, now, now, authorUserId],
      connection,
    );
    await execute(
      `INSERT INTO change_events
       (owner_user_id, entity_type, entity_id, conversation_id, operation, published_at, created_at)
       SELECT follower_user_id, 'notification-state', 'activity', NULL, 'upsert', NULL, ?
       FROM user_follows WHERE followed_user_id = ?`,
      [updatedAt, authorUserId],
      connection,
    );
    return result.affectedRows;
  }

  wakeDispatcher() {
    this.events.wake();
  }
}

function rowToState(row: NotificationStateRow | null): NotificationState {
  return {
    activityUnread: Boolean(row?.activity_unread),
    activityUpdatedAt: Number(row?.activity_updated_at ?? 0),
  };
}
