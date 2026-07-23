import type { SocialPostPage, SocialPostSummary } from "@echoo/shared";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import {
  execute,
  queryOne,
  queryRows,
  withTransaction,
} from "../../infra/database/mysql.js";
import { createId } from "../../shared/utils/id.js";

interface PostRow extends RowDataPacket {
  id: string;
  author_user_id: string;
  display_name: string;
  avatar_url: string | null;
  is_admin: number;
  body: string;
  like_count: number;
  comment_count: number;
  viewer_has_liked: number;
  created_at: number;
  updated_at: number;
}

interface ImageRow extends RowDataPacket {
  post_id: string;
  resource_id: string;
  public_path: string;
  position: number;
}

export class SocialPostRepository {
  async create(authorUserId: string, body: string, resourceIds: string[]) {
    const id = createId("post");
    const now = Date.now();
    await withTransaction(async (connection) => {
      await execute(
        `INSERT INTO social_objects
         (id, object_type, like_count, comment_count, created_at, updated_at)
         VALUES (?, 'post', 0, 0, ?, ?)`,
        [id, now, now],
        connection,
      );
      await execute(
        `INSERT INTO social_posts (id, author_user_id, body, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
        [id, authorUserId, body, now, now],
        connection,
      );
      await replaceImages(connection, id, resourceIds, now);
    });
    return id;
  }

  async update(
    authorUserId: string,
    postId: string,
    body: string,
    resourceIds: string[],
  ) {
    return withTransaction(async (connection) => {
      const post = await queryOne<RowDataPacket & { id: string }>(
        `SELECT id FROM social_posts
         WHERE id = ? AND author_user_id = ? FOR UPDATE`,
        [postId, authorUserId],
        connection,
      );
      if (!post) return false;
      const now = Date.now();
      await execute(
        `UPDATE social_posts SET body = ?, updated_at = ?
         WHERE id = ? AND author_user_id = ?`,
        [body, now, postId, authorUserId],
        connection,
      );
      await replaceImages(connection, postId, resourceIds, now);
      await execute(
        "UPDATE social_objects SET updated_at = ? WHERE id = ?",
        [now, postId],
        connection,
      );
      return true;
    });
  }

  async delete(authorUserId: string, postId: string) {
    return withTransaction(async (connection) => {
      const post = await queryOne<RowDataPacket & { id: string }>(
        `SELECT id FROM social_posts
         WHERE id = ? AND author_user_id = ? FOR UPDATE`,
        [postId, authorUserId],
        connection,
      );
      if (!post) return false;
      const result = await execute(
        "DELETE FROM social_objects WHERE id = ?",
        [postId],
        connection,
      );
      return result.affectedRows > 0;
    });
  }

  async find(viewerUserId: string | null, postId: string) {
    const row = await queryOne<PostRow>(`${POST_SELECT} WHERE posts.id = ?`, [
      viewerUserId,
      postId,
    ]);
    if (!row) return null;
    return (await this.hydrate([row], viewerUserId))[0] ?? null;
  }

  async listByAuthor(
    viewerUserId: string | null,
    authorUserId: string,
    input: { limit?: number; cursor?: string } = {},
  ) {
    return this.list(
      viewerUserId,
      "posts.author_user_id = ?",
      [authorUserId],
      input,
    );
  }

  async listFollowing(
    viewerUserId: string,
    input: { limit?: number; cursor?: string } = {},
  ) {
    return this.list(
      viewerUserId,
      `(posts.author_user_id = ? OR EXISTS (
        SELECT 1 FROM user_follows follows
        WHERE follows.follower_user_id = ?
          AND follows.followed_user_id = posts.author_user_id
      ))`,
      [viewerUserId, viewerUserId],
      input,
    );
  }

  private async list(
    viewerUserId: string | null,
    predicate: string,
    values: unknown[],
    input: { limit?: number; cursor?: string },
  ): Promise<SocialPostPage> {
    const limit = Math.min(Math.max(input.limit ?? 20, 1), 50);
    const cursor = decodeCursor(input.cursor);
    const rows = await queryRows<PostRow>(
      `${POST_SELECT}
       WHERE ${predicate}
         AND (? IS NULL OR posts.created_at < ? OR
              (posts.created_at = ? AND posts.id < ?))
       ORDER BY posts.created_at DESC, posts.id DESC LIMIT ?`,
      [
        viewerUserId,
        ...values,
        cursor?.createdAt ?? null,
        cursor?.createdAt ?? null,
        cursor?.createdAt ?? null,
        cursor?.id ?? null,
        limit + 1,
      ],
    );
    const visible = rows.slice(0, limit);
    const items = await this.hydrate(visible, viewerUserId);
    return {
      items,
      ...(rows.length > limit && visible.length
        ? { nextCursor: encodeCursor(visible.at(-1)!) }
        : {}),
    };
  }

  private async hydrate(rows: PostRow[], viewerUserId: string | null) {
    if (!rows.length) return [];
    const placeholders = rows.map(() => "?").join(",");
    const images = await queryRows<ImageRow>(
      `SELECT links.post_id, links.resource_id, resources.public_path, links.position
       FROM social_post_resources links
       JOIN resources ON resources.id = links.resource_id
       WHERE links.post_id IN (${placeholders})
       ORDER BY links.position ASC`,
      rows.map((row) => row.id),
    );
    const byPost = new Map<string, SocialPostSummary["images"]>();
    for (const image of images) {
      const list = byPost.get(image.post_id) ?? [];
      list.push({
        resourceId: image.resource_id,
        resourcePath: image.public_path,
        position: image.position,
      });
      byPost.set(image.post_id, list);
    }
    return rows.map((row): SocialPostSummary => ({
      id: row.id,
      author: {
        id: row.author_user_id,
        displayName: row.display_name,
        ...(row.avatar_url ? { avatarUrl: row.avatar_url } : {}),
        isAdmin: Boolean(row.is_admin),
      },
      body: row.body,
      images: byPost.get(row.id) ?? [],
      likeCount: row.like_count,
      commentCount: row.comment_count,
      viewerHasLiked: Boolean(row.viewer_has_liked),
      canEdit: row.author_user_id === viewerUserId,
      canDelete: row.author_user_id === viewerUserId,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }
}

const POST_SELECT = `SELECT posts.id, posts.author_user_id, users.display_name, users.is_admin,
  avatar.public_path AS avatar_url, posts.body, social.like_count,
  social.comment_count,
  EXISTS(SELECT 1 FROM social_likes likes
         WHERE likes.object_id = posts.id AND likes.user_id = ?) AS viewer_has_liked,
  posts.created_at, posts.updated_at
 FROM social_posts posts
 JOIN users ON users.id = posts.author_user_id
 JOIN social_objects social ON social.id = posts.id
 LEFT JOIN user_resources avatar_link
   ON avatar_link.user_id = users.id AND avatar_link.usage_kind = 'avatar'
 LEFT JOIN resources avatar ON avatar.id = avatar_link.resource_id`;

async function replaceImages(
  connection: PoolConnection,
  postId: string,
  resourceIds: string[],
  now: number,
) {
  await execute(
    "DELETE FROM social_post_resources WHERE post_id = ?",
    [postId],
    connection,
  );
  for (const [position, resourceId] of resourceIds.entries())
    await execute(
      `INSERT INTO social_post_resources (post_id, resource_id, position, created_at)
       VALUES (?, ?, ?, ?)`,
      [postId, resourceId, position, now],
      connection,
    );
}

function encodeCursor(row: { created_at: number; id: string }) {
  return Buffer.from(JSON.stringify([row.created_at, row.id])).toString(
    "base64url",
  );
}

function decodeCursor(value?: string) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (
      !Array.isArray(parsed) ||
      !Number.isFinite(parsed[0]) ||
      typeof parsed[1] !== "string"
    )
      return null;
    return { createdAt: Number(parsed[0]), id: parsed[1] };
  } catch {
    return null;
  }
}
