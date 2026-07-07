import type { FastifyInstance } from "fastify";

export class TokenService {
  constructor(private readonly app: FastifyInstance) {}

  createAccessToken(userId: string) {
    return this.app.jwt.sign({ sub: userId }, { expiresIn: "15m" });
  }

  createRefreshToken(userId: string) {
    return this.app.jwt.sign({ sub: userId, type: "refresh" }, { expiresIn: "30d" });
  }
}
