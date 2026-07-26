import type { FastifyInstance } from "fastify";

export const accessTokenTtlMs = 24 * 60 * 60 * 1000;
export const accessTokenExpiresIn = "24h";

export class TokenService {
  constructor(private readonly app: FastifyInstance) {}

  createAccessToken(userId: string) {
    return this.app.jwt.sign(
      { sub: userId },
      { expiresIn: accessTokenExpiresIn },
    );
  }

}
