CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(64) PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  display_name VARCHAR(120) NOT NULL,
  signature VARCHAR(160) NOT NULL DEFAULT '',
  password_hash VARCHAR(255) NOT NULL,
  email_verified_at BIGINT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  FULLTEXT INDEX ftx_users_display_name (display_name) WITH PARSER ngram
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

CREATE TABLE IF NOT EXISTS auth_sessions (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  refresh_token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at BIGINT NOT NULL,
  revoked_at BIGINT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  INDEX idx_auth_sessions_user_active (user_id, revoked_at, expires_at),
  CONSTRAINT fk_auth_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS resources (
  id VARCHAR(64) PRIMARY KEY,
  owner_user_id VARCHAR(64) NOT NULL,
  kind VARCHAR(48) NOT NULL,
  mime_type VARCHAR(160) NOT NULL,
  original_file_name VARCHAR(255) NOT NULL,
  storage_provider ENUM('local', 's3') NOT NULL DEFAULT 'local',
  storage_key VARCHAR(1024) NOT NULL,
  public_path VARCHAR(1024) NOT NULL,
  byte_size BIGINT UNSIGNED NULL,
  sha256 CHAR(64) NULL,
  duration_ms INT UNSIGNED NULL,
  status ENUM('pending', 'processing', 'ready', 'failed', 'deleting') NOT NULL DEFAULT 'ready',
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  INDEX idx_resources_owner_created (owner_user_id, created_at),
  INDEX idx_resources_owner_status_created (owner_user_id, status, created_at),
  CONSTRAINT fk_resources_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS resource_variants (
  resource_id VARCHAR(64) NOT NULL,
  variant ENUM('original', 'thumb', 'display') NOT NULL,
  storage_provider ENUM('local', 's3') NOT NULL,
  storage_key VARCHAR(1024) NOT NULL,
  mime_type VARCHAR(160) NOT NULL,
  byte_size BIGINT UNSIGNED NOT NULL,
  etag VARCHAR(255) NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (resource_id, variant),
  CONSTRAINT fk_resource_variants_resource FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS user_resources (
  user_id VARCHAR(64) NOT NULL,
  usage_kind VARCHAR(48) NOT NULL,
  resource_id VARCHAR(64) NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, usage_kind),
  INDEX idx_user_resources_resource (resource_id),
  CONSTRAINT fk_user_resources_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_user_resources_resource FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS agents (
  id VARCHAR(64) PRIMARY KEY,
  owner_user_id VARCHAR(64) NOT NULL,
  type ENUM('slice-figure', 'prime-figure', 'prime-world') NOT NULL,
  name VARCHAR(160) NOT NULL,
  definition JSON NOT NULL,
  source_public_asset_id VARCHAR(64) NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  INDEX idx_agents_owner_created (owner_user_id, created_at DESC),
  CONSTRAINT fk_agents_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS agent_resources (
  agent_id VARCHAR(64) NOT NULL,
  resource_id VARCHAR(64) NOT NULL,
  usage_kind VARCHAR(48) NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (agent_id, resource_id, usage_kind),
  INDEX idx_agent_resources_resource (resource_id),
  CONSTRAINT fk_agent_resources_agent FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
  CONSTRAINT fk_agent_resources_resource FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE RESTRICT
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
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  UNIQUE KEY uq_conversations_agent (agent_id),
  INDEX idx_conversations_owner_updated (owner_user_id, pinned_at DESC, updated_at DESC),
  CONSTRAINT fk_conversations_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_conversations_agent FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS external_interface_accounts (
  id VARCHAR(64) PRIMARY KEY,
  owner_user_id VARCHAR(64) NOT NULL,
  interface_type ENUM('wechat') NOT NULL,
  account_id VARCHAR(160) NOT NULL,
  base_url VARCHAR(512) NOT NULL,
  bot_token_ciphertext TEXT NOT NULL,
  external_user_id VARCHAR(160) NULL,
  sync_buf TEXT NULL,
  status ENUM('pending', 'connected', 'paused', 'error') NOT NULL DEFAULT 'pending',
  lease_until BIGINT NULL,
  last_error TEXT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  UNIQUE KEY uq_external_account_owner_type (owner_user_id, interface_type),
  UNIQUE KEY uq_external_account_account (interface_type, account_id),
  CONSTRAINT fk_external_account_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS external_interface_bindings (
  id VARCHAR(64) PRIMARY KEY,
  owner_user_id VARCHAR(64) NOT NULL,
  interface_type ENUM('wechat') NOT NULL,
  account_id VARCHAR(64) NOT NULL,
  conversation_id VARCHAR(64) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  bound_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  UNIQUE KEY uq_external_binding_owner_type (owner_user_id, interface_type),
  UNIQUE KEY uq_external_binding_conversation_type (conversation_id, interface_type),
  CONSTRAINT fk_external_binding_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_external_binding_account FOREIGN KEY (account_id) REFERENCES external_interface_accounts(id) ON DELETE CASCADE,
  CONSTRAINT fk_external_binding_conversation FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS agent_runtime_states (
  agent_id VARCHAR(64) PRIMARY KEY,
  owner_user_id VARCHAR(64) NOT NULL,
  conversation_id VARCHAR(64) NOT NULL UNIQUE,
  state_json JSON NOT NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_at BIGINT NOT NULL,
  INDEX idx_agent_runtime_owner (owner_user_id, updated_at),
  CONSTRAINT fk_agent_runtime_agent FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
  CONSTRAINT fk_agent_runtime_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_agent_runtime_conversation FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS prime_memories (
  id VARCHAR(64) PRIMARY KEY,
  agent_id VARCHAR(64) NOT NULL,
  owner_user_id VARCHAR(64) NOT NULL,
  content TEXT NOT NULL,
  event_at BIGINT NOT NULL,
  recorded_at BIGINT NOT NULL,
  INDEX idx_prime_memories_agent_event (agent_id, event_at, recorded_at),
  CONSTRAINT fk_prime_memories_agent FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
  CONSTRAINT fk_prime_memories_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS scheduled_runs (
  id VARCHAR(160) PRIMARY KEY,
  owner_user_id VARCHAR(64) NOT NULL,
  conversation_id VARCHAR(64) NOT NULL,
  kind ENUM('proactive', 'passive', 'mute_ended') NOT NULL,
  due_at BIGINT NOT NULL,
  lease_until BIGINT NULL,
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  token VARCHAR(128) NULL,
  payload_json JSON NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  UNIQUE KEY uq_scheduled_runs_conversation_kind (conversation_id, kind),
  INDEX idx_scheduled_runs_due (due_at, lease_until),
  CONSTRAINT fk_scheduled_runs_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_scheduled_runs_conversation FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS conversation_media (
  conversation_id VARCHAR(64) NOT NULL,
  owner_user_id VARCHAR(64) NOT NULL,
  media_index INT UNSIGNED NOT NULL,
  media_id VARCHAR(64) NOT NULL,
  media_type ENUM('image', 'video', 'voice') NOT NULL,
  resource_id VARCHAR(64) NOT NULL,
  description TEXT NULL,
  source ENUM('message', 'figure_cover', 'figure_reference', 'generated') NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (conversation_id, media_id),
  UNIQUE KEY uq_conversation_media_resource (conversation_id, resource_id),
  UNIQUE KEY uq_conversation_media_index (conversation_id, media_index),
  INDEX idx_conversation_media_owner (owner_user_id, conversation_id),
  CONSTRAINT fk_conversation_media_conversation FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  CONSTRAINT fk_conversation_media_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_conversation_media_resource FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS social_objects (
  id VARCHAR(64) PRIMARY KEY,
  object_type VARCHAR(48) NOT NULL,
  like_count INT UNSIGNED NOT NULL DEFAULT 0,
  comment_count INT UNSIGNED NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  INDEX idx_social_objects_type_created (object_type, created_at DESC),
  INDEX idx_social_objects_type_likes (object_type, like_count DESC, id DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS user_follows (
  follower_user_id VARCHAR(64) NOT NULL,
  followed_user_id VARCHAR(64) NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (follower_user_id, followed_user_id),
  INDEX idx_user_follows_followed_created (followed_user_id, created_at DESC),
  INDEX idx_user_follows_follower_created (follower_user_id, created_at DESC),
  CONSTRAINT fk_user_follows_follower FOREIGN KEY (follower_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_user_follows_followed FOREIGN KEY (followed_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT chk_user_follows_not_self CHECK (follower_user_id <> followed_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS social_posts (
  id VARCHAR(64) PRIMARY KEY,
  author_user_id VARCHAR(64) NOT NULL,
  body TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  INDEX idx_social_posts_author_created (author_user_id, created_at DESC, id DESC),
  INDEX idx_social_posts_created (created_at DESC, id DESC),
  CONSTRAINT fk_social_posts_social FOREIGN KEY (id) REFERENCES social_objects(id) ON DELETE CASCADE,
  CONSTRAINT fk_social_posts_author FOREIGN KEY (author_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS social_post_resources (
  post_id VARCHAR(64) NOT NULL,
  resource_id VARCHAR(64) NOT NULL,
  position TINYINT UNSIGNED NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (post_id, resource_id),
  UNIQUE KEY uq_social_post_position (post_id, position),
  INDEX idx_social_post_resources_resource (resource_id),
  CONSTRAINT fk_social_post_resources_post FOREIGN KEY (post_id) REFERENCES social_posts(id) ON DELETE CASCADE,
  CONSTRAINT fk_social_post_resources_resource FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS character_assets (
  id VARCHAR(64) PRIMARY KEY,
  author_user_id VARCHAR(64) NOT NULL,
  status ENUM('draft', 'published', 'unlisted') NOT NULL DEFAULT 'draft',
  latest_version_id VARCHAR(64) NULL,
  draft_snapshot JSON NULL,
  draft_recommended_runtime_config JSON NULL,
  draft_dirty BOOLEAN NOT NULL DEFAULT FALSE,
  published_at BIGINT NOT NULL,
  unlisted_at BIGINT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  INDEX idx_character_assets_author_updated (author_user_id, updated_at DESC),
  INDEX idx_character_assets_status_published (status, published_at DESC),
  CONSTRAINT fk_character_assets_social FOREIGN KEY (id) REFERENCES social_objects(id) ON DELETE CASCADE,
  CONSTRAINT fk_character_assets_author FOREIGN KEY (author_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS character_asset_versions (
  id VARCHAR(64) PRIMARY KEY,
  asset_id VARCHAR(64) NOT NULL,
  version_number INT UNSIGNED NOT NULL,
  snapshot JSON NOT NULL,
  search_text TEXT GENERATED ALWAYS AS (
    CONCAT_WS(' ',
      COALESCE(JSON_UNQUOTE(JSON_EXTRACT(snapshot, '$.name')), ''),
      COALESCE(JSON_UNQUOTE(JSON_EXTRACT(snapshot, '$.tags')), '')
    )
  ) STORED,
  recommended_runtime_config JSON NULL,
  created_at BIGINT NOT NULL,
  UNIQUE KEY uq_character_asset_version (asset_id, version_number),
  INDEX idx_character_asset_versions_asset_created (asset_id, created_at DESC),
  FULLTEXT INDEX ftx_character_asset_versions_search (search_text) WITH PARSER ngram,
  CONSTRAINT fk_character_asset_versions_asset FOREIGN KEY (asset_id) REFERENCES character_assets(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS character_asset_version_resources (
  version_id VARCHAR(64) NOT NULL,
  resource_id VARCHAR(64) NOT NULL,
  usage_kind VARCHAR(48) NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (version_id, resource_id, usage_kind),
  INDEX idx_character_asset_version_resources_resource (resource_id),
  CONSTRAINT fk_character_asset_version_resources_version FOREIGN KEY (version_id) REFERENCES character_asset_versions(id) ON DELETE CASCADE,
  CONSTRAINT fk_character_asset_version_resources_resource FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS character_asset_draft_resources (
  asset_id VARCHAR(64) NOT NULL,
  resource_id VARCHAR(64) NOT NULL,
  usage_kind VARCHAR(48) NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (asset_id, resource_id, usage_kind),
  INDEX idx_character_asset_draft_resources_resource (resource_id),
  CONSTRAINT fk_character_asset_draft_resources_asset FOREIGN KEY (asset_id) REFERENCES character_assets(id) ON DELETE CASCADE,
  CONSTRAINT fk_character_asset_draft_resources_resource FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS character_asset_installations (
  id VARCHAR(64) PRIMARY KEY,
  owner_user_id VARCHAR(64) NOT NULL,
  asset_id VARCHAR(64) NOT NULL,
  version_id VARCHAR(64) NOT NULL,
  agent_id VARCHAR(64) NOT NULL UNIQUE,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  UNIQUE KEY uq_character_asset_installation_owner (owner_user_id, asset_id),
  INDEX idx_character_asset_installations_asset (asset_id),
  CONSTRAINT fk_character_asset_installations_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_character_asset_installations_asset FOREIGN KEY (asset_id) REFERENCES character_assets(id) ON DELETE RESTRICT,
  CONSTRAINT fk_character_asset_installations_version FOREIGN KEY (version_id) REFERENCES character_asset_versions(id) ON DELETE RESTRICT,
  CONSTRAINT fk_character_asset_installations_agent FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS social_likes (
  object_id VARCHAR(64) NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (object_id, user_id),
  INDEX idx_social_likes_user_created (user_id, created_at DESC),
  CONSTRAINT fk_social_likes_object FOREIGN KEY (object_id) REFERENCES social_objects(id) ON DELETE CASCADE,
  CONSTRAINT fk_social_likes_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS social_comments (
  id VARCHAR(64) PRIMARY KEY,
  object_id VARCHAR(64) NOT NULL,
  author_user_id VARCHAR(64) NOT NULL,
  parent_comment_id VARCHAR(64) NULL,
  body TEXT NOT NULL,
  status ENUM('visible', 'deleted', 'hidden') NOT NULL DEFAULT 'visible',
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  deleted_at BIGINT NULL,
  INDEX idx_social_comments_object_created (object_id, created_at DESC),
  INDEX idx_social_comments_parent_created (parent_comment_id, created_at ASC),
  CONSTRAINT fk_social_comments_object FOREIGN KEY (object_id) REFERENCES social_objects(id) ON DELETE CASCADE,
  CONSTRAINT fk_social_comments_author FOREIGN KEY (author_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_social_comments_parent FOREIGN KEY (parent_comment_id) REFERENCES social_comments(id) ON DELETE SET NULL
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

CREATE TABLE IF NOT EXISTS billing_accounts (
  owner_user_id VARCHAR(64) PRIMARY KEY,
  balance_micro_usd BIGINT NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  CONSTRAINT fk_billing_accounts_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS billing_ledger (
  id VARCHAR(64) PRIMARY KEY,
  owner_user_id VARCHAR(64) NOT NULL,
  kind VARCHAR(48) NOT NULL,
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS recharge_orders (
  out_trade_no VARCHAR(32) PRIMARY KEY,
  owner_user_id VARCHAR(64) NOT NULL,
  payment_type VARCHAR(16) NOT NULL,
  product_name VARCHAR(100) NOT NULL,
  credit_micro_usd BIGINT NOT NULL,
  usd_to_cny_rate_micro BIGINT NOT NULL,
  pay_amount_fen BIGINT NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  provider_trade_no VARCHAR(64) NULL,
  credited_ledger_id VARCHAR(64) NULL,
  last_provider_query_at BIGINT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  paid_at BIGINT NULL,
  UNIQUE KEY uq_recharge_provider_trade (provider_trade_no),
  UNIQUE KEY uq_recharge_ledger (credited_ledger_id),
  INDEX idx_recharge_owner_created (owner_user_id, created_at DESC),
  CONSTRAINT fk_recharge_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS invite_codes (
  owner_user_id VARCHAR(64) PRIMARY KEY,
  code VARCHAR(16) NOT NULL UNIQUE,
  created_at BIGINT NOT NULL,
  CONSTRAINT fk_invite_codes_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS invite_redemptions (
  invitee_user_id VARCHAR(64) PRIMARY KEY,
  inviter_user_id VARCHAR(64) NOT NULL,
  invite_code VARCHAR(16) NOT NULL,
  inviter_reward_micro_usd BIGINT NOT NULL,
  invitee_reward_micro_usd BIGINT NOT NULL,
  redeemed_at BIGINT NOT NULL,
  INDEX idx_invite_redemptions_inviter (inviter_user_id, redeemed_at DESC),
  CONSTRAINT fk_invite_redemptions_invitee FOREIGN KEY (invitee_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_invite_redemptions_inviter FOREIGN KEY (inviter_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS promotion_bindings (
  id VARCHAR(64) PRIMARY KEY,
  owner_user_id VARCHAR(64) NOT NULL,
  platform VARCHAR(32) NOT NULL,
  work_type VARCHAR(32) NOT NULL,
  external_content_id VARCHAR(160) NOT NULL,
  external_author_id VARCHAR(255) NULL,
  source_url VARCHAR(2048) NOT NULL,
  initial_like_count BIGINT UNSIGNED NOT NULL,
  initial_tags JSON NOT NULL,
  last_checked_like_count BIGINT UNSIGNED NULL,
  last_checked_tags JSON NULL,
  last_checked_at BIGINT NULL,
  quote_id VARCHAR(64) NULL,
  quote_like_count BIGINT UNSIGNED NULL,
  quote_reward_micro_usd BIGINT NULL,
  quote_config JSON NULL,
  quote_expires_at BIGINT NULL,
  settled_like_count BIGINT UNSIGNED NULL,
  settled_reward_micro_usd BIGINT NULL,
  settled_at BIGINT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  UNIQUE KEY uq_promotion_external_content (platform, external_content_id),
  INDEX idx_promotion_bindings_owner_created (owner_user_id, created_at DESC),
  CONSTRAINT fk_promotion_bindings_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS platform_models (
  model_id VARCHAR(255) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT NULL,
  input_modalities JSON NOT NULL,
  output_modalities JSON NOT NULL,
  pricing JSON NOT NULL,
  supported_parameters JSON NOT NULL,
  context_length INT UNSIGNED NULL,
  available BOOLEAN NOT NULL DEFAULT TRUE,
  synced_at BIGINT NOT NULL,
  INDEX idx_platform_models_available_name (available, name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS platform_model_endpoints (
  model_id VARCHAR(255) NOT NULL,
  provider_slug VARCHAR(160) NOT NULL,
  provider_name VARCHAR(255) NOT NULL,
  pricing JSON NOT NULL,
  status INT NOT NULL DEFAULT 0,
  latency_ms DOUBLE NULL,
  throughput DOUBLE NULL,
  synced_at BIGINT NOT NULL,
  PRIMARY KEY (model_id, provider_slug),
  CONSTRAINT fk_platform_model_endpoints_model FOREIGN KEY (model_id) REFERENCES platform_models(model_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS platform_recommendations (
  category VARCHAR(64) NOT NULL,
  model_id VARCHAR(255) NOT NULL,
  service ENUM('openrouter', 'fish_audio') NOT NULL DEFAULT 'openrouter',
  provider_slugs JSON NOT NULL,
  display_order INT UNSIGNED NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (category, model_id),
  INDEX idx_platform_recommendations_order (category, display_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS platform_settings (
  setting_key VARCHAR(80) PRIMARY KEY,
  value_json JSON NOT NULL,
  updated_at BIGINT NOT NULL
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

CREATE TABLE IF NOT EXISTS change_events (
  seq BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  owner_user_id VARCHAR(64) NOT NULL,
  entity_type ENUM('agent', 'message', 'resource', 'asset') NOT NULL,
  entity_id VARCHAR(96) NOT NULL,
  conversation_id VARCHAR(64) NULL,
  operation ENUM('upsert', 'delete') NOT NULL,
  published_at BIGINT NULL,
  created_at BIGINT NOT NULL,
  INDEX idx_change_events_owner_seq (owner_user_id, seq),
  INDEX idx_change_events_unpublished (published_at, seq),
  INDEX idx_change_events_created (created_at),
  CONSTRAINT fk_change_events_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS message_resources (
  message_id VARCHAR(64) NOT NULL,
  resource_id VARCHAR(64) NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (message_id, resource_id),
  INDEX idx_message_resources_resource (resource_id),
  CONSTRAINT fk_message_resources_message FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
  CONSTRAINT fk_message_resources_resource FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS external_delivery_tasks (
  id VARCHAR(64) PRIMARY KEY,
  binding_id VARCHAR(64) NOT NULL,
  message_id VARCHAR(64) NOT NULL,
  status ENUM('pending', 'sent', 'failed') NOT NULL DEFAULT 'pending',
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  external_message_id VARCHAR(160) NULL,
  failure_reason TEXT NULL,
  next_attempt_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  UNIQUE KEY uq_external_delivery_message (binding_id, message_id),
  INDEX idx_external_delivery_pending (status, next_attempt_at),
  CONSTRAINT fk_external_delivery_binding FOREIGN KEY (binding_id) REFERENCES external_interface_bindings(id) ON DELETE CASCADE,
  CONSTRAINT fk_external_delivery_message FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
