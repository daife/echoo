import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const schemaSql = `
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

  CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    owner_user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('prime-figure', 'slice-figure', 'prime-world')),
    avatar_resource_path TEXT,
    cover_resource_path TEXT,
    name TEXT NOT NULL,
    attributes_json TEXT NOT NULL DEFAULT '[]',
    tags_json TEXT NOT NULL DEFAULT '[]',
    introduction TEXT NOT NULL DEFAULT '',
    is_public INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS agent_slice_figures (
    agent_id TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
    prologue_html TEXT NOT NULL DEFAULT '',
    current_situation TEXT NOT NULL DEFAULT '',
    opening_line TEXT NOT NULL DEFAULT '',
    linked_agent_ids_json TEXT NOT NULL DEFAULT '[]',
    unlock_conditions_json TEXT,
    persona TEXT NOT NULL,
    background TEXT NOT NULL,
    personality TEXT NOT NULL,
    response_style TEXT NOT NULL,
    system_prompt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS agent_prime_figures (
    agent_id TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'active',
    prologue_html TEXT NOT NULL DEFAULT '',
    linked_agent_ids_json TEXT NOT NULL DEFAULT '[]',
    unlock_conditions_json TEXT,
    persona TEXT NOT NULL,
    background TEXT NOT NULL,
    personality TEXT NOT NULL,
    response_style TEXT NOT NULL,
    decision_style TEXT NOT NULL DEFAULT '',
    current_situation TEXT NOT NULL DEFAULT '',
    schedule_json TEXT NOT NULL DEFAULT '{}',
    itinerary_json TEXT NOT NULL DEFAULT '""',
    variable_definitions_json TEXT NOT NULL DEFAULT '[]'
  );

  CREATE TABLE IF NOT EXISTS agent_prime_worlds (
    agent_id TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'placeholder'
  );

  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    owner_user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('direct', 'group', 'slice-figure', 'prime-figure', 'prime-world')),
    agent_id TEXT REFERENCES agents(id) ON DELETE CASCADE,
    external_binding_id TEXT,
    last_message_preview TEXT,
    unread_count INTEGER NOT NULL DEFAULT 0,
    pinned_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

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

  CREATE TABLE IF NOT EXISTS prime_figure_states (
    agent_id TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
    owner_user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
    variables_json TEXT NOT NULL DEFAULT '{}',
    memories_json TEXT NOT NULL DEFAULT '[]',
    mood TEXT NOT NULL DEFAULT '',
    mood_observed_at_ms INTEGER NOT NULL,
    relationship_status TEXT NOT NULL DEFAULT '',
    silence_started_at_ms INTEGER,
    silence_until_ms INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS prime_messages (
    id TEXT PRIMARY KEY,
    owner_user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender TEXT NOT NULL CHECK (sender IN ('prime_figure', 'end_user', 'system')),
    direction TEXT NOT NULL CHECK (direction IN ('incoming', 'outgoing', 'internal')),
    message_type TEXT NOT NULL CHECK (message_type IN ('text', 'image', 'video', 'voice', 'sticker', 'transfer')),
    content_json TEXT NOT NULL,
    occurred_at_ms INTEGER NOT NULL,
    occurred_at_iso TEXT NOT NULL,
    timezone TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS prime_action_logs (
    id TEXT PRIMARY KEY,
    owner_user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    action_type TEXT NOT NULL,
    action_json TEXT NOT NULL,
    rationale TEXT,
    status TEXT NOT NULL CHECK (status IN ('applied', 'failed')),
    error_message TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id ON password_reset_tokens(user_id);
  CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_user_id ON email_verification_tokens(user_id);
  CREATE INDEX IF NOT EXISTS idx_resources_owner_user_id ON resources(owner_user_id);
  CREATE INDEX IF NOT EXISTS idx_agents_owner_user_id ON agents(owner_user_id);
  CREATE INDEX IF NOT EXISTS idx_conversations_owner_user_id ON conversations(owner_user_id);
  CREATE INDEX IF NOT EXISTS idx_conversations_agent_id ON conversations(agent_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_owner_client_message_id
    ON messages(owner_user_id, client_message_id) WHERE client_message_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_messages_owner_created_at ON messages(owner_user_id, created_at, id);
  CREATE INDEX IF NOT EXISTS idx_messages_conversation_created_at ON messages(conversation_id, created_at, id);
  CREATE INDEX IF NOT EXISTS idx_messages_owner_conversation_created_at
    ON messages(owner_user_id, conversation_id, created_at, id);
  CREATE INDEX IF NOT EXISTS idx_prime_figure_states_owner_user_id ON prime_figure_states(owner_user_id);
  CREATE INDEX IF NOT EXISTS idx_prime_figure_states_silence_until
    ON prime_figure_states(silence_until_ms) WHERE silence_until_ms IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_prime_messages_agent_occurred_at ON prime_messages(agent_id, occurred_at_ms, id);
  CREATE INDEX IF NOT EXISTS idx_prime_messages_owner_conversation_occurred_at
    ON prime_messages(owner_user_id, conversation_id, occurred_at_ms, id);
  CREATE INDEX IF NOT EXISTS idx_prime_action_logs_agent_created_at ON prime_action_logs(agent_id, created_at, id);
`;

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
  database.exec(schemaSql);

  return database;
}

export function closeDatabase() {
  database?.close();
  database = null;
}
