import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { RowDataPacket } from "mysql2";
import type {
  execute,
  queryOne,
  withTransaction,
} from "../../infra/database/mysql.js";
import {
  AuthSessionRepository,
  refreshSessionTtlMs,
} from "./auth-session.repository.js";

interface StoredSession {
  id: string;
  user_id: string;
  refresh_token_hash: string;
  expires_at: number;
  revoked_at: number | null;
  created_at: number;
  updated_at: number;
}

test("refresh tokens remain reusable and renew for 90 days", async () => {
  const { repository, sessions } = createRepository();
  const created = await repository.create("user_1");

  const first = await repository.renew(created.token);
  const second = await repository.renew(created.token);

  assert.equal(first?.token, created.token);
  assert.equal(second?.token, created.token);
  assert.equal(first?.userId, "user_1");
  assert.equal(second?.userId, "user_1");
  assert.equal(sessions.size, 1);
  assert.ok(
    Math.abs((second?.expiresAt ?? 0) - Date.now() - refreshSessionTtlMs) < 1_000,
  );
});

test("concurrent refreshes of one session all succeed", async () => {
  const { repository } = createRepository();
  const created = await repository.create("user_1");

  const renewed = await Promise.all(
    Array.from({ length: 4 }, () => repository.renew(created.token)),
  );

  assert.equal(renewed.every((session) => session?.token === created.token), true);
});

test("sessions for the same user refresh and revoke independently", async () => {
  const { repository } = createRepository();
  const first = await repository.create("user_1");
  const second = await repository.create("user_1");

  await repository.revoke(first.token);

  assert.equal(await repository.renew(first.token), null);
  assert.equal((await repository.renew(second.token))?.token, second.token);
});

test("unknown, expired, and revoked refresh tokens are rejected", async () => {
  const { repository, sessions } = createRepository();
  const expired = await repository.create("user_1");
  sessions.get(tokenHash(expired.token))!.expires_at = Date.now() - 1;
  const revoked = await repository.create("user_1");
  sessions.get(tokenHash(revoked.token))!.revoked_at = Date.now();

  assert.equal(await repository.renew("unknown"), null);
  assert.equal(await repository.renew(expired.token), null);
  assert.equal(await repository.renew(revoked.token), null);
});

function createRepository() {
  const sessions = new Map<string, StoredSession>();
  let transactionQueue = Promise.resolve();
  const connection = {};

  const run = async (sql: string, values: unknown[]) => {
    if (sql.includes("INSERT INTO auth_sessions")) {
      const [id, userId, refreshTokenHash, expiresAt, createdAt, updatedAt] =
        values as [string, string, string, number, number, number];
      sessions.set(refreshTokenHash, {
        id,
        user_id: userId,
        refresh_token_hash: refreshTokenHash,
        expires_at: expiresAt,
        revoked_at: null,
        created_at: createdAt,
        updated_at: updatedAt,
      });
    } else if (sql.includes("SET expires_at")) {
      const [expiresAt, updatedAt, id] = values as [number, number, string];
      const session = [...sessions.values()].find((row) => row.id === id);
      if (session) {
        session.expires_at = expiresAt;
        session.updated_at = updatedAt;
      }
    } else if (sql.includes("SET revoked_at")) {
      const [revokedAt, updatedAt, refreshTokenHash] = values as [
        number,
        number,
        string,
      ];
      const session = sessions.get(refreshTokenHash);
      if (session && session.revoked_at === null) {
        session.revoked_at = revokedAt;
        session.updated_at = updatedAt;
      }
    }
    return { affectedRows: 1 };
  };

  const findOne = async <T extends RowDataPacket>(
    _sql: string,
    values: unknown[],
  ) =>
    (sessions.get(String(values[0])) as unknown as T | undefined) ?? null;

  const transaction = <T>(callback: (value: never) => Promise<T>) => {
    const result = transactionQueue.then(() => callback(connection as never));
    transactionQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  return {
    sessions,
    repository: new AuthSessionRepository({
      execute: run as unknown as typeof execute,
      queryOne: findOne as typeof queryOne,
      withTransaction: transaction as typeof withTransaction,
    }),
  };
}

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
