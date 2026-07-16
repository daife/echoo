import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import {
  CharacterAssetNotFoundError,
  CharacterAssetService,
} from "./character-asset.service.js";

const publishSchema = z.object({
  includeRecommendedRuntimeConfig: z.boolean().default(false),
});
const installSchema = z.object({
  applyRecommendedRuntimeConfig: z.boolean().default(false),
});

export async function registerCharacterAssetRoutes(app: FastifyInstance) {
  const assets = new CharacterAssetService();

  app.get<{ Querystring: { limit?: string } }>(
    "/character-assets",
    async (request, reply) => {
      const userId = await request.requireUserId(reply);
      if (!userId) return;
      return assets.listPublished(userId, Number(request.query.limit) || 50);
    },
  );

  app.get<{ Params: { assetId: string } }>(
    "/character-assets/:assetId",
    async (request, reply) => {
      const userId = await request.requireUserId(reply);
      if (!userId) return;
      try {
        return await assets.getVisible(userId, request.params.assetId);
      } catch (error) {
        return assetError(reply, error);
      }
    },
  );

  app.post<{ Params: { agentId: string }; Body: unknown }>(
    "/agents/:agentId/publish",
    async (request, reply) => {
      const userId = await request.requireUserId(reply);
      if (!userId) return;
      const parsed = publishSchema.safeParse(request.body ?? {});
      if (!parsed.success)
        return reply.code(400).send({
          error: "VALIDATION_ERROR",
          message: parsed.error.issues[0]?.message,
        });
      try {
        return await assets.publish(
          userId,
          request.params.agentId,
          parsed.data.includeRecommendedRuntimeConfig,
        );
      } catch (error) {
        return assetError(reply, error);
      }
    },
  );

  app.post<{ Params: { assetId: string }; Body: unknown }>(
    "/character-assets/:assetId/unlist",
    async (request, reply) => {
      const userId = await request.requireUserId(reply);
      if (!userId) return;
      try {
        await assets.unlist(userId, request.params.assetId);
        return { ok: true };
      } catch (error) {
        return assetError(reply, error);
      }
    },
  );

  app.post<{ Params: { assetId: string } }>(
    "/character-assets/:assetId/install",
    async (request, reply) => {
      const userId = await request.requireUserId(reply);
      if (!userId) return;
      const parsed = installSchema.safeParse(request.body ?? {});
      if (!parsed.success)
        return reply.code(400).send({ error: "VALIDATION_ERROR" });
      try {
        return await assets.install(
          userId,
          request.params.assetId,
          parsed.data.applyRecommendedRuntimeConfig,
        );
      } catch (error) {
        return assetError(reply, error);
      }
    },
  );

  app.post<{ Params: { assetId: string } }>(
    "/character-assets/:assetId/install/update",
    async (request, reply) => {
      const userId = await request.requireUserId(reply);
      if (!userId) return;
      try {
        return await assets.updateInstallation(userId, request.params.assetId);
      } catch (error) {
        return assetError(reply, error);
      }
    },
  );
}

function assetError(reply: FastifyReply, error: unknown) {
  if (error instanceof CharacterAssetNotFoundError)
    return reply
      .code(404)
      .send({ error: "CHARACTER_ASSET_NOT_FOUND", message: error.message });
  throw error;
}
