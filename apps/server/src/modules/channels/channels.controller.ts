import type { FastifyInstance } from "fastify";
import { InterfaceBindingsService } from "./channels.service.js";

export async function registerInterfaceBindingRoutes(app: FastifyInstance) {
  const bindings = new InterfaceBindingsService();
  app.get("/", async () => bindings.listBindings());
}
