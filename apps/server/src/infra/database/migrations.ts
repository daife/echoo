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
  {
    id: "003_platform_billing_and_catalog",
    statements: [
      `CREATE TABLE IF NOT EXISTS billing_accounts (
        owner_user_id VARCHAR(64) PRIMARY KEY,
        balance_micro_usd BIGINT NOT NULL DEFAULT 0,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        CONSTRAINT fk_billing_accounts_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
      `CREATE TABLE IF NOT EXISTS billing_ledger (
        id VARCHAR(64) PRIMARY KEY,
        owner_user_id VARCHAR(64) NOT NULL,
        kind ENUM('admin_credit', 'admin_debit', 'usage') NOT NULL,
        amount_micro_usd BIGINT NOT NULL,
        balance_after_micro_usd BIGINT NOT NULL,
        service VARCHAR(48) NULL,
        model VARCHAR(255) NULL,
        upstream_request_id VARCHAR(255) NULL,
        note VARCHAR(500) NULL,
        metadata JSON NULL,
        created_at BIGINT NOT NULL,
        UNIQUE KEY uq_billing_upstream (service, upstream_request_id),
        INDEX idx_billing_ledger_owner_created (owner_user_id, created_at DESC),
        CONSTRAINT fk_billing_ledger_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
      `CREATE TABLE IF NOT EXISTS platform_models (
        model_id VARCHAR(255) PRIMARY KEY, name VARCHAR(255) NOT NULL,
        description TEXT NULL, input_modalities JSON NOT NULL,
        output_modalities JSON NOT NULL, pricing JSON NOT NULL,
        supported_parameters JSON NOT NULL, context_length INT UNSIGNED NULL,
        available BOOLEAN NOT NULL DEFAULT TRUE, synced_at BIGINT NOT NULL,
        INDEX idx_platform_models_available_name (available, name)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
      `CREATE TABLE IF NOT EXISTS platform_model_endpoints (
        model_id VARCHAR(255) NOT NULL, provider_slug VARCHAR(160) NOT NULL,
        provider_name VARCHAR(255) NOT NULL, pricing JSON NOT NULL,
        status INT NOT NULL DEFAULT 0, latency_ms DOUBLE NULL,
        throughput DOUBLE NULL, synced_at BIGINT NOT NULL,
        PRIMARY KEY (model_id, provider_slug),
        CONSTRAINT fk_platform_model_endpoints_model FOREIGN KEY (model_id) REFERENCES platform_models(model_id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
      `CREATE TABLE IF NOT EXISTS platform_recommendations (
        category VARCHAR(64) NOT NULL, model_id VARCHAR(255) NOT NULL,
        service ENUM('openrouter', 'fish_audio') NOT NULL DEFAULT 'openrouter',
        provider_slugs JSON NOT NULL, display_order INT UNSIGNED NOT NULL DEFAULT 0,
        created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
        PRIMARY KEY (category, model_id),
        INDEX idx_platform_recommendations_order (category, display_order)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
      `CREATE TABLE IF NOT EXISTS platform_settings (
        setting_key VARCHAR(80) PRIMARY KEY, value_json JSON NOT NULL, updated_at BIGINT NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
      `INSERT IGNORE INTO platform_settings (setting_key, value_json, updated_at)
       VALUES ('billing_multiplier', JSON_OBJECT('value', 1.0), 0)`,
    ],
  },
  {
    id: "004_platform_settings_and_billing_accounts",
    statements: [
      `INSERT IGNORE INTO billing_accounts
         (owner_user_id, balance_micro_usd, created_at, updated_at)
       SELECT id, 0, created_at, created_at FROM users`,
      `UPDATE platform_settings
          SET value_json = JSON_EXTRACT(value_json, '$.value')
        WHERE setting_key = 'billing_multiplier'
          AND JSON_TYPE(value_json) = 'OBJECT'
          AND JSON_EXTRACT(value_json, '$.value') IS NOT NULL`,
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
