import { createHash, randomBytes } from "node:crypto";
import type { UserProfile } from "@echoo/shared";
import type { RowDataPacket } from "mysql2";
import {
  execute,
  queryOne,
  withTransaction,
} from "../../infra/database/mysql.js";
import { createId } from "../../shared/utils/id.js";

export interface AuthUser extends UserProfile {
  passwordHash: string;
  updatedAt: number;
}

export interface PasswordResetToken {
  token: string;
  userId: string;
  expiresAt: number;
  usedAt?: number;
}

export type EmailVerificationToken = PasswordResetToken;
type TokenKind = "email_verification" | "password_reset";

interface AuthUserRow extends RowDataPacket {
  id: string;
  email: string;
  display_name: string;
  signature: string;
  avatar_url: string | null;
  password_hash: string;
  created_at: number;
  updated_at: number;
  email_verified_at: number | null;
}

interface TokenRow extends RowDataPacket {
  user_id: string;
  expires_at: number;
  used_at: number | null;
}

export class UserRepository {
  async findByEmail(email: string) {
    return rowToUser(
      await queryOne<AuthUserRow>(`${userProfileQuery} WHERE users.email = ?`, [
        email.toLowerCase(),
      ]),
    );
  }

  async findById(userId: string) {
    return rowToUser(
      await queryOne<AuthUserRow>(`${userProfileQuery} WHERE users.id = ?`, [
        userId,
      ]),
    );
  }

  async create(input: {
    email: string;
    passwordHash: string;
    displayName: string;
  }) {
    const now = Date.now();
    const user: AuthUser = {
      id: createId("user"),
      email: input.email.toLowerCase(),
      displayName: input.displayName,
      signature: "",
      passwordHash: input.passwordHash,
      createdAt: now,
      updatedAt: now,
    };
    await execute(
      `INSERT INTO users
       (id, email, display_name, password_hash, email_verified_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, ?, ?)`,
      [user.id, user.email, user.displayName, user.passwordHash, now, now],
    );
    return user;
  }

  async updateProfile(
    userId: string,
    input: {
      displayName?: string;
      signature?: string;
      avatarResourceId?: string | null;
    },
  ) {
    await withTransaction(async (connection) => {
      const assignments = ["updated_at = ?"];
      const values: unknown[] = [Date.now()];
      if (input.displayName !== undefined) {
        assignments.push("display_name = ?");
        values.push(input.displayName);
      }
      if (input.signature !== undefined) {
        assignments.push("signature = ?");
        values.push(input.signature);
      }
      values.push(userId);
      await execute(
        `UPDATE users SET ${assignments.join(", ")} WHERE id = ?`,
        values,
        connection,
      );

      if (input.avatarResourceId !== undefined) {
        await execute(
          "DELETE FROM user_resources WHERE user_id = ? AND usage_kind = 'avatar'",
          [userId],
          connection,
        );
        if (input.avatarResourceId) {
          await execute(
            `INSERT INTO user_resources
             (user_id, usage_kind, resource_id, created_at)
             VALUES (?, 'avatar', ?, ?)`,
            [userId, input.avatarResourceId, Date.now()],
            connection,
          );
        }
      }
    });
    return this.findById(userId);
  }

  async markEmailVerified(userId: string) {
    const now = Date.now();
    await execute(
      "UPDATE users SET email_verified_at = ?, updated_at = ? WHERE id = ?",
      [now, now, userId],
    );
    return this.findById(userId);
  }

  async updatePassword(userId: string, passwordHash: string) {
    await execute(
      "UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?",
      [passwordHash, Date.now(), userId],
    );
    return this.findById(userId);
  }

  createPasswordResetToken(userId: string) {
    return this.createToken(userId, "password_reset", 30 * 60_000);
  }

  createEmailVerificationToken(userId: string) {
    return this.createToken(userId, "email_verification", 24 * 60 * 60_000);
  }

  findEmailVerificationToken(token: string) {
    return this.findToken(token, "email_verification");
  }

  markEmailVerificationTokenUsed(token: string) {
    return this.markTokenUsed(token, "email_verification");
  }

  findPasswordResetToken(token: string) {
    return this.findToken(token, "password_reset");
  }

  markPasswordResetTokenUsed(token: string) {
    return this.markTokenUsed(token, "password_reset");
  }

  private async createToken(userId: string, kind: TokenKind, ttl: number) {
    const now = Date.now();
    const token = randomBytes(32).toString("base64url");
    const value: PasswordResetToken = {
      token,
      userId,
      expiresAt: now + ttl,
    };
    await execute(
      `INSERT INTO auth_tokens
       (token_hash, user_id, kind, expires_at, used_at, created_at)
       VALUES (?, ?, ?, ?, NULL, ?)`,
      [hashToken(token), userId, kind, value.expiresAt, now],
    );
    return value;
  }

  private async findToken(token: string, kind: TokenKind) {
    const row = await queryOne<TokenRow>(
      "SELECT user_id, expires_at, used_at FROM auth_tokens WHERE token_hash = ? AND kind = ?",
      [hashToken(token), kind],
    );
    if (!row) return null;
    return {
      token,
      userId: row.user_id,
      expiresAt: row.expires_at,
      ...(row.used_at ? { usedAt: row.used_at } : {}),
    };
  }

  private async markTokenUsed(token: string, kind: TokenKind) {
    await execute(
      "UPDATE auth_tokens SET used_at = ? WHERE token_hash = ? AND kind = ?",
      [Date.now(), hashToken(token), kind],
    );
  }
}

export function toUserProfile(user: AuthUser): UserProfile {
  const {
    passwordHash: _passwordHash,
    updatedAt: _updatedAt,
    ...profile
  } = user;
  return profile;
}

function rowToUser(row: AuthUserRow | null): AuthUser | null {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    signature: row.signature,
    passwordHash: row.password_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.email_verified_at
      ? { emailVerifiedAt: row.email_verified_at }
      : {}),
    ...(row.avatar_url ? { avatarUrl: row.avatar_url } : {}),
  };
}

const userProfileQuery = `
  SELECT users.*, avatar.public_path AS avatar_url
  FROM users
  LEFT JOIN user_resources
    ON user_resources.user_id = users.id
   AND user_resources.usage_kind = 'avatar'
  LEFT JOIN resources avatar ON avatar.id = user_resources.resource_id`;

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
