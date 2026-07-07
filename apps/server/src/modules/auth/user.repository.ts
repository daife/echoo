import { randomUUID } from "node:crypto";
import type { UserProfile } from "@echoo/shared";
import { getDatabase } from "../../infra/database/sqlite.js";

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

export interface EmailVerificationToken {
  token: string;
  userId: string;
  expiresAt: number;
  usedAt?: number;
}

export class UserRepository {
  private readonly db = getDatabase();

  findByEmail(email: string) {
    return rowToUser(
      this.db
        .prepare("SELECT * FROM auth_users WHERE email = ?")
        .get(email.toLowerCase()) as AuthUserRow | undefined,
    );
  }

  findById(userId: string) {
    return rowToUser(
      this.db.prepare("SELECT * FROM auth_users WHERE id = ?").get(userId) as
        AuthUserRow | undefined,
    );
  }

  create(input: { email: string; passwordHash: string; displayName: string }) {
    const email = input.email.toLowerCase();
    const now = Date.now();
    const user: AuthUser = {
      id: `user_${randomUUID()}`,
      email,
      displayName: input.displayName,
      passwordHash: input.passwordHash,
      createdAt: now,
      updatedAt: now,
    };

    this.db
      .prepare(
        `
          INSERT INTO auth_users (
            id,
            email,
            display_name,
            password_hash,
            created_at,
            updated_at,
            email_verified_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        user.id,
        user.email,
        user.displayName,
        user.passwordHash,
        user.createdAt,
        user.updatedAt,
        user.emailVerifiedAt ?? null,
      );

    return user;
  }

  markEmailVerified(userId: string) {
    const now = Date.now();
    this.db
      .prepare(
        "UPDATE auth_users SET email_verified_at = ?, updated_at = ? WHERE id = ?",
      )
      .run(now, now, userId);
    return this.findById(userId);
  }

  updatePassword(userId: string, passwordHash: string) {
    this.db
      .prepare(
        "UPDATE auth_users SET password_hash = ?, updated_at = ? WHERE id = ?",
      )
      .run(passwordHash, Date.now(), userId);
    return this.findById(userId);
  }

  createPasswordResetToken(userId: string) {
    const now = Date.now();
    const token: PasswordResetToken = {
      token: randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, ""),
      userId,
      expiresAt: now + 30 * 60 * 1000,
    };

    this.db
      .prepare(
        "INSERT INTO password_reset_tokens (token, user_id, expires_at, used_at, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(
        token.token,
        token.userId,
        token.expiresAt,
        token.usedAt ?? null,
        now,
      );

    return token;
  }

  createEmailVerificationToken(userId: string) {
    const now = Date.now();
    const token: EmailVerificationToken = {
      token: randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, ""),
      userId,
      expiresAt: now + 24 * 60 * 60 * 1000,
    };

    this.db
      .prepare(
        "INSERT INTO email_verification_tokens (token, user_id, expires_at, used_at, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(
        token.token,
        token.userId,
        token.expiresAt,
        token.usedAt ?? null,
        now,
      );

    return token;
  }

  findEmailVerificationToken(token: string) {
    return rowToEmailVerificationToken(
      this.db
        .prepare("SELECT * FROM email_verification_tokens WHERE token = ?")
        .get(token) as EmailVerificationTokenRow | undefined,
    );
  }

  markEmailVerificationTokenUsed(token: string) {
    this.db
      .prepare(
        "UPDATE email_verification_tokens SET used_at = ? WHERE token = ?",
      )
      .run(Date.now(), token);
  }

  findPasswordResetToken(token: string) {
    return rowToPasswordResetToken(
      this.db
        .prepare("SELECT * FROM password_reset_tokens WHERE token = ?")
        .get(token) as PasswordResetTokenRow | undefined,
    );
  }

  markPasswordResetTokenUsed(token: string) {
    this.db
      .prepare("UPDATE password_reset_tokens SET used_at = ? WHERE token = ?")
      .run(Date.now(), token);
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

function rowToUser(row?: AuthUserRow | null): AuthUser | null {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    passwordHash: row.password_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.email_verified_at
      ? { emailVerifiedAt: row.email_verified_at }
      : {}),
  };
}

function rowToPasswordResetToken(
  row?: PasswordResetTokenRow | null,
): PasswordResetToken | null {
  if (!row) return null;
  return {
    token: row.token,
    userId: row.user_id,
    expiresAt: row.expires_at,
    ...(row.used_at ? { usedAt: row.used_at } : {}),
  };
}

function rowToEmailVerificationToken(
  row?: EmailVerificationTokenRow | null,
): EmailVerificationToken | null {
  if (!row) return null;
  return {
    token: row.token,
    userId: row.user_id,
    expiresAt: row.expires_at,
    ...(row.used_at ? { usedAt: row.used_at } : {}),
  };
}

interface AuthUserRow {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
  created_at: number;
  updated_at: number;
  email_verified_at: number | null;
}

interface PasswordResetTokenRow {
  token: string;
  user_id: string;
  expires_at: number;
  used_at: number | null;
}

interface EmailVerificationTokenRow {
  token: string;
  user_id: string;
  expires_at: number;
  used_at: number | null;
}
