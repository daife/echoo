import type { FastifyInstance } from "fastify";
import { PlatformSettingsService } from "./platform-settings.service.js";

export async function registerSiteContentRoutes(app: FastifyInstance) {
  const settings = new PlatformSettingsService();

  app.get("/site-content", () => settings.getSiteContent());
}
