import type { RowDataPacket } from "mysql2";
import { execute, queryOne } from "../../infra/database/mysql.js";
import type {
  StoredFigureRuntimeConfig,
  StoredUserRuntimeConfig,
} from "./runtime-config.types.js";

interface UserConfigRow extends RowDataPacket {
  config: unknown;
}

interface ConversationConfigRow extends RowDataPacket {
  mode: "global" | "custom";
  custom_config: unknown | null;
}

interface ResolvedConversationConfigRow extends RowDataPacket {
  conversation_type: string;
  user_config: unknown | null;
  mode: "global" | "custom" | null;
  custom_config: unknown | null;
}

export class RuntimeConfigRepository {
  async findResolvedConversationConfig(
    ownerUserId: string,
    conversationId: string,
  ) {
    const row = await queryOne<ResolvedConversationConfigRow>(
      `SELECT c.type AS conversation_type, u.config AS user_config,
              cc.mode, cc.custom_config
         FROM conversations c
         LEFT JOIN user_runtime_configs u ON u.owner_user_id = c.owner_user_id
         LEFT JOIN conversation_runtime_configs cc
           ON cc.owner_user_id = c.owner_user_id AND cc.conversation_id = c.id
        WHERE c.owner_user_id = ? AND c.id = ?`,
      [ownerUserId, conversationId],
    );
    return row
      ? {
          conversationType: row.conversation_type,
          userConfig: row.user_config
            ? parseJson<StoredUserRuntimeConfig>(row.user_config)
            : null,
          mode: row.mode,
          customConfig: row.custom_config
            ? parseJson<StoredFigureRuntimeConfig>(row.custom_config)
            : null,
        }
      : null;
  }

  async findUserConfig(ownerUserId: string) {
    const row = await queryOne<UserConfigRow>(
      "SELECT config FROM user_runtime_configs WHERE owner_user_id = ?",
      [ownerUserId],
    );
    return row ? parseJson<StoredUserRuntimeConfig>(row.config) : null;
  }

  async insertUserConfigIfAbsent(
    ownerUserId: string,
    config: StoredUserRuntimeConfig,
  ) {
    const now = Date.now();
    await execute(
      `INSERT IGNORE INTO user_runtime_configs
       (owner_user_id, config, created_at, updated_at) VALUES (?, ?, ?, ?)`,
      [ownerUserId, JSON.stringify(config), now, now],
    );
  }

  async saveUserConfig(ownerUserId: string, config: StoredUserRuntimeConfig) {
    await execute(
      "UPDATE user_runtime_configs SET config = ?, updated_at = ? WHERE owner_user_id = ?",
      [JSON.stringify(config), Date.now(), ownerUserId],
    );
  }

  async findConversationConfig(ownerUserId: string, conversationId: string) {
    const row = await queryOne<ConversationConfigRow>(
      `SELECT mode, custom_config FROM conversation_runtime_configs
       WHERE owner_user_id = ? AND conversation_id = ?`,
      [ownerUserId, conversationId],
    );
    return row
      ? {
          mode: row.mode,
          customConfig: row.custom_config
            ? parseJson<StoredFigureRuntimeConfig>(row.custom_config)
            : null,
        }
      : null;
  }

  async saveConversationConfig(input: {
    ownerUserId: string;
    conversationId: string;
    mode: "global" | "custom";
    customConfig: StoredFigureRuntimeConfig | null;
  }) {
    const now = Date.now();
    await execute(
      `INSERT INTO conversation_runtime_configs
       (conversation_id, owner_user_id, mode, custom_config, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE mode = VALUES(mode),
       custom_config = VALUES(custom_config), updated_at = VALUES(updated_at)`,
      [
        input.conversationId,
        input.ownerUserId,
        input.mode,
        input.customConfig ? JSON.stringify(input.customConfig) : null,
        now,
        now,
      ],
    );
  }
}

function parseJson<T>(value: unknown): T {
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}
