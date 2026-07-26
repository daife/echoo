import assert from "node:assert/strict";
import { mock, test } from "node:test";
import type { FastifyInstance } from "fastify";
import { accessTokenTtlMs } from "./token.service.js";
import { AuthError, AuthService } from "./auth.service.js";

const user = {
  id: "user_1",
  email: "aether@example.test",
  displayName: "Aether",
  signature: "",
  isAdmin: false,
  emailVerifiedAt: 1,
  passwordHash: "hash",
  createdAt: 1,
  updatedAt: 1,
};

test("refresh returns the same refresh token and a 24 hour access token", async () => {
  const renew = mock.fn(async (token: string) => ({
    userId: user.id,
    token,
    expiresAt: Date.now() + 90 * 24 * 60 * 60_000,
  }));
  const service = createService({ renew });
  const startedAt = Date.now();

  const session = await service.refresh("stable-refresh-token");

  assert.equal(session.tokens.refreshToken, "stable-refresh-token");
  assert.equal(session.tokens.accessToken, "access-token");
  assert.ok(session.tokens.expiresAt >= startedAt + accessTokenTtlMs);
  assert.ok(session.tokens.expiresAt <= Date.now() + accessTokenTtlMs);
  assert.deepEqual(renew.mock.calls[0]?.arguments, ["stable-refresh-token"]);
});

test("refresh rejects invalid sessions with an unauthorized auth error", async () => {
  const service = createService({ renew: async () => null });

  await assert.rejects(service.refresh("invalid-refresh-token"), (error) => {
    assert.ok(error instanceof AuthError);
    assert.equal(error.code, "REFRESH_TOKEN_INVALID");
    assert.equal(error.statusCode, 401);
    return true;
  });
});

function createService(sessions: object) {
  const app = {
    jwt: {
      sign: () => "access-token",
    },
  } as unknown as FastifyInstance;
  const users = {
    findById: async () => user,
  };

  return new AuthService(
    app,
    users as never,
    {} as never,
    {} as never,
    {} as never,
    sessions as never,
    {} as never,
    {} as never,
  );
}
