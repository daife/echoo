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
        type TEXT NOT NULL CHECK (type IN ('core', 'slice')),
        name TEXT NOT NULL,
        persona TEXT NOT NULL,
        background TEXT NOT NULL,
        personality TEXT NOT NULL,
        speech_style TEXT NOT NULL,
        opening_line TEXT NOT NULL,
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
    id: "003_slice_agent_resources_and_metadata",
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

      ALTER TABLE agents ADD COLUMN avatar_resource_path TEXT;
      ALTER TABLE agents ADD COLUMN cover_resource_path TEXT;
      ALTER TABLE agents ADD COLUMN attributes_json TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE agents ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE agents ADD COLUMN introduction TEXT NOT NULL DEFAULT '';
      ALTER TABLE agents ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE agents ADD COLUMN linked_agent_ids_json TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE agents ADD COLUMN unlock_conditions_json TEXT;
      ALTER TABLE agents ADD COLUMN response_style TEXT NOT NULL DEFAULT '';
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

    db.exec("BEGIN");
    try {
      applyMigrationSql(db, migration.sql);
      recordApplied.run(migration.id, Date.now());
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}

function applyMigrationSql(db: DatabaseSync, sql: string) {
  for (const statement of sql
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)) {
    try {
      db.exec(`${statement};`);
    } catch (error) {
      if (error instanceof Error && /duplicate column name/i.test(error.message)) {
        continue;
      }
      throw error;
    }
  }
}
