CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(64) PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  display_name VARCHAR(120) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  email_verified_at BIGINT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS auth_tokens (
  token_hash CHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  kind ENUM('email_verification', 'password_reset') NOT NULL,
  expires_at BIGINT NOT NULL,
  used_at BIGINT NULL,
  created_at BIGINT NOT NULL,
  INDEX idx_auth_tokens_user_kind (user_id, kind, created_at),
  CONSTRAINT fk_auth_tokens_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS resources (
  id VARCHAR(64) PRIMARY KEY,
  owner_user_id VARCHAR(64) NOT NULL,
  kind VARCHAR(48) NOT NULL,
  mime_type VARCHAR(160) NOT NULL,
  original_file_name VARCHAR(255) NOT NULL,
  storage_path VARCHAR(1024) NOT NULL,
  public_path VARCHAR(1024) NOT NULL,
  created_at BIGINT NOT NULL,
  INDEX idx_resources_owner_created (owner_user_id, created_at),
  CONSTRAINT fk_resources_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS agents (
  id VARCHAR(64) PRIMARY KEY,
  owner_user_id VARCHAR(64) NOT NULL,
  type ENUM('slice-figure', 'prime-figure', 'prime-world') NOT NULL,
  name VARCHAR(160) NOT NULL,
  definition JSON NOT NULL,
  runtime_state JSON NOT NULL,
  is_public BOOLEAN NOT NULL DEFAULT FALSE,
  next_run_at BIGINT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  INDEX idx_agents_owner_created (owner_user_id, created_at DESC),
  INDEX idx_agents_due (type, next_run_at),
  CONSTRAINT fk_agents_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS conversations (
  id VARCHAR(64) PRIMARY KEY,
  owner_user_id VARCHAR(64) NOT NULL,
  agent_id VARCHAR(64) NULL,
  type ENUM('direct', 'group', 'slice-figure', 'prime-figure', 'prime-world') NOT NULL,
  title VARCHAR(160) NOT NULL,
  last_message_preview VARCHAR(500) NULL,
  unread_count INT UNSIGNED NOT NULL DEFAULT 0,
  pinned_at BIGINT NULL,
  runtime_state JSON NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  UNIQUE KEY uq_conversations_agent (agent_id),
  INDEX idx_conversations_owner_updated (owner_user_id, pinned_at DESC, updated_at DESC),
  CONSTRAINT fk_conversations_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_conversations_agent FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS user_runtime_configs (
  owner_user_id VARCHAR(64) PRIMARY KEY,
  config JSON NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  CONSTRAINT fk_user_runtime_configs_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS conversation_runtime_configs (
  conversation_id VARCHAR(64) PRIMARY KEY,
  owner_user_id VARCHAR(64) NOT NULL,
  mode ENUM('global', 'custom') NOT NULL DEFAULT 'global',
  custom_config JSON NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  INDEX idx_conversation_runtime_configs_owner (owner_user_id),
  CONSTRAINT fk_conversation_runtime_configs_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_conversation_runtime_configs_conversation FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS messages (
  seq BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  id VARCHAR(64) NOT NULL,
  owner_user_id VARCHAR(64) NOT NULL,
  conversation_id VARCHAR(64) NOT NULL,
  client_message_id VARCHAR(96) NULL,
  role ENUM('user', 'assistant', 'system') NOT NULL,
  content_type ENUM('text', 'image', 'file', 'voice', 'video', 'system') NOT NULL,
  content JSON NOT NULL,
  status ENUM('pending', 'sent', 'delivered', 'failed', 'read') NOT NULL,
  run_metadata JSON NULL,
  search_text TEXT GENERATED ALWAYS AS (
    COALESCE(JSON_UNQUOTE(JSON_EXTRACT(content, '$.text')), '')
  ) STORED,
  read_at BIGINT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (seq),
  UNIQUE KEY uq_messages_id (id),
  UNIQUE KEY uq_messages_owner_client (owner_user_id, client_message_id),
  INDEX idx_messages_conversation_seq (conversation_id, seq),
  INDEX idx_messages_owner_seq (owner_user_id, seq),
  INDEX idx_messages_conversation_created (conversation_id, created_at, seq),
  FULLTEXT INDEX ftx_messages_content (search_text),
  CONSTRAINT fk_messages_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_messages_conversation FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
