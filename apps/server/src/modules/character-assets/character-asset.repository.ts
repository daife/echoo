import type {
  CharacterAssetDraft,
  CharacterAssetDetail,
  CharacterAssetListItem,
  CharacterAssetPage,
  CharacterAssetSnapshot,
  CharacterAssetSummary,
  PublishedRuntimeRecommendation,
} from "@echoo/shared";
import { createHash } from "node:crypto";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import {
  execute,
  queryOne,
  queryRows,
  withTransaction,
} from "../../infra/database/mysql.js";
import { createId } from "../../shared/utils/id.js";
import { syncScheduledRuns } from "../agents/kinds/prime-figure/scheduled-run.repository.js";
import { ChangeEventRepository } from "../sync/change-event.repository.js";

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

interface DraftRow extends RowDataPacket {
  id: string;
  author_user_id: string;
  display_name: string;
  status: "draft" | "published" | "unlisted";
  latest_version_id: string | null;
  latest_version_number: number | null;
  draft_snapshot: unknown;
  draft_recommended_runtime_config: unknown | null;
  draft_dirty: number;
  created_at: number;
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
  constructor(private readonly events = new ChangeEventRepository()) {}

  async createDraft(input: {
    authorUserId: string;
    snapshot: CharacterAssetSnapshot;
    recommendedRuntimeConfig: PublishedRuntimeRecommendation | null;
    resources: AssetResourceReference[];
  }) {
    return withTransaction(async (connection) => {
      const assetId = createId("asset");
      const now = Date.now();
      await execute(
        `INSERT INTO social_objects
         (id, object_type, like_count, comment_count, created_at, updated_at)
         VALUES (?, 'character_asset', 0, 0, ?, ?)`,
        [assetId, now, now],
        connection,
      );
      await execute(
        `INSERT INTO character_assets
         (id, author_user_id, status, latest_version_id,
          draft_snapshot, draft_recommended_runtime_config, draft_dirty,
          published_at, unlisted_at, created_at, updated_at)
         VALUES (?, ?, 'draft', NULL, ?, ?, TRUE, ?, NULL, ?, ?)`,
        [
          assetId,
          input.authorUserId,
          JSON.stringify(input.snapshot),
          input.recommendedRuntimeConfig
            ? JSON.stringify(input.recommendedRuntimeConfig)
            : null,
          now,
          now,
          now,
        ],
        connection,
      );
      await replaceDraftResources(connection, assetId, input.resources, now);
      await this.events.append(
        {
          ownerUserId: input.authorUserId,
          entityType: "asset",
          entityId: assetId,
          operation: "upsert",
          createdAt: now,
        },
        connection,
      );
      return assetId;
    });
  }

  async findDraftForAuthor(ownerUserId: string, assetId: string) {
    const row = await queryOne<DraftRow>(
      `${DRAFT_SELECT} WHERE assets.id = ? AND assets.author_user_id = ?`,
      [assetId, ownerUserId],
    );
    return row ? rowToDraft(row) : null;
  }

  async listMine(ownerUserId: string) {
    const rows = await queryRows<DraftRow>(
      `${DRAFT_SELECT} WHERE assets.author_user_id = ?
       ORDER BY assets.updated_at DESC`,
      [ownerUserId],
    );
    return rows.map(rowToDraft);
  }

  async saveDraft(input: {
    ownerUserId: string;
    assetId: string;
    snapshot: CharacterAssetSnapshot;
    recommendedRuntimeConfig: PublishedRuntimeRecommendation | null;
    resources: AssetResourceReference[];
  }) {
    return withTransaction(async (connection) => {
      const now = Date.now();
      const result = await execute(
        `UPDATE character_assets
            SET draft_snapshot = ?, draft_recommended_runtime_config = ?,
                draft_dirty = TRUE, updated_at = ?
          WHERE id = ? AND author_user_id = ?`,
        [
          JSON.stringify(input.snapshot),
          input.recommendedRuntimeConfig
            ? JSON.stringify(input.recommendedRuntimeConfig)
            : null,
          now,
          input.assetId,
          input.ownerUserId,
        ],
        connection,
      );
      if (!result.affectedRows) return false;
      await replaceDraftResources(
        connection,
        input.assetId,
        input.resources,
        now,
      );
      await this.events.append(
        {
          ownerUserId: input.ownerUserId,
          entityType: "asset",
          entityId: input.assetId,
          operation: "upsert",
          createdAt: now,
        },
        connection,
      );
      return true;
    });
  }

  async publishDraft(ownerUserId: string, assetId: string) {
    return withTransaction(async (connection) => {
      const row = await queryOne<
        RowDataPacket & {
          status: "draft" | "published" | "unlisted";
          latest_version_id: string | null;
          draft_snapshot: unknown;
          draft_recommended_runtime_config: unknown | null;
          draft_dirty: number;
        }
      >(
        `SELECT status, latest_version_id, draft_snapshot,
                draft_recommended_runtime_config, draft_dirty
           FROM character_assets
          WHERE id = ? AND author_user_id = ? FOR UPDATE`,
        [assetId, ownerUserId],
        connection,
      );
      if (!row?.draft_snapshot) return null;
      const now = Date.now();
      if (row.status === "unlisted" && !row.draft_dirty) {
        await execute(
          `UPDATE character_assets SET status = 'published', unlisted_at = NULL,
                  published_at = ?, updated_at = ? WHERE id = ?`,
          [now, now, assetId],
          connection,
        );
        await this.appendAssetEvent(connection, ownerUserId, assetId, now);
        return { assetId, versionId: row.latest_version_id!, relisted: true };
      }
      if (row.status === "published" && !row.draft_dirty) return null;
      const latest = await queryOne<
        RowDataPacket & { latest_number: number | null }
      >(
        `SELECT MAX(version_number) AS latest_number
           FROM character_asset_versions WHERE asset_id = ?`,
        [assetId],
        connection,
      );
      const versionNumber = (latest?.latest_number ?? 0) + 1;
      const versionId = createId("aver");
      await execute(
        `INSERT INTO character_asset_versions
         (id, asset_id, version_number, snapshot, recommended_runtime_config, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          versionId,
          assetId,
          versionNumber,
          JSON.stringify(parseJson(row.draft_snapshot, {})),
          row.draft_recommended_runtime_config
            ? JSON.stringify(
                parseJson(row.draft_recommended_runtime_config, {}),
              )
            : null,
          now,
        ],
        connection,
      );
      await execute(
        `INSERT INTO character_asset_version_resources
         (version_id, resource_id, usage_kind, created_at)
         SELECT ?, resource_id, usage_kind, ?
           FROM character_asset_draft_resources WHERE asset_id = ?`,
        [versionId, now, assetId],
        connection,
      );
      await execute(
        `UPDATE character_assets
            SET status = 'published', latest_version_id = ?, draft_dirty = FALSE,
                published_at = ?, unlisted_at = NULL, updated_at = ?
          WHERE id = ?`,
        [versionId, now, now, assetId],
        connection,
      );
      await execute(
        "UPDATE social_objects SET updated_at = ? WHERE id = ?",
        [now, assetId],
        connection,
      );
      await this.appendAssetEvent(connection, ownerUserId, assetId, now);
      return { assetId, versionId, versionNumber, relisted: false };
    });
  }

  async listPublished(
    viewerUserId: string | null,
    input: {
      limit?: number;
      cursor?: string;
      query?: string;
    } = {},
  ): Promise<CharacterAssetPage> {
    const limit = Math.min(Math.max(input.limit ?? 12, 1), 24);
    const query = normalizeSearchQuery(input.query);
    const scope = `published:${query}`;
    const cursor = decodeAssetCursor(input.cursor, scope);
    const searchJoin = query
      ? `JOIN (
           SELECT search_assets.id
             FROM character_assets search_assets
             JOIN character_asset_versions search_versions
               ON search_versions.id = search_assets.latest_version_id
            WHERE search_assets.status = 'published'
              AND MATCH(search_versions.search_text)
                  AGAINST (? IN NATURAL LANGUAGE MODE)
           UNION
           SELECT search_assets.id
             FROM character_assets search_assets
             JOIN users search_users ON search_users.id = search_assets.author_user_id
            WHERE search_assets.status = 'published'
              AND MATCH(search_users.display_name)
                  AGAINST (? IN NATURAL LANGUAGE MODE)
         ) search_matches ON search_matches.id = assets.id`
      : "";
    const rows = await queryRows<AssetRow>(
      `${ASSET_SELECT}
       ${searchJoin}
       WHERE assets.status = 'published'
         AND (? IS NULL OR assets.published_at < ? OR
              (assets.published_at = ? AND assets.id < ?))
       ORDER BY assets.published_at DESC, assets.id DESC LIMIT ?`,
      [
        viewerUserId,
        viewerUserId,
        ...(query ? [query, query] : []),
        cursor?.publishedAt ?? null,
        cursor?.publishedAt ?? null,
        cursor?.publishedAt ?? null,
        cursor?.id ?? null,
        limit + 1,
      ],
    );
    const visible = rows.slice(0, limit);
    return {
      items: visible.map(rowToListItem),
      ...(rows.length > limit && visible.length
        ? { nextCursor: encodeAssetCursor(visible.at(-1)!, scope) }
        : {}),
    };
  }

  async listFeatured(
    viewerUserId: string | null,
    requestedLimit = 6,
  ): Promise<CharacterAssetListItem[]> {
    const limit = Math.min(Math.max(requestedLimit || 6, 1), 12);
    const rows = await queryRows<AssetRow>(
      `${ASSET_SELECT}
       WHERE assets.status = 'published' AND social.like_count > 0
       ORDER BY social.like_count DESC, assets.published_at DESC, assets.id DESC
       LIMIT ?`,
      [viewerUserId, viewerUserId, limit],
    );
    return rows.map(rowToListItem);
  }

  async listPublishedByAuthor(
    viewerUserId: string | null,
    authorUserId: string,
    input: { limit?: number; cursor?: string } = {},
  ): Promise<CharacterAssetPage> {
    const limit = Math.min(Math.max(input.limit ?? 24, 1), 100);
    const scope = `author:${authorUserId}`;
    const cursor = decodeAssetCursor(input.cursor, scope);
    const rows = await queryRows<AssetRow>(
      `${ASSET_SELECT}
       WHERE assets.status = 'published' AND assets.author_user_id = ?
         AND (? IS NULL OR assets.published_at < ? OR
              (assets.published_at = ? AND assets.id < ?))
       ORDER BY assets.published_at DESC, assets.id DESC LIMIT ?`,
      [
        viewerUserId,
        viewerUserId,
        authorUserId,
        cursor?.publishedAt ?? null,
        cursor?.publishedAt ?? null,
        cursor?.publishedAt ?? null,
        cursor?.id ?? null,
        limit + 1,
      ],
    );
    const visible = rows.slice(0, limit);
    return {
      items: visible.map(rowToListItem),
      ...(rows.length > limit && visible.length
        ? { nextCursor: encodeAssetCursor(visible.at(-1)!, scope) }
        : {}),
    };
  }

  async listFollowing(
    viewerUserId: string,
    input: { limit?: number; cursor?: string } = {},
  ): Promise<CharacterAssetPage> {
    const limit = Math.min(Math.max(input.limit ?? 24, 1), 100);
    const scope = `following:${viewerUserId}`;
    const cursor = decodeAssetCursor(input.cursor, scope);
    const rows = await queryRows<AssetRow>(
      `${ASSET_SELECT}
       WHERE assets.status = 'published' AND (
         assets.author_user_id = ? OR EXISTS (
           SELECT 1 FROM user_follows follows
           WHERE follows.follower_user_id = ?
             AND follows.followed_user_id = assets.author_user_id
         )
       )
       AND (? IS NULL OR assets.published_at < ? OR
            (assets.published_at = ? AND assets.id < ?))
       ORDER BY assets.published_at DESC, assets.id DESC LIMIT ?`,
      [
        viewerUserId,
        viewerUserId,
        viewerUserId,
        viewerUserId,
        cursor?.publishedAt ?? null,
        cursor?.publishedAt ?? null,
        cursor?.publishedAt ?? null,
        cursor?.id ?? null,
        limit + 1,
      ],
    );
    const visible = rows.slice(0, limit);
    return {
      items: visible.map(rowToListItem),
      ...(rows.length > limit && visible.length
        ? { nextCursor: encodeAssetCursor(visible.at(-1)!, scope) }
        : {}),
    };
  }

  async findVisible(viewerUserId: string | null, assetId: string) {
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

  async unlist(ownerUserId: string, assetId: string) {
    return withTransaction(async (connection) => {
      const asset = await queryOne<RowDataPacket & { id: string }>(
        "SELECT id FROM character_assets WHERE id = ? AND author_user_id = ? FOR UPDATE",
        [assetId, ownerUserId],
        connection,
      );
      if (!asset) return false;
      const now = Date.now();
      const result = await execute(
        `UPDATE character_assets SET status = 'unlisted', unlisted_at = ?, updated_at = ?
         WHERE id = ? AND author_user_id = ? AND status = 'published'`,
        [now, now, assetId, ownerUserId],
        connection,
      );
      if (result.affectedRows)
        await this.appendAssetEvent(connection, ownerUserId, assetId, now);
      return result.affectedRows > 0;
    });
  }

  async deleteDeletable(ownerUserId: string, assetId: string) {
    return withTransaction(async (connection) => {
      const asset = await queryOne<
        RowDataPacket & { status: "draft" | "published" | "unlisted" }
      >(
        `SELECT status FROM character_assets
         WHERE id = ? AND author_user_id = ? FOR UPDATE`,
        [assetId, ownerUserId],
        connection,
      );
      if (!asset) return "not-found" as const;
      if (!isDeletableCharacterAssetStatus(asset.status))
        return "not-deletable" as const;

      // An installation is only the update link. Removing it leaves the copied
      // agent, conversation, messages, runtime state and resource references intact.
      await execute(
        "DELETE FROM character_asset_installations WHERE asset_id = ?",
        [assetId],
        connection,
      );
      const result = await execute(
        "DELETE FROM social_objects WHERE id = ?",
        [assetId],
        connection,
      );
      if (result.affectedRows)
        await this.events.append(
          {
            ownerUserId,
            entityType: "asset",
            entityId: assetId,
            operation: "delete",
          },
          connection,
        );
      return result.affectedRows
        ? ("deleted" as const)
        : ("not-found" as const);
    });
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
        input.assetId,
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
      await this.events.append(
        {
          ownerUserId: input.ownerUserId,
          entityType: "agent",
          entityId: agentId,
          conversationId,
          operation: "upsert",
          createdAt: now,
        },
        connection,
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
        `SELECT conversations.id, runtime.state_json AS runtime_state
         FROM conversations JOIN agent_runtime_states runtime
           ON runtime.conversation_id = conversations.id
         WHERE conversations.agent_id = ? AND conversations.owner_user_id = ? FOR UPDATE`,
        [installation.agent_id, input.ownerUserId],
        connection,
      );
      if (!conversation) return null;
      const now = Date.now();
      const state = reconcileInstalledPrimeRuntimeState(
        parseJson<Record<string, unknown>>(conversation.runtime_state, {}),
        input.snapshot,
        now,
      );
      const { memories: _memories, ...storedState } = state as Record<
        string,
        unknown
      >;
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
        `UPDATE conversations SET type = ?, title = ?, updated_at = ?
         WHERE id = ?`,
        [input.snapshot.type, input.snapshot.name, now, conversation.id],
        connection,
      );
      await execute(
        `UPDATE agent_runtime_states SET state_json = ?, version = version + 1, updated_at = ?
         WHERE agent_id = ?`,
        [JSON.stringify(storedState), now, installation.agent_id],
        connection,
      );
      await syncScheduledRuns(connection, {
        ownerUserId: input.ownerUserId,
        conversationId: conversation.id,
        state,
        now,
      });
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
      await this.events.append(
        {
          ownerUserId: input.ownerUserId,
          entityType: "agent",
          entityId: installation.agent_id,
          conversationId: conversation.id,
          operation: "upsert",
          createdAt: now,
        },
        connection,
      );
      return installation.agent_id;
    });
  }

  private async appendAssetEvent(
    connection: PoolConnection,
    ownerUserId: string,
    assetId: string,
    now: number,
  ) {
    await this.events.append(
      {
        ownerUserId,
        entityType: "asset",
        entityId: assetId,
        operation: "upsert",
        createdAt: now,
      },
      connection,
    );
  }
}

const DRAFT_SELECT = `SELECT assets.id, assets.author_user_id,
  users.display_name, assets.status,
  assets.latest_version_id, latest.version_number AS latest_version_number,
  assets.draft_snapshot, assets.draft_recommended_runtime_config,
  assets.draft_dirty, assets.created_at, assets.updated_at
 FROM character_assets assets
 JOIN users ON users.id = assets.author_user_id
 LEFT JOIN character_asset_versions latest ON latest.id = assets.latest_version_id`;

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

export function rowToListItem(row: AssetRow): CharacterAssetListItem {
  const snapshot = parseJson<CharacterAssetSnapshot>(
    row.snapshot,
    null as never,
  );
  return {
    id: row.id,
    author: { id: row.author_user_id, displayName: row.display_name },
    latestVersionNumber: row.version_number,
    snapshot: {
      type: snapshot.type,
      name: snapshot.name,
      ...(snapshot.coverResourcePath
        ? { coverResourcePath: snapshot.coverResourcePath }
        : {}),
      attributes: snapshot.attributes.slice(0, 2),
      tags: snapshot.tags.slice(0, 3),
      preview: truncatePreview(
        snapshot.introduction || snapshot.detail.persona,
        160,
      ),
    },
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
  };
}

export function encodeAssetCursor(
  row: { published_at: number; id: string },
  scope: string,
) {
  return Buffer.from(
    JSON.stringify({
      v: 1,
      p: row.published_at,
      id: row.id,
      s: hashScope(scope),
    }),
  ).toString("base64url");
}

export function decodeAssetCursor(value: string | undefined, scope: string) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (
      !parsed ||
      parsed.v !== 1 ||
      !Number.isFinite(parsed.p) ||
      typeof parsed.id !== "string" ||
      parsed.s !== hashScope(scope)
    )
      throw new Error();
    return { publishedAt: Number(parsed.p), id: parsed.id };
  } catch {
    throw new CharacterAssetQueryError("分页游标无效或与当前查询不匹配。");
  }
}

function hashScope(scope: string) {
  return createHash("sha256").update(scope).digest("base64url").slice(0, 16);
}

export function normalizeSearchQuery(query?: string) {
  return query?.trim().replace(/\s+/g, " ") ?? "";
}

export function truncatePreview(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= maxLength
    ? normalized
    : `${normalized.slice(0, maxLength - 1)}…`;
}

export class CharacterAssetQueryError extends Error {}

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

function rowToDraft(row: DraftRow): CharacterAssetDraft {
  return {
    id: row.id,
    author: { id: row.author_user_id, displayName: row.display_name },
    status: row.status,
    snapshot: parseJson<CharacterAssetSnapshot>(
      row.draft_snapshot,
      null as never,
    ),
    ...(row.draft_recommended_runtime_config
      ? {
          recommendedRuntimeConfig: parseJson<PublishedRuntimeRecommendation>(
            row.draft_recommended_runtime_config,
            null as never,
          ),
        }
      : {}),
    ...(row.latest_version_id
      ? {
          latestVersionId: row.latest_version_id,
          latestVersionNumber: row.latest_version_number ?? undefined,
        }
      : {}),
    hasUnpublishedChanges: Boolean(row.draft_dirty),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function replaceDraftResources(
  connection: PoolConnection,
  assetId: string,
  resources: AssetResourceReference[],
  now: number,
) {
  await execute(
    "DELETE FROM character_asset_draft_resources WHERE asset_id = ?",
    [assetId],
    connection,
  );
  for (const resource of resources)
    await execute(
      `INSERT INTO character_asset_draft_resources
       (asset_id, resource_id, usage_kind, created_at) VALUES (?, ?, ?, ?)`,
      [assetId, resource.resourceId, resource.usageKind, now],
      connection,
    );
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
  sourcePublicAssetId: string,
  now: number,
) {
  await execute(
    `INSERT INTO agents
     (id, owner_user_id, type, name, definition, source_public_asset_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      agentId,
      ownerUserId,
      snapshot.type,
      snapshot.name,
      JSON.stringify(snapshotToDefinition(snapshot)),
      sourcePublicAssetId,
      now,
      now,
    ],
    connection,
  );
  await execute(
    `INSERT INTO conversations
     (id, owner_user_id, agent_id, type, title, last_message_preview,
      unread_count, pinned_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?, ?)`,
    [
      conversationId,
      ownerUserId,
      agentId,
      snapshot.type,
      snapshot.name,
      snapshot.introduction || snapshot.detail.persona,
      now,
      now,
    ],
    connection,
  );
  const state = initialRuntimeState(snapshot, now);
  const { memories: _memories, ...storedState } = state as Record<
    string,
    unknown
  >;
  await execute(
    `INSERT INTO agent_runtime_states
     (agent_id, owner_user_id, conversation_id, state_json, version, updated_at)
     VALUES (?, ?, ?, ?, 1, ?)`,
    [agentId, ownerUserId, conversationId, JSON.stringify(storedState), now],
    connection,
  );
  await syncScheduledRuns(connection, {
    ownerUserId,
    conversationId,
    state,
    now,
  });
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

export function reconcileInstalledPrimeRuntimeState(
  current: Record<string, unknown>,
  snapshot: CharacterAssetSnapshot,
  now: number,
) {
  if (snapshot.type !== "prime-figure") return current;
  const variables = Object.fromEntries(
    snapshot.detail.variableDefinitions.map((definition) => [
      definition.key,
      definition.defaultValue ?? null,
    ]),
  );
  return {
    ...current,
    variables,
    currentSituation: snapshot.detail.currentSituation,
    schedule: snapshot.detail.schedule,
    itinerary: snapshot.detail.itinerary,
    mood: snapshot.detail.initialMood,
    moodObservedAtMs: now,
    relationshipStatus: snapshot.detail.initialRelationshipStatus,
    updatedAt: now,
  };
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

export function isDeletableCharacterAssetStatus(
  status: "draft" | "published" | "unlisted",
) {
  return status === "draft" || status === "unlisted";
}
