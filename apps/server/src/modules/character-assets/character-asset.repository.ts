import type {
  CharacterAssetDetail,
  CharacterAssetSnapshot,
  CharacterAssetSummary,
  PublishedRuntimeRecommendation,
} from "@echoo/shared";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import {
  execute,
  queryOne,
  queryRows,
  withTransaction,
} from "../../infra/database/mysql.js";
import { createId } from "../../shared/utils/id.js";

interface AssetRow extends RowDataPacket {
  id: string;
  author_user_id: string;
  display_name: string;
  status: "published" | "unlisted";
  latest_version_id: string;
  version_number: number;
  snapshot: unknown;
  recommended_runtime_config: unknown;
  version_created_at: number;
  like_count: number;
  comment_count: number;
  viewer_has_liked: number;
  installed_version_id: string | null;
  installed_version_number: number | null;
  installation_id: string | null;
  published_at: number;
  updated_at: number;
}

interface VersionRow extends RowDataPacket {
  id: string;
  asset_id: string;
  version_number: number;
  snapshot: unknown;
  recommended_runtime_config: unknown;
  created_at: number;
}

export interface AssetResourceReference {
  resourceId: string;
  usageKind: string;
}

export class CharacterAssetRepository {
  async publish(input: {
    authorUserId: string;
    sourceAgentId: string;
    snapshot: CharacterAssetSnapshot;
    recommendedRuntimeConfig: PublishedRuntimeRecommendation | null;
    resources: AssetResourceReference[];
  }) {
    return withTransaction(async (connection) => {
      const existing = await queryOne<RowDataPacket & { id: string }>(
        `SELECT id FROM character_assets
         WHERE author_user_id = ? AND source_agent_id = ? FOR UPDATE`,
        [input.authorUserId, input.sourceAgentId],
        connection,
      );
      const assetId = existing?.id ?? createId("asset");
      const versionId = createId("aver");
      const latest = existing
        ? await queryOne<RowDataPacket & { latest_number: number | null }>(
            `SELECT MAX(version_number) AS latest_number
             FROM character_asset_versions WHERE asset_id = ?`,
            [assetId],
            connection,
          )
        : null;
      const versionNumber = (latest?.latest_number ?? 0) + 1;
      const now = Date.now();
      if (!existing) {
        await execute(
          `INSERT INTO social_objects
           (id, object_type, like_count, comment_count, created_at, updated_at)
           VALUES (?, 'character_asset', 0, 0, ?, ?)`,
          [assetId, now, now],
          connection,
        );
        await execute(
          `INSERT INTO character_assets
           (id, author_user_id, source_agent_id, status, latest_version_id,
            published_at, unlisted_at, created_at, updated_at)
           VALUES (?, ?, ?, 'published', NULL, ?, NULL, ?, ?)`,
          [assetId, input.authorUserId, input.sourceAgentId, now, now, now],
          connection,
        );
      }
      await execute(
        `INSERT INTO character_asset_versions
         (id, asset_id, version_number, snapshot, recommended_runtime_config, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          versionId,
          assetId,
          versionNumber,
          JSON.stringify(input.snapshot),
          input.recommendedRuntimeConfig
            ? JSON.stringify(input.recommendedRuntimeConfig)
            : null,
          now,
        ],
        connection,
      );
      for (const resource of input.resources)
        await execute(
          `INSERT INTO character_asset_version_resources
           (version_id, resource_id, usage_kind, created_at)
           VALUES (?, ?, ?, ?)`,
          [versionId, resource.resourceId, resource.usageKind, now],
          connection,
        );
      await execute(
        `UPDATE character_assets
         SET status = 'published', latest_version_id = ?, published_at = ?,
             unlisted_at = NULL, updated_at = ? WHERE id = ?`,
        [versionId, now, now, assetId],
        connection,
      );
      await execute(
        "UPDATE social_objects SET updated_at = ? WHERE id = ?",
        [now, assetId],
        connection,
      );
      return { assetId, versionId, versionNumber };
    });
  }

  async listPublished(viewerUserId: string, limit = 50) {
    const rows = await queryRows<AssetRow>(
      `${ASSET_SELECT}
       WHERE assets.status = 'published'
       ORDER BY assets.published_at DESC LIMIT ?`,
      [viewerUserId, viewerUserId, Math.min(Math.max(limit, 1), 100)],
    );
    return rows.map(rowToSummary);
  }

  async findVisible(viewerUserId: string, assetId: string) {
    const row = await queryOne<AssetRow>(
      `${ASSET_SELECT}
       WHERE assets.id = ? AND (
         assets.status = 'published' OR assets.author_user_id = ? OR
         EXISTS (SELECT 1 FROM character_asset_installations visible_install
                 WHERE visible_install.asset_id = assets.id
                   AND visible_install.owner_user_id = ?)
       )`,
      [viewerUserId, viewerUserId, assetId, viewerUserId, viewerUserId],
    );
    return row ? rowToDetail(row) : null;
  }

  async findBySourceAgent(ownerUserId: string, agentId: string) {
    const row = await queryOne<RowDataPacket & { id: string }>(
      `SELECT id FROM character_assets
       WHERE author_user_id = ? AND source_agent_id = ?`,
      [ownerUserId, agentId],
    );
    return row?.id ?? null;
  }

  async unlist(ownerUserId: string, assetId: string) {
    const now = Date.now();
    const result = await execute(
      `UPDATE character_assets SET status = 'unlisted', unlisted_at = ?, updated_at = ?
       WHERE id = ? AND author_user_id = ? AND status = 'published'`,
      [now, now, assetId, ownerUserId],
    );
    return result.affectedRows > 0;
  }

  async findVersion(assetId: string, versionId: string) {
    const row = await queryOne<VersionRow>(
      `SELECT * FROM character_asset_versions WHERE asset_id = ? AND id = ?`,
      [assetId, versionId],
    );
    return row ? rowToVersion(row) : null;
  }

  async findInstallation(ownerUserId: string, assetId: string) {
    return queryOne<
      RowDataPacket & { id: string; agent_id: string; version_id: string }
    >(
      `SELECT id, agent_id, version_id FROM character_asset_installations
       WHERE owner_user_id = ? AND asset_id = ?`,
      [ownerUserId, assetId],
    );
  }

  async createInstallation(input: {
    ownerUserId: string;
    assetId: string;
    versionId: string;
    snapshot: CharacterAssetSnapshot;
  }) {
    return withTransaction(async (connection) => {
      const existing = await queryOne<
        RowDataPacket & { id: string; agent_id: string; version_id: string }
      >(
        `SELECT id, agent_id, version_id FROM character_asset_installations
         WHERE owner_user_id = ? AND asset_id = ? FOR UPDATE`,
        [input.ownerUserId, input.assetId],
        connection,
      );
      if (existing) return { ...existing, created: false };
      const asset = await queryOne<RowDataPacket & { status: string }>(
        "SELECT status FROM character_assets WHERE id = ? FOR UPDATE",
        [input.assetId],
        connection,
      );
      if (!asset || asset.status !== "published") return null;
      const agentId = createId("agent");
      const conversationId = createId("conv");
      const installationId = createId("inst");
      const now = Date.now();
      await insertSnapshotAgent(
        connection,
        input.ownerUserId,
        agentId,
        conversationId,
        input.snapshot,
        now,
      );
      await execute(
        `INSERT INTO character_asset_installations
         (id, owner_user_id, asset_id, version_id, agent_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          installationId,
          input.ownerUserId,
          input.assetId,
          input.versionId,
          agentId,
          now,
          now,
        ],
        connection,
      );
      await copyVersionResourceReferences(
        connection,
        input.versionId,
        agentId,
        now,
      );
      return {
        id: installationId,
        agent_id: agentId,
        version_id: input.versionId,
        created: true,
      };
    });
  }

  async updateInstallationToLatest(input: {
    ownerUserId: string;
    installationId: string;
    assetId: string;
    latestVersionId: string;
    snapshot: CharacterAssetSnapshot;
  }) {
    return withTransaction(async (connection) => {
      const installation = await queryOne<
        RowDataPacket & { agent_id: string; version_id: string }
      >(
        `SELECT agent_id, version_id FROM character_asset_installations
         WHERE id = ? AND owner_user_id = ? AND asset_id = ? FOR UPDATE`,
        [input.installationId, input.ownerUserId, input.assetId],
        connection,
      );
      if (!installation) return null;
      if (installation.version_id === input.latestVersionId)
        return installation.agent_id;
      const conversation = await queryOne<
        RowDataPacket & { id: string; runtime_state: unknown }
      >(
        `SELECT id, runtime_state FROM conversations
         WHERE agent_id = ? AND owner_user_id = ? FOR UPDATE`,
        [installation.agent_id, input.ownerUserId],
        connection,
      );
      if (!conversation) return null;
      const now = Date.now();
      const state = reconcileRuntimeState(
        parseJson<Record<string, unknown>>(conversation.runtime_state, {}),
        input.snapshot,
        now,
      );
      await execute(
        "UPDATE agents SET type = ?, name = ?, definition = ?, updated_at = ? WHERE id = ?",
        [
          input.snapshot.type,
          input.snapshot.name,
          JSON.stringify(snapshotToDefinition(input.snapshot)),
          now,
          installation.agent_id,
        ],
        connection,
      );
      await execute(
        `UPDATE conversations SET type = ?, title = ?, runtime_state = ?, updated_at = ?
         WHERE id = ?`,
        [
          input.snapshot.type,
          input.snapshot.name,
          JSON.stringify(state),
          now,
          conversation.id,
        ],
        connection,
      );
      await execute(
        `UPDATE character_asset_installations SET version_id = ?, updated_at = ?
         WHERE id = ?`,
        [input.latestVersionId, now, input.installationId],
        connection,
      );
      await execute(
        "DELETE FROM agent_resources WHERE agent_id = ?",
        [installation.agent_id],
        connection,
      );
      await copyVersionResourceReferences(
        connection,
        input.latestVersionId,
        installation.agent_id,
        now,
      );
      return installation.agent_id;
    });
  }
}

const ASSET_SELECT = `SELECT assets.id, assets.author_user_id,
  users.display_name, assets.status, assets.latest_version_id,
  versions.version_number, versions.snapshot, versions.recommended_runtime_config,
  versions.created_at AS version_created_at, social.like_count,
  social.comment_count,
  EXISTS(SELECT 1 FROM social_likes likes
         WHERE likes.object_id = assets.id AND likes.user_id = ?) AS viewer_has_liked,
  installations.version_id AS installed_version_id,
  installations.id AS installation_id,
  installed_versions.version_number AS installed_version_number,
  assets.published_at, assets.updated_at
 FROM character_assets assets
 JOIN users ON users.id = assets.author_user_id
 JOIN social_objects social ON social.id = assets.id
 JOIN character_asset_versions versions ON versions.id = assets.latest_version_id
 LEFT JOIN character_asset_installations installations
   ON installations.asset_id = assets.id AND installations.owner_user_id = ?
 LEFT JOIN character_asset_versions installed_versions
   ON installed_versions.id = installations.version_id`;

function rowToSummary(row: AssetRow): CharacterAssetSummary {
  return {
    id: row.id,
    author: { id: row.author_user_id, displayName: row.display_name },
    status: row.status,
    latestVersionId: row.latest_version_id,
    latestVersionNumber: row.version_number,
    snapshot: parseJson<CharacterAssetSnapshot>(row.snapshot, null as never),
    hasRecommendedRuntimeConfig: Boolean(row.recommended_runtime_config),
    likeCount: row.like_count,
    commentCount: row.comment_count,
    viewerHasLiked: Boolean(row.viewer_has_liked),
    ...(row.installed_version_id
      ? {
          installedVersionId: row.installed_version_id,
          installedVersionNumber: row.installed_version_number ?? undefined,
          installationId: row.installation_id ?? undefined,
        }
      : {}),
    updateAvailable: Boolean(
      row.installed_version_id &&
      row.installed_version_id !== row.latest_version_id,
    ),
    publishedAt: row.published_at,
    updatedAt: row.updated_at,
  };
}

function rowToDetail(row: AssetRow): CharacterAssetDetail {
  const summary = rowToSummary(row);
  return {
    ...summary,
    latestVersion: {
      id: row.latest_version_id,
      assetId: row.id,
      versionNumber: row.version_number,
      snapshot: summary.snapshot,
      ...(row.recommended_runtime_config
        ? {
            recommendedRuntimeConfig: parseJson<PublishedRuntimeRecommendation>(
              row.recommended_runtime_config,
              null as never,
            ),
          }
        : {}),
      createdAt: row.version_created_at,
    },
  };
}

function rowToVersion(row: VersionRow) {
  return {
    id: row.id,
    assetId: row.asset_id,
    versionNumber: row.version_number,
    snapshot: parseJson<CharacterAssetSnapshot>(row.snapshot, null as never),
    recommendedRuntimeConfig: row.recommended_runtime_config
      ? parseJson<PublishedRuntimeRecommendation>(
          row.recommended_runtime_config,
          null as never,
        )
      : null,
    createdAt: row.created_at,
  };
}

async function insertSnapshotAgent(
  connection: PoolConnection,
  ownerUserId: string,
  agentId: string,
  conversationId: string,
  snapshot: CharacterAssetSnapshot,
  now: number,
) {
  await execute(
    `INSERT INTO agents
     (id, owner_user_id, type, name, definition, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      agentId,
      ownerUserId,
      snapshot.type,
      snapshot.name,
      JSON.stringify(snapshotToDefinition(snapshot)),
      now,
      now,
    ],
    connection,
  );
  await execute(
    `INSERT INTO conversations
     (id, owner_user_id, agent_id, type, title, last_message_preview,
      unread_count, pinned_at, runtime_state, next_run_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?, NULL, ?, ?)`,
    [
      conversationId,
      ownerUserId,
      agentId,
      snapshot.type,
      snapshot.name,
      snapshot.introduction || snapshot.detail.persona,
      JSON.stringify(initialRuntimeState(snapshot, now)),
      now,
      now,
    ],
    connection,
  );
}

function snapshotToDefinition(snapshot: CharacterAssetSnapshot) {
  return {
    type: snapshot.type,
    name: snapshot.name,
    attributes: snapshot.attributes,
    tags: snapshot.tags,
    introduction: snapshot.introduction,
    isPublic: false,
    ...(snapshot.avatarResourcePath
      ? { avatarResourcePath: snapshot.avatarResourcePath }
      : {}),
    ...(snapshot.coverResourcePath
      ? { coverResourcePath: snapshot.coverResourcePath }
      : {}),
    detail: snapshot.detail,
  };
}

function initialRuntimeState(snapshot: CharacterAssetSnapshot, now: number) {
  if (snapshot.type !== "prime-figure") return {};
  return {
    variables: Object.fromEntries(
      snapshot.detail.variableDefinitions.flatMap((definition) =>
        definition.defaultValue === undefined
          ? []
          : [[definition.key, definition.defaultValue]],
      ),
    ),
    memories: [],
    currentSituation: snapshot.detail.currentSituation,
    schedule: snapshot.detail.schedule,
    itinerary: snapshot.detail.itinerary,
    mood: snapshot.detail.initialMood,
    moodObservedAtMs: now,
    relationshipStatus: snapshot.detail.initialRelationshipStatus,
    updatedAt: now,
  };
}

function reconcileRuntimeState(
  current: Record<string, unknown>,
  snapshot: CharacterAssetSnapshot,
  now: number,
) {
  if (snapshot.type !== "prime-figure") return current;
  const previousVariables =
    current.variables && typeof current.variables === "object"
      ? (current.variables as Record<string, unknown>)
      : {};
  const variables = Object.fromEntries(
    snapshot.detail.variableDefinitions.flatMap((definition) => {
      const previous = previousVariables[definition.key];
      return [
        [
          definition.key,
          variableMatches(definition.type, previous)
            ? previous
            : (definition.defaultValue ?? null),
        ],
      ];
    }),
  );
  return { ...current, variables, updatedAt: now };
}

function variableMatches(type: string, value: unknown) {
  return (
    (type === "string" && typeof value === "string") ||
    (type === "number" &&
      typeof value === "number" &&
      Number.isFinite(value)) ||
    (type === "boolean" && typeof value === "boolean") ||
    (type === "json" && value !== undefined && typeof value === "object")
  );
}

async function copyVersionResourceReferences(
  connection: PoolConnection,
  versionId: string,
  agentId: string,
  now: number,
) {
  await execute(
    `INSERT INTO agent_resources (agent_id, resource_id, usage_kind, created_at)
     SELECT ?, resource_id, usage_kind, ?
     FROM character_asset_version_resources WHERE version_id = ?`,
    [agentId, now, versionId],
    connection,
  );
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value && typeof value === "object") return value as T;
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
