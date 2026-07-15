import type { ModelRecommendationCategory } from "@echoo/shared";
import type { FastifyInstance } from "fastify";
import { PlatformCatalogService } from "./platform-catalog.service.js";

const categories = new Set<ModelRecommendationCategory>([
  "slice_text",
  "prime_decision",
  "image_generation",
  "image_optimization",
  "voice_optimization",
  "visual_understanding",
  "audio_understanding",
  "fish_tts",
]);

export async function registerPlatformCatalogRoutes(app: FastifyInstance) {
  const service = new PlatformCatalogService();
  app.get<{ Querystring: { category?: string } }>(
    "/platform/recommendations",
    async (request, reply) => {
      const category = request.query.category as ModelRecommendationCategory;
      if (!categories.has(category))
        return reply
          .code(400)
          .send({ error: "INVALID_CATEGORY", message: "推荐模型分类无效。" });
      return service.getRecommendations(category);
    },
  );
}

export function isRecommendationCategory(
  value: string,
): value is ModelRecommendationCategory {
  return categories.has(value as ModelRecommendationCategory);
}
