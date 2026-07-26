import assert from "node:assert/strict";
import test from "node:test";
import type { FastifyInstance } from "fastify";
import {
  accessTokenExpiresIn,
  accessTokenTtlMs,
  TokenService,
} from "./token.service.js";

test("access tokens use a 24 hour lifetime", () => {
  let expiresIn: string | number | undefined;
  const app = {
    jwt: {
      sign: (_payload: unknown, options: { expiresIn: string | number }) => {
        expiresIn = options.expiresIn;
        return "access-token";
      },
    },
  } as FastifyInstance;

  const token = new TokenService(app).createAccessToken("user_1");

  assert.equal(token, "access-token");
  assert.equal(expiresIn, "24h");
  assert.equal(accessTokenExpiresIn, "24h");
  assert.equal(accessTokenTtlMs, 24 * 60 * 60 * 1_000);
});
