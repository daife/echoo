import type { SocialComment, SocialCommentPage } from "@echoo/shared";
import type { RowDataPacket } from "mysql2";
import {
  execute,
  queryOne,
  queryRows,
  withTransaction,
} from "../../infra/database/mysql.js";
import { createId } from "../../shared/utils/id.js";

interface SocialObjectRow extends RowDataPacket {
  id: string;
  object_type: string;
  asset_status: "published" | "unlisted" | null;
  owner_user_id: string | null;
  viewer_can_access: number;
}

interface CommentRow extends RowDataPacket {
  id: string;
  object_id: string;
  author_user_id: string;
  display_name: string;
  avatar_url: string | null;
  parent_comment_id: string | null;
  body: string;
  status: SocialComment["status"];
  object_owner_user_id: string | null;
  created_at: number;
  updated_at: number;
}

export class SocialRepository {
  async findObject(objectId: string, viewerUserId: string | null) {
    return queryOne<SocialObjectRow>(
      `SELECT social.id, social.object_type, assets.status AS asset_status,
              COALESCE(assets.author_user_id, posts.author_user_id) AS owner_user_id,
              (posts.id IS NOT NULL OR assets.status = 'published' OR assets.author_user_id = ? OR
               EXISTS(SELECT 1 FROM character_asset_installations installations
                      WHERE installations.asset_id = assets.id
                        AND installations.owner_user_id = ?)) AS viewer_can_access
       FROM social_objects social
       LEFT JOIN character_assets assets
         ON social.object_type = 'character_asset' AND assets.id = social.id
       LEFT JOIN social_posts posts
         ON social.object_type = 'post' AND posts.id = social.id
       WHERE social.id = ?`,
      [viewerUserId, viewerUserId, objectId],
    );
  }

  async setLike(objectId: string, userId: string, liked: boolean) {
    return withTransaction(async (connection) => {
      if (liked) {
        const result = await execute(
          `INSERT IGNORE INTO social_likes (object_id, user_id, created_at)
           VALUES (?, ?, ?)`,
          [objectId, userId, Date.now()],
          connection,
        );
        if (result.affectedRows)
          await execute(
            `UPDATE social_objects SET like_count = like_count + 1, updated_at = ?
             WHERE id = ?`,
            [Date.now(), objectId],
            connection,
          );
      } else {
        const result = await execute(
          "DELETE FROM social_likes WHERE object_id = ? AND user_id = ?",
          [objectId, userId],
          connection,
        );
        if (result.affectedRows)
          await execute(
            `UPDATE social_objects SET like_count = GREATEST(like_count - 1, 0),
             updated_at = ? WHERE id = ?`,
            [Date.now(), objectId],
            connection,
          );
      }
      const row = await queryOne<
        RowDataPacket & { like_count: number; viewer_has_liked: number }
      >(
        `SELECT social.like_count,
          EXISTS(SELECT 1 FROM social_likes
                 WHERE object_id = social.id AND user_id = ?) AS viewer_has_liked
         FROM social_objects social WHERE social.id = ?`,
        [userId, objectId],
        connection,
      );
      return {
        likeCount: row?.like_count ?? 0,
        viewerHasLiked: Boolean(row?.viewer_has_liked),
      };
    });
  }

  async listComments(input: {
    objectId: string;
    viewerUserId: string | null;
    before?: number;
    limit: number;
  }): Promise<SocialCommentPage> {
    const rows = await queryRows<CommentRow>(
      `SELECT comments.*, users.display_name, avatar.public_path AS avatar_url,
              COALESCE(assets.author_user_id, posts.author_user_id) AS object_owner_user_id
       FROM social_comments comments
       JOIN users ON users.id = comments.author_user_id
       LEFT JOIN user_resources avatar_link
         ON avatar_link.user_id = users.id AND avatar_link.usage_kind = 'avatar'
       LEFT JOIN resources avatar ON avatar.id = avatar_link.resource_id
       LEFT JOIN character_assets assets ON assets.id = comments.object_id
       LEFT JOIN social_posts posts ON posts.id = comments.object_id
       WHERE comments.object_id = ?
         AND comments.parent_comment_id IS NULL
         AND (? IS NULL OR comments.created_at < ?)
         AND (comments.status != 'hidden' OR comments.author_user_id = ?
              OR COALESCE(assets.author_user_id, posts.author_user_id) = ?)
       ORDER BY comments.created_at DESC, comments.id DESC LIMIT ?`,
      [
        input.objectId,
        input.before ?? null,
        input.before ?? null,
        input.viewerUserId,
        input.viewerUserId,
        input.limit + 1,
      ],
    );
    const hasMore = rows.length > input.limit;
    const visibleRows = rows.slice(0, input.limit);
    const replies = visibleRows.length
      ? await queryRows<CommentRow>(
          `SELECT comments.*, users.display_name, avatar.public_path AS avatar_url,
                  COALESCE(assets.author_user_id, posts.author_user_id) AS object_owner_user_id
           FROM social_comments comments
           JOIN users ON users.id = comments.author_user_id
           LEFT JOIN user_resources avatar_link
             ON avatar_link.user_id = users.id AND avatar_link.usage_kind = 'avatar'
           LEFT JOIN resources avatar ON avatar.id = avatar_link.resource_id
           LEFT JOIN character_assets assets ON assets.id = comments.object_id
           LEFT JOIN social_posts posts ON posts.id = comments.object_id
           WHERE comments.parent_comment_id IN (${visibleRows.map(() => "?").join(",")})
             AND (comments.status != 'hidden' OR comments.author_user_id = ?
                  OR COALESCE(assets.author_user_id, posts.author_user_id) = ?)
           ORDER BY comments.created_at ASC, comments.id ASC`,
          [
            ...visibleRows.map((row) => row.id),
            input.viewerUserId,
            input.viewerUserId,
          ],
        )
      : [];
    return {
      items: [...visibleRows, ...replies].map((row) =>
        rowToComment(row, input.viewerUserId),
      ),
      ...(hasMore && visibleRows.length
        ? { nextCursor: String(visibleRows.at(-1)!.created_at) }
        : {}),
    };
  }

  async createComment(input: {
    objectId: string;
    authorUserId: string;
    body: string;
    parentCommentId?: string;
  }) {
    return withTransaction(async (connection) => {
      if (input.parentCommentId) {
        const parent = await queryOne<
          RowDataPacket & {
            object_id: string;
            parent_comment_id: string | null;
            status: string;
          }
        >(
          `SELECT object_id, parent_comment_id, status FROM social_comments
           WHERE id = ? FOR UPDATE`,
          [input.parentCommentId],
          connection,
        );
        if (
          !parent ||
          parent.object_id !== input.objectId ||
          parent.parent_comment_id ||
          parent.status !== "visible"
        )
          return null;
      }
      const id = createId("comment");
      const now = Date.now();
      await execute(
        `INSERT INTO social_comments
         (id, object_id, author_user_id, parent_comment_id, body, status,
          created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, 'visible', ?, ?, NULL)`,
        [
          id,
          input.objectId,
          input.authorUserId,
          input.parentCommentId ?? null,
          input.body,
          now,
          now,
        ],
        connection,
      );
      await execute(
        `UPDATE social_objects SET comment_count = comment_count + 1,
         updated_at = ? WHERE id = ?`,
        [now, input.objectId],
        connection,
      );
      return id;
    });
  }

  async findComment(commentId: string) {
    return queryOne<CommentRow>(
      `SELECT comments.*, users.display_name, avatar.public_path AS avatar_url,
              COALESCE(assets.author_user_id, posts.author_user_id) AS object_owner_user_id
       FROM social_comments comments
       JOIN users ON users.id = comments.author_user_id
       LEFT JOIN user_resources avatar_link
         ON avatar_link.user_id = users.id AND avatar_link.usage_kind = 'avatar'
       LEFT JOIN resources avatar ON avatar.id = avatar_link.resource_id
       LEFT JOIN character_assets assets ON assets.id = comments.object_id
       LEFT JOIN social_posts posts ON posts.id = comments.object_id
       WHERE comments.id = ?`,
      [commentId],
    );
  }

  async updateComment(commentId: string, authorUserId: string, body: string) {
    const result = await execute(
      `UPDATE social_comments SET body = ?, updated_at = ?
       WHERE id = ? AND author_user_id = ? AND status = 'visible'`,
      [body, Date.now(), commentId, authorUserId],
    );
    return result.affectedRows > 0;
  }

  async moderateComment(input: {
    commentId: string;
    actorUserId: string;
    hide: boolean;
  }) {
    return withTransaction(async (connection) => {
      const row = await queryOne<CommentRow>(
        `SELECT comments.*, users.display_name, avatar.public_path AS avatar_url,
                COALESCE(assets.author_user_id, posts.author_user_id) AS object_owner_user_id
         FROM social_comments comments
         JOIN users ON users.id = comments.author_user_id
         LEFT JOIN user_resources avatar_link
           ON avatar_link.user_id = users.id AND avatar_link.usage_kind = 'avatar'
         LEFT JOIN resources avatar ON avatar.id = avatar_link.resource_id
         LEFT JOIN character_assets assets ON assets.id = comments.object_id
         LEFT JOIN social_posts posts ON posts.id = comments.object_id
         WHERE comments.id = ? FOR UPDATE`,
        [input.commentId],
        connection,
      );
      if (!row || row.status !== "visible") return null;
      const isAuthor = row.author_user_id === input.actorUserId;
      const isObjectOwner = row.object_owner_user_id === input.actorUserId;
      if (input.hide ? !isObjectOwner : !isAuthor) return null;
      const status = input.hide ? "hidden" : "deleted";
      const now = Date.now();
      await execute(
        `UPDATE social_comments SET status = ?, body = '', updated_at = ?, deleted_at = ?
         WHERE id = ?`,
        [status, now, now, row.id],
        connection,
      );
      await execute(
        `UPDATE social_objects SET comment_count = GREATEST(comment_count - 1, 0),
         updated_at = ? WHERE id = ?`,
        [now, row.object_id],
        connection,
      );
      return true;
    });
  }
}

export function rowToComment(row: CommentRow, viewerUserId: string | null) {
  return {
    id: row.id,
    objectId: row.object_id,
    author: {
      id: row.author_user_id,
      displayName: row.display_name,
      ...(row.avatar_url ? { avatarUrl: row.avatar_url } : {}),
    },
    ...(row.parent_comment_id
      ? { parentCommentId: row.parent_comment_id }
      : {}),
    body: row.body,
    status: row.status,
    canEdit: row.status === "visible" && row.author_user_id === viewerUserId,
    canDelete: row.status === "visible" && row.author_user_id === viewerUserId,
    canHide:
      row.status === "visible" &&
      row.object_owner_user_id === viewerUserId &&
      row.author_user_id !== viewerUserId,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  } satisfies SocialComment;
}
