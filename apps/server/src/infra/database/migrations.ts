import type { PoolConnection, RowDataPacket } from "mysql2/promise";

interface Migration {
  id: string;
  statements: string[];
}

const migrations: Migration[] = [
  {
    id: "001_resource_storage_metadata",
    statements: [
      `ALTER TABLE resources
        ADD COLUMN storage_provider ENUM('local', 's3') NOT NULL DEFAULT 'local' AFTER original_file_name,
        ADD COLUMN storage_key VARCHAR(1024) NULL AFTER storage_provider,
        ADD COLUMN byte_size BIGINT UNSIGNED NULL AFTER public_path,
        ADD COLUMN sha256 CHAR(64) NULL AFTER byte_size,
        ADD COLUMN width INT UNSIGNED NULL AFTER sha256,
        ADD COLUMN height INT UNSIGNED NULL AFTER width,
        ADD COLUMN duration_ms INT UNSIGNED NULL AFTER height,
        ADD COLUMN status ENUM('pending', 'processing', 'ready', 'failed', 'deleting') NOT NULL DEFAULT 'ready' AFTER duration_ms,
        ADD COLUMN updated_at BIGINT NULL AFTER created_at,
        ADD INDEX idx_resources_owner_status_created (owner_user_id, status, created_at)`,
      `UPDATE resources
         SET storage_key = storage_path,
             updated_at = created_at
       WHERE storage_key IS NULL`,
      `CREATE TABLE resource_variants (
        resource_id VARCHAR(64) NOT NULL,
        variant ENUM('original', 'thumb', 'display') NOT NULL,
        storage_provider ENUM('local', 's3') NOT NULL,
        storage_key VARCHAR(1024) NOT NULL,
        mime_type VARCHAR(160) NOT NULL,
        byte_size BIGINT UNSIGNED NOT NULL,
        etag VARCHAR(255) NULL,
        width INT UNSIGNED NULL,
        height INT UNSIGNED NULL,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        PRIMARY KEY (resource_id, variant),
        CONSTRAINT fk_resource_variants_resource FOREIGN KEY (resource_id)
          REFERENCES resources(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
      `CREATE TABLE message_resources (
        message_id VARCHAR(64) NOT NULL,
        resource_id VARCHAR(64) NOT NULL,
        created_at BIGINT NOT NULL,
        PRIMARY KEY (message_id, resource_id),
        INDEX idx_message_resources_resource (resource_id),
        CONSTRAINT fk_message_resources_message FOREIGN KEY (message_id)
          REFERENCES messages(id) ON DELETE CASCADE,
        CONSTRAINT fk_message_resources_resource FOREIGN KEY (resource_id)
          REFERENCES resources(id) ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
      `CREATE TABLE agent_resources (
        agent_id VARCHAR(64) NOT NULL,
        resource_id VARCHAR(64) NOT NULL,
        usage_kind VARCHAR(48) NOT NULL,
        created_at BIGINT NOT NULL,
        PRIMARY KEY (agent_id, resource_id, usage_kind),
        INDEX idx_agent_resources_resource (resource_id),
        CONSTRAINT fk_agent_resources_agent FOREIGN KEY (agent_id)
          REFERENCES agents(id) ON DELETE CASCADE,
        CONSTRAINT fk_agent_resources_resource FOREIGN KEY (resource_id)
          REFERENCES resources(id) ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
      `INSERT IGNORE INTO message_resources (message_id, resource_id, created_at)
       SELECT id, JSON_UNQUOTE(JSON_EXTRACT(content, '$.resourceId')), created_at
         FROM messages
        WHERE JSON_UNQUOTE(JSON_EXTRACT(content, '$.resourceId')) IS NOT NULL`,
    ],
  },
  {
    id: "002_remove_legacy_resource_storage_path",
    statements: [
      `ALTER TABLE resources
        MODIFY COLUMN storage_key VARCHAR(1024) NOT NULL,
        DROP COLUMN storage_path`,
    ],
  },
];

export async function runDatabaseMigrations(connection: PoolConnection) {
  await connection.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id VARCHAR(160) PRIMARY KEY,
    applied_at BIGINT NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);

  const [rows] = await connection.query<(RowDataPacket & { id: string })[]>(
    "SELECT id FROM schema_migrations",
  );
  const applied = new Set(rows.map((row) => row.id));
  for (const migration of migrations) {
    if (applied.has(migration.id)) continue;
    for (const statement of migration.statements)
      await connection.query(statement);
    await connection.execute(
      "INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)",
      [migration.id, Date.now()],
    );
  }
}
