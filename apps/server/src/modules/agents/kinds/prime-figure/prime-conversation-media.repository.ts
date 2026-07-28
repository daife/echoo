import type { RowDataPacket } from "mysql2";
import {
  execute,
  queryOne,
  queryRows,
  withTransaction,
} from "../../../../infra/database/mysql.js";
import { ResourceRepository } from "../../../resources/resource.repository.js";

export type PrimeConversationMediaType = "image" | "video" | "voice";
export type PrimeConversationMediaSource =
  "message" | "figure_cover" | "figure_reference" | "generated";
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

interface MediaRow extends RowDataPacket {
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
  constructor(private readonly resources = new ResourceRepository()) {}

  async ensure(input: {
    ownerUserId: string;
    conversationId: string;
    resourceId: string;
    mediaType: PrimeConversationMediaType;
    description?: string;
    source?: PrimeConversationMediaSource;
  }) {
    const resource = await this.resources.findById(input.resourceId);
    if (
      !resource ||
      resource.status !== "ready" ||
      !(await this.resources.canConversationAccess(
        input.ownerUserId,
        input.conversationId,
        input.resourceId,
      ))
    )
      throw new Error(`媒体资源不存在或不属于当前会话：${input.resourceId}。`);
    if (!matchesMediaType(resource.mimeType, input.mediaType))
      throw new Error(`资源 MIME 与媒体类型不匹配：${resource.mimeType}。`);

    await withTransaction(async (connection) => {
      const conversation = await queryOne<RowDataPacket>(
        "SELECT id FROM conversations WHERE id = ? AND owner_user_id = ? FOR UPDATE",
        [input.conversationId, input.ownerUserId],
        connection,
      );
      if (!conversation) throw new Error("会话不存在或不属于当前用户。");
      const existing = await queryOne<MediaRow>(
        `SELECT media.*, resources.mime_type, resources.public_path
         FROM conversation_media media JOIN resources ON resources.id = media.resource_id
         WHERE media.conversation_id = ? AND media.resource_id = ?`,
        [input.conversationId, input.resourceId],
        connection,
      );
      const description = input.description?.trim() || existing?.description;
      if (existing) {
        await execute(
          `UPDATE conversation_media SET description = ?, source = ?, updated_at = ?
           WHERE conversation_id = ? AND resource_id = ?`,
          [
            description ?? null,
            input.source === "figure_cover" ||
            input.source === "figure_reference"
              ? input.source
              : existing.source,
            Date.now(),
            input.conversationId,
            input.resourceId,
          ],
          connection,
        );
        return;
      }
      const max = await queryOne<RowDataPacket & { value: number | null }>(
        "SELECT MAX(media_index) AS value FROM conversation_media WHERE conversation_id = ?",
        [input.conversationId],
        connection,
      );
      const mediaIndex = Number(max?.value ?? 0) + 1;
      const now = Date.now();
      await execute(
        `INSERT INTO conversation_media
         (conversation_id, owner_user_id, media_index, media_id, media_type,
          resource_id, description, source, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          input.conversationId,
          input.ownerUserId,
          mediaIndex,
          `media_${mediaIndex}`,
          input.mediaType,
          input.resourceId,
          description ?? null,
          input.source ?? "message",
          now,
          now,
        ],
        connection,
      );
    });
    return (await this.list(input.ownerUserId, input.conversationId)).find(
      (media) => media.resourceId === input.resourceId,
    )!;
  }

  async listAvailableImages(ownerUserId: string, conversationId: string) {
    return (await this.list(ownerUserId, conversationId)).filter(
      (media) => media.mediaType === "image" && Boolean(media.description),
    );
  }

  async resolveImageReferences(
    ownerUserId: string,
    conversationId: string,
    mediaIds: string[],
  ) {
    if (new Set(mediaIds).size !== mediaIds.length)
      throw new Error("参考图片资源 ID 不得重复。");
    const byId = new Map(
      (await this.listAvailableImages(ownerUserId, conversationId)).map(
        (media) => [media.mediaId, media],
      ),
    );
    return mediaIds.map((id) => {
      const media = byId.get(id);
      if (!media) throw new Error(`参考图片资源不可用：${id}。`);
      return media;
    });
  }

  private async list(ownerUserId: string, conversationId: string) {
    const rows = await queryRows<MediaRow>(
      `SELECT media.*, resources.mime_type, resources.public_path
       FROM conversation_media media JOIN resources ON resources.id = media.resource_id
       WHERE media.owner_user_id = ? AND media.conversation_id = ?
       ORDER BY media.media_index ASC`,
      [ownerUserId, conversationId],
    );
    return rows.map(rowToMedia);
  }
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

function matchesMediaType(mime: string, type: PrimeConversationMediaType) {
  return type === "image"
    ? mime.startsWith("image/")
    : type === "video"
      ? mime.startsWith("video/")
      : mime.startsWith("audio/");
}
