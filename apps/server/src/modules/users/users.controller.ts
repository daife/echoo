import type { FastifyInstance } from "fastify";
import { UsersService } from "./users.service.js";

export async function registerUsersRoutes(app: FastifyInstance) {
  const users = new UsersService();
  app.get("/me", async () => users.getCurrentUser("demo"));
}
