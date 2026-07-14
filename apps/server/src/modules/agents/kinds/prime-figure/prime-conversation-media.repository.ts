import type { RowDataPacket } from "mysql2";
import {
  execute,
  queryOne,
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
interface ConversationRow extends RowDataPacket {
  runtime_state: unknown;
}
type StoredMedia = Omit<PrimeConversationMedia, "mimeType" | "publicPath">;

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
    return withTransaction(async (connection) => {
      const row = await queryOne<ConversationRow>(
        "SELECT runtime_state FROM conversations WHERE id = ? AND owner_user_id = ? FOR UPDATE",
        [input.conversationId, input.ownerUserId],
        connection,
      );
      if (!row) throw new Error("会话不存在或不属于当前用户。");
      const state = parseJson<{ media?: StoredMedia[] }>(row.runtime_state, {});
      const media = state.media ?? [];
      const resource = await this.resources.findById(input.resourceId);
      if (!resource || resource.ownerUserId !== input.ownerUserId)
        throw new Error(
          `媒体资源不存在或不属于当前用户：${input.resourceId}。`,
        );
      if (!matchesMediaType(resource.mimeType, input.mediaType))
        throw new Error(`资源 MIME 与媒体类型不匹配：${resource.mimeType}。`);
      let stored = media.find((item) => item.resourceId === input.resourceId);
      const description = input.description?.trim() || stored?.description;
      if (stored) {
        stored = {
          ...stored,
          ...(description ? { description } : {}),
          source:
            input.source === "figure_cover" ||
            input.source === "figure_reference"
              ? input.source
              : stored.source,
        };
        media.splice(
          media.findIndex((item) => item.resourceId === input.resourceId),
          1,
          stored,
        );
      } else {
        const mediaIndex = media.length + 1;
        stored = {
          conversationId: input.conversationId,
          ownerUserId: input.ownerUserId,
          mediaIndex,
          mediaId: `media_${mediaIndex}`,
          mediaType: input.mediaType,
          resourceId: input.resourceId,
          ...(description ? { description } : {}),
          source: input.source ?? "message",
        };
        media.push(stored);
      }
      await execute(
        "UPDATE conversations SET runtime_state = ? WHERE id = ?",
        [JSON.stringify({ ...state, media }), input.conversationId],
        connection,
      );
      return {
        ...stored,
        mimeType: resource.mimeType,
        publicPath: resource.publicPath,
      };
    });
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
      (await this.listAvailableImages(ownerUserId, conversationId)).map((m) => [
        m.mediaId,
        m,
      ]),
    );
    return mediaIds.map((id) => {
      const media = byId.get(id);
      if (!media) throw new Error(`参考图片资源不可用：${id}。`);
      return media;
    });
  }
  private async list(ownerUserId: string, conversationId: string) {
    const row = await queryOne<ConversationRow>(
      "SELECT runtime_state FROM conversations WHERE id = ? AND owner_user_id = ?",
      [conversationId, ownerUserId],
    );
    if (!row) return [];
    const stored =
      parseJson<{ media?: StoredMedia[] }>(row.runtime_state, {}).media ?? [];
    const result: PrimeConversationMedia[] = [];
    for (const media of stored) {
      const resource = await this.resources.findById(media.resourceId);
      if (resource)
        result.push({
          ...media,
          mimeType: resource.mimeType,
          publicPath: resource.publicPath,
        });
    }
    return result;
  }
}
function matchesMediaType(mime: string, type: PrimeConversationMediaType) {
  return type === "image"
    ? mime.startsWith("image/")
    : type === "video"
      ? mime.startsWith("video/")
      : mime.startsWith("audio/");
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
