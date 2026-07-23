import type {
  FollowMutationResult,
  PublicUserPage,
  PublicUserProfile,
} from "@echoo/shared";
import type { RowDataPacket } from "mysql2/promise";
import {
  execute,
  queryOne,
  queryRows,
  withTransaction,
} from "../../infra/database/mysql.js";

interface PublicUserRow extends RowDataPacket {
  id: string;
  display_name: string;
  signature: string;
  avatar_url: string | null;
  is_admin: number;
  created_at: number;
  follower_count: number;
  following_count: number;
  viewer_is_following: number;
  follows_viewer: number;
}

export class UserSocialRepository {
  async findProfile(viewerUserId: string | null, userId: string) {
    const row = await queryOne<PublicUserRow>(
      `${PUBLIC_USER_SELECT} WHERE users.id = ?`,
      [viewerUserId, viewerUserId, userId],
    );
    return row ? rowToProfile(row, viewerUserId) : null;
  }

  async setFollowing(
    followerUserId: string,
    followedUserId: string,
    following: boolean,
  ): Promise<FollowMutationResult | null> {
    return withTransaction(async (connection) => {
      const target = await queryOne<RowDataPacket & { id: string }>(
        "SELECT id FROM users WHERE id = ? FOR UPDATE",
        [followedUserId],
        connection,
      );
      if (!target) return null;
      if (following)
        await execute(
          `INSERT IGNORE INTO user_follows (follower_user_id, followed_user_id, created_at)
           VALUES (?, ?, ?)`,
          [followerUserId, followedUserId, Date.now()],
          connection,
        );
      else
        await execute(
          "DELETE FROM user_follows WHERE follower_user_id = ? AND followed_user_id = ?",
          [followerUserId, followedUserId],
          connection,
        );
      const row = await queryOne<
        RowDataPacket & {
          follower_count: number;
          following: number;
          mutual: number;
        }
      >(
        `SELECT
          (SELECT COUNT(*) FROM user_follows WHERE followed_user_id = ?) AS follower_count,
          EXISTS(SELECT 1 FROM user_follows WHERE follower_user_id = ? AND followed_user_id = ?) AS following,
          EXISTS(SELECT 1 FROM user_follows WHERE follower_user_id = ? AND followed_user_id = ?) AS mutual`,
        [
          followedUserId,
          followerUserId,
          followedUserId,
          followedUserId,
          followerUserId,
        ],
        connection,
      );
      return {
        following: Boolean(row?.following),
        followerCount: row?.follower_count ?? 0,
        isMutual: Boolean(row?.following && row?.mutual),
      };
    });
  }

  async listRelations(
    viewerUserId: string | null,
    userId: string,
    direction: "followers" | "following",
    requestedLimit: number,
    cursor?: string,
  ): Promise<PublicUserPage> {
    const limit = Math.min(Math.max(requestedLimit || 30, 1), 100);
    const offset = Math.max(Number(cursor) || 0, 0);
    const join =
      direction === "followers"
        ? "relations.follower_user_id = users.id"
        : "relations.followed_user_id = users.id";
    const ownerColumn =
      direction === "followers"
        ? "relations.followed_user_id"
        : "relations.follower_user_id";
    const rows = await queryRows<PublicUserRow>(
      `${PUBLIC_USER_SELECT}
       JOIN user_follows relations ON ${join}
       WHERE ${ownerColumn} = ?
       ORDER BY relations.created_at DESC LIMIT ? OFFSET ?`,
      [viewerUserId, viewerUserId, userId, limit + 1, offset],
    );
    return {
      items: rows.slice(0, limit).map((row) => rowToProfile(row, viewerUserId)),
      ...(rows.length > limit ? { nextCursor: String(offset + limit) } : {}),
    };
  }
}

const PUBLIC_USER_SELECT = `SELECT users.id, users.display_name, users.signature, users.is_admin,
  avatar.public_path AS avatar_url, users.created_at,
  (SELECT COUNT(*) FROM user_follows followers WHERE followers.followed_user_id = users.id) AS follower_count,
  (SELECT COUNT(*) FROM user_follows following WHERE following.follower_user_id = users.id) AS following_count,
  EXISTS(SELECT 1 FROM user_follows vf
         WHERE vf.follower_user_id = ? AND vf.followed_user_id = users.id) AS viewer_is_following,
  EXISTS(SELECT 1 FROM user_follows fv
         WHERE fv.follower_user_id = users.id AND fv.followed_user_id = ?) AS follows_viewer
 FROM users
 LEFT JOIN user_resources avatar_link
   ON avatar_link.user_id = users.id AND avatar_link.usage_kind = 'avatar'
 LEFT JOIN resources avatar ON avatar.id = avatar_link.resource_id`;

function rowToProfile(
  row: PublicUserRow,
  viewerUserId: string | null,
): PublicUserProfile {
  const viewerIsFollowing = Boolean(row.viewer_is_following);
  const followsViewer = Boolean(row.follows_viewer);
  return {
    id: row.id,
    displayName: row.display_name,
    ...(row.avatar_url ? { avatarUrl: row.avatar_url } : {}),
    isAdmin: Boolean(row.is_admin),
    signature: row.signature,
    createdAt: row.created_at,
    followerCount: Number(row.follower_count),
    followingCount: Number(row.following_count),
    viewerIsFollowing,
    followsViewer,
    isMutual: viewerIsFollowing && followsViewer,
    isSelf: row.id === viewerUserId,
  };
}
