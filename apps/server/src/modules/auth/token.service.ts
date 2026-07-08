import type { FastifyInstance } from "fastify";

export const accessTokenTtlMs = 30 * 24 * 60 * 60 * 1000;
export const accessTokenExpiresIn = "30d";

export class TokenService {
  constructor(private readonly app: FastifyInstance) {}

  createAccessToken(userId: string) {
    return this.app.jwt.sign({ sub: userId }, { expiresIn: accessTokenExpiresIn });
  }

  createRefreshToken(userId: string) {
    return this.app.jwt.sign({ sub: userId, type: "refresh" }, { expiresIn: "30d" });
  }
}
