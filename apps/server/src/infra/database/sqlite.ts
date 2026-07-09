import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const migrations = [
  {
    id: "001_auth_tables",
    sql: `
      CREATE TABLE IF NOT EXISTS auth_users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        email_verified_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        token TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
        expires_at INTEGER NOT NULL,
        used_at INTEGER,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS email_verification_tokens (
        token TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
        expires_at INTEGER NOT NULL,
        used_at INTEGER,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id ON password_reset_tokens(user_id);
      CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_user_id ON email_verification_tokens(user_id);
    `,
  },
  {
    id: "002_agents_and_conversations",
    sql: `
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        owner_user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK (type IN ('prime-figure', 'slice-figure')),
        avatar_resource_path TEXT,
        cover_resource_path TEXT,
        name TEXT NOT NULL,
        attributes_json TEXT NOT NULL DEFAULT '[]',
        tags_json TEXT NOT NULL DEFAULT '[]',
        introduction TEXT NOT NULL DEFAULT '',
        prologue_html TEXT NOT NULL DEFAULT '',
        opening_line TEXT NOT NULL DEFAULT '',
        is_public INTEGER NOT NULL DEFAULT 0,
        linked_agent_ids_json TEXT NOT NULL DEFAULT '[]',
        unlock_conditions_json TEXT,
        persona TEXT NOT NULL,
        background TEXT NOT NULL,
        personality TEXT NOT NULL,
        response_style TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        owner_user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        type TEXT NOT NULL,
        agent_id TEXT REFERENCES agents(id) ON DELETE CASCADE,
        external_binding_id TEXT,
        last_message_preview TEXT,
        unread_count INTEGER NOT NULL DEFAULT 0,
        pinned_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_agents_owner_user_id ON agents(owner_user_id);
      CREATE INDEX IF NOT EXISTS idx_conversations_owner_user_id ON conversations(owner_user_id);
      CREATE INDEX IF NOT EXISTS idx_conversations_agent_id ON conversations(agent_id);
    `,
  },
  {
    id: "003_resources",
    sql: `
      CREATE TABLE IF NOT EXISTS resources (
        id TEXT PRIMARY KEY,
        owner_user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        original_file_name TEXT NOT NULL,
        storage_path TEXT NOT NULL,
        public_path TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_resources_owner_user_id ON resources(owner_user_id);
    `,
  },
  {
    id: "004_messages",
    sql: `
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        owner_user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        client_message_id TEXT,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
        content_type TEXT NOT NULL CHECK (content_type IN ('text', 'image', 'file', 'voice', 'video', 'system')),
        content_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'delivered', 'failed', 'read')),
        provider_id TEXT,
        model TEXT,
        metadata_json TEXT,
        read_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_owner_client_message_id
        ON messages(owner_user_id, client_message_id)
        WHERE client_message_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_messages_owner_created_at ON messages(owner_user_id, created_at, id);
      CREATE INDEX IF NOT EXISTS idx_messages_conversation_created_at ON messages(conversation_id, created_at, id);
      CREATE INDEX IF NOT EXISTS idx_messages_owner_conversation_created_at
        ON messages(owner_user_id, conversation_id, created_at, id);
    `,
  },
  {
    id: "005_compact_messages",
    sql: `
      DROP TABLE IF EXISTS messages_next;

      CREATE TABLE messages_next (
        id TEXT PRIMARY KEY,
        owner_user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        client_message_id TEXT,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
        content_type TEXT NOT NULL CHECK (content_type IN ('text', 'image', 'file', 'voice', 'video', 'system')),
        content_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'delivered', 'failed', 'read')),
        provider_id TEXT,
        model TEXT,
        metadata_json TEXT,
        read_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      INSERT OR IGNORE INTO messages_next (
        id,
        owner_user_id,
        conversation_id,
        client_message_id,
        role,
        content_type,
        content_json,
        status,
        provider_id,
        model,
        metadata_json,
        read_at,
        created_at,
        updated_at
      )
      SELECT
        id,
        owner_user_id,
        conversation_id,
        client_message_id,
        role,
        content_type,
        CASE
          WHEN json_valid(content_json) THEN json_remove(content_json, '$.raw')
          ELSE content_json
        END,
        status,
        provider_id,
        model,
        CASE
          WHEN metadata_json LIKE '%"kind":"opening_line"%' THEN '{"kind":"opening_line"}'
          WHEN metadata_json LIKE '%"kind":"ai_error"%' THEN '{"kind":"ai_error"}'
          ELSE NULL
        END,
        read_at,
        created_at,
        updated_at
      FROM messages;

      DROP TABLE messages;
      ALTER TABLE messages_next RENAME TO messages;

      CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_owner_client_message_id
        ON messages(owner_user_id, client_message_id)
        WHERE client_message_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_messages_owner_created_at ON messages(owner_user_id, created_at, id);
      CREATE INDEX IF NOT EXISTS idx_messages_conversation_created_at ON messages(conversation_id, created_at, id);
      CREATE INDEX IF NOT EXISTS idx_messages_owner_conversation_created_at
        ON messages(owner_user_id, conversation_id, created_at, id);
    `,
  },
  {
    id: "006_figure_agent_types",
    disableForeignKeys: true,
    sql: `
      DROP TABLE IF EXISTS agents_next;

      CREATE TABLE agents_next (
        id TEXT PRIMARY KEY,
        owner_user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK (type IN ('prime-figure', 'slice-figure')),
        avatar_resource_path TEXT,
        cover_resource_path TEXT,
        name TEXT NOT NULL,
        attributes_json TEXT NOT NULL DEFAULT '[]',
        tags_json TEXT NOT NULL DEFAULT '[]',
        introduction TEXT NOT NULL DEFAULT '',
        prologue_html TEXT NOT NULL DEFAULT '',
        opening_line TEXT NOT NULL DEFAULT '',
        is_public INTEGER NOT NULL DEFAULT 0,
        linked_agent_ids_json TEXT NOT NULL DEFAULT '[]',
        unlock_conditions_json TEXT,
        persona TEXT NOT NULL,
        background TEXT NOT NULL,
        personality TEXT NOT NULL,
        response_style TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      INSERT OR IGNORE INTO agents_next (
        id,
        owner_user_id,
        type,
        avatar_resource_path,
        cover_resource_path,
        name,
        attributes_json,
        tags_json,
        introduction,
        prologue_html,
        opening_line,
        is_public,
        linked_agent_ids_json,
        unlock_conditions_json,
        persona,
        background,
        personality,
        response_style,
        created_at,
        updated_at
      )
      SELECT
        id,
        owner_user_id,
        CASE
          WHEN type = 'core' THEN 'prime-figure'
          WHEN type = 'slice' THEN 'slice-figure'
          ELSE type
        END,
        avatar_resource_path,
        cover_resource_path,
        name,
        attributes_json,
        tags_json,
        introduction,
        prologue_html,
        opening_line,
        is_public,
        linked_agent_ids_json,
        unlock_conditions_json,
        persona,
        background,
        personality,
        response_style,
        created_at,
        updated_at
      FROM agents;

      DROP TABLE agents;
      ALTER TABLE agents_next RENAME TO agents;

      UPDATE conversations
      SET type = (
        SELECT agents.type
        FROM agents
        WHERE agents.id = conversations.agent_id
      )
      WHERE agent_id IS NOT NULL;

      CREATE INDEX IF NOT EXISTS idx_agents_owner_user_id ON agents(owner_user_id);
    `,
  },
  {
    id: "007_agent_current_situation",
    sql: `
      ALTER TABLE agents ADD COLUMN current_situation TEXT NOT NULL DEFAULT '';
    `,
  },
] as const;

let database: DatabaseSync | null = null;

export function getDatabase() {
  if (database) return database;

  const databasePath = resolve(
    process.cwd(),
    process.env.AUTH_DATABASE_FILE ?? ".data/auth.sqlite",
  );
  mkdirSync(dirname(databasePath), { recursive: true });

  database = new DatabaseSync(databasePath);
  database.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
  applyMigrations(database);

  return database;
}

export function closeDatabase() {
  database?.close();
  database = null;
}

function applyMigrations(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);

  const isApplied = db.prepare("SELECT 1 FROM schema_migrations WHERE id = ?");
  const recordApplied = db.prepare(
    "INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)",
  );

  for (const migration of migrations) {
    if (isApplied.get(migration.id)) continue;

    if ("disableForeignKeys" in migration && migration.disableForeignKeys) {
      db.exec("PRAGMA foreign_keys = OFF;");
    }
    db.exec("BEGIN");
    try {
      db.exec(migration.sql);
      recordApplied.run(migration.id, Date.now());
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    } finally {
      if ("disableForeignKeys" in migration && migration.disableForeignKeys) {
        db.exec("PRAGMA foreign_keys = ON;");
      }
    }
  }
}
