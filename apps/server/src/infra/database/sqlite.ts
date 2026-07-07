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
      db.exec(migration.sql);
      recordApplied.run(migration.id, Date.now());
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}
