import type { FastifyInstance } from "fastify";
import { TokenService } from "./token.service.js";

export class AuthService {
  private readonly tokenService: TokenService;

  constructor(app: FastifyInstance) {
    this.tokenService = new TokenService(app);
  }

  async login(email: string) {
    const userId = `user_${Buffer.from(email).toString("base64url").slice(0, 12)}`;
    return {
      user: {
        id: userId,
        email,
        displayName: email.split("@")[0] ?? "Echoo User",
        createdAt: Date.now()
      },
      tokens: {
        accessToken: this.tokenService.createAccessToken(userId),
        refreshToken: this.tokenService.createRefreshToken(userId),
        expiresAt: Date.now() + 15 * 60 * 1000
      }
    };
  }
}
