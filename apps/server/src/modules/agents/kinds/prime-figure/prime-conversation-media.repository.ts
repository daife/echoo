import { getDatabase } from "../../../../infra/database/sqlite.js";

export type PrimeConversationMediaType = "image" | "video" | "voice";
export type PrimeConversationMediaSource =
  "message" | "figure_cover" | "generated";

export interface PrimeConversationMedia {
  conversationId: string;
  ownerUserId: string;
  mediaIndex: number;
  mediaId: string;
  mediaType: PrimeConversationMediaType;
  resourceId: string;
  description?: string;
  source: PrimeConversationMediaSource;
  mimeType: string;
  publicPath: string;
}

interface MediaRow {
  conversation_id: string;
  owner_user_id: string;
  media_index: number;
  media_id: string;
  media_type: PrimeConversationMediaType;
  resource_id: string;
  description: string | null;
  source: PrimeConversationMediaSource;
  mime_type: string;
  public_path: string;
}

export class PrimeConversationMediaRepository {
  private readonly db = getDatabase();

  ensure(input: {
    ownerUserId: string;
    conversationId: string;
    resourceId: string;
    mediaType: PrimeConversationMediaType;
    description?: string;
    source?: PrimeConversationMediaSource;
  }): PrimeConversationMedia {
    const conversation = this.db
      .prepare("SELECT 1 FROM conversations WHERE id = ? AND owner_user_id = ?")
      .get(input.conversationId, input.ownerUserId);
    if (!conversation) throw new Error("会话不存在或不属于当前用户。");
    const existing = this.findByResource(
      input.ownerUserId,
      input.conversationId,
      input.resourceId,
    );
    const description = input.description?.trim() || undefined;
    if (existing) {
      if (existing.mediaType !== input.mediaType)
        throw new Error("同一会话资源的媒体类型不可改变。");
      const nextSource =
        input.source === "figure_cover" ? "figure_cover" : existing.source;
      const nextDescription =
        nextSource === "figure_cover"
          ? "figure角色立绘"
          : (description ?? existing.description);
      if (
        nextDescription !== existing.description ||
        nextSource !== existing.source
      ) {
        this.db
          .prepare(
            `UPDATE prime_conversation_media
             SET description = ?, source = ?, updated_at = ?
             WHERE owner_user_id = ? AND conversation_id = ? AND resource_id = ?`,
          )
          .run(
            nextDescription ?? null,
            nextSource,
            Date.now(),
            input.ownerUserId,
            input.conversationId,
            input.resourceId,
          );
        return {
          ...existing,
          ...(nextDescription ? { description: nextDescription } : {}),
          source: nextSource,
        };
      }
      return existing;
    }

    const resource = this.db
      .prepare(
        "SELECT mime_type, public_path FROM resources WHERE id = ? AND owner_user_id = ?",
      )
      .get(input.resourceId, input.ownerUserId) as
      { mime_type: string; public_path: string } | undefined;
    if (!resource)
      throw new Error(`媒体资源不存在或不属于当前用户：${input.resourceId}。`);
    if (!matchesMediaType(resource.mime_type, input.mediaType))
      throw new Error(`资源 MIME 与媒体类型不匹配：${resource.mime_type}。`);

    const row = this.db
      .prepare(
        `SELECT COALESCE(MAX(media_index), 0) AS max_index
         FROM prime_conversation_media WHERE conversation_id = ?`,
      )
      .get(input.conversationId) as { max_index: number };
    const mediaIndex = row.max_index + 1;
    const mediaId = `media_${mediaIndex}`;
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO prime_conversation_media (
          conversation_id, owner_user_id, media_index, media_id, media_type,
          resource_id, description, source, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.conversationId,
        input.ownerUserId,
        mediaIndex,
        mediaId,
        input.mediaType,
        input.resourceId,
        description ?? null,
        input.source ?? "message",
        now,
        now,
      );
    return {
      conversationId: input.conversationId,
      ownerUserId: input.ownerUserId,
      mediaIndex,
      mediaId,
      mediaType: input.mediaType,
      resourceId: input.resourceId,
      ...(description ? { description } : {}),
      source: input.source ?? "message",
      mimeType: resource.mime_type,
      publicPath: resource.public_path,
    };
  }

  listAvailableImages(ownerUserId: string, conversationId: string) {
    return this.list(ownerUserId, conversationId).filter(
      (media) => media.mediaType === "image" && Boolean(media.description),
    );
  }

  resolveImageReferences(
    ownerUserId: string,
    conversationId: string,
    mediaIds: string[],
  ) {
    if (new Set(mediaIds).size !== mediaIds.length)
      throw new Error("参考图片资源 ID 不得重复。");
    const byId = new Map(
      this.listAvailableImages(ownerUserId, conversationId).map((media) => [
        media.mediaId,
        media,
      ]),
    );
    return mediaIds.map((mediaId) => {
      const media = byId.get(mediaId);
      if (!media) throw new Error(`参考图片资源不可用：${mediaId}。`);
      return media;
    });
  }

  private findByResource(
    ownerUserId: string,
    conversationId: string,
    resourceId: string,
  ) {
    const row = this.db
      .prepare(
        `${SELECT_MEDIA}
         WHERE media.owner_user_id = ? AND media.conversation_id = ? AND media.resource_id = ?`,
      )
      .get(ownerUserId, conversationId, resourceId) as MediaRow | undefined;
    return row ? rowToMedia(row) : null;
  }

  private list(ownerUserId: string, conversationId: string) {
    const rows = this.db
      .prepare(
        `${SELECT_MEDIA}
         WHERE media.owner_user_id = ? AND media.conversation_id = ?
         ORDER BY media.media_index ASC`,
      )
      .all(ownerUserId, conversationId) as unknown as MediaRow[];
    return rows.map(rowToMedia);
  }
}

const SELECT_MEDIA = `SELECT media.*, resources.mime_type, resources.public_path
  FROM prime_conversation_media media
  JOIN resources ON resources.id = media.resource_id`;

function matchesMediaType(
  mimeType: string,
  mediaType: PrimeConversationMediaType,
) {
  if (mediaType === "image") return mimeType.startsWith("image/");
  if (mediaType === "video") return mimeType.startsWith("video/");
  return mimeType.startsWith("audio/");
}

function rowToMedia(row: MediaRow): PrimeConversationMedia {
  return {
    conversationId: row.conversation_id,
    ownerUserId: row.owner_user_id,
    mediaIndex: row.media_index,
    mediaId: row.media_id,
    mediaType: row.media_type,
    resourceId: row.resource_id,
    ...(row.description ? { description: row.description } : {}),
    source: row.source,
    mimeType: row.mime_type,
    publicPath: row.public_path,
  };
}
