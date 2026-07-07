import type { FastifyInstance } from "fastify";
import { AuthService } from "./auth.service.js";
import type { LoginBody } from "./auth.types.js";

export async function registerAuthRoutes(app: FastifyInstance) {
  const authService = new AuthService(app);

  app.post<{ Body: LoginBody }>("/login", async (request) => {
    return authService.login(request.body.email);
  });
}
