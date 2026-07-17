import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import {
  createPrimeFigureSchema,
  createSliceFigureSchema,
} from "@echoo/shared";
import {
  CharacterAssetForbiddenError,
  CharacterAssetNotFoundError,
  CharacterAssetService,
} from "./character-asset.service.js";

const installSchema = z.object({
  applyRecommendedRuntimeConfig: z.boolean().default(false),
});
const recommendationSchema = z.object({
  enabled: z.boolean(),
  config: z.record(z.string(), z.unknown()).optional(),
});

export async function registerCharacterAssetRoutes(app: FastifyInstance) {
  const assets = new CharacterAssetService();

  app.get<{
    Querystring: {
      limit?: string;
      cursor?: string;
      q?: string;
      sort?: "quality" | "latest";
    };
  }>("/character-assets", async (request, reply) => {
    const userId = await request.optionalUserId();
    return assets.listPublished(userId, {
      limit: Number(request.query.limit) || 24,
      cursor: request.query.cursor,
      query: request.query.q,
      sort: request.query.sort,
    });
  });

  app.get("/users/me/character-assets", async (request, reply) => {
    const userId = await request.requireUserId(reply);
    if (!userId) return;
    return assets.listMine(userId);
  });

  app.get<{ Params: { assetId: string } }>(
    "/character-assets/:assetId",
    async (request, reply) => {
      const userId = await request.optionalUserId();
      try {
        return await assets.getVisible(userId, request.params.assetId);
      } catch (error) {
        return assetError(reply, error);
      }
    },
  );

  app.post<{ Params: { agentId: string } }>(
    "/agents/:agentId/character-asset-draft",
    async (request, reply) => {
      const userId = await request.requireUserId(reply);
      if (!userId) return;
      try {
        return await assets.createDraft(userId, request.params.agentId);
      } catch (error) {
        return assetError(reply, error);
      }
    },
  );

  app.get<{ Params: { assetId: string } }>(
    "/character-assets/:assetId/draft",
    async (request, reply) => {
      const userId = await request.requireUserId(reply);
      if (!userId) return;
      try {
        return await assets.getDraft(userId, request.params.assetId);
      } catch (error) {
        return assetError(reply, error);
      }
    },
  );

  app.patch<{ Params: { assetId: string }; Body: unknown }>(
    "/character-assets/:assetId/draft/character",
    { bodyLimit: 96 * 1024 * 1024 },
    async (request, reply) => {
      const userId = await request.requireUserId(reply);
      if (!userId) return;
      const parsed = z
        .union([createSliceFigureSchema, createPrimeFigureSchema])
        .safeParse(request.body);
      if (!parsed.success)
        return reply.code(400).send({
          error: "VALIDATION_ERROR",
          message: parsed.error.issues[0]?.message ?? "公共角色数据无效。",
        });
      try {
        return await assets.saveDraftCharacter(
          userId,
          request.params.assetId,
          parsed.data,
        );
      } catch (error) {
        return assetError(reply, error);
      }
    },
  );

  app.patch<{ Params: { assetId: string }; Body: unknown }>(
    "/character-assets/:assetId/draft/recommendation",
    async (request, reply) => {
      const userId = await request.requireUserId(reply);
      if (!userId) return;
      const parsed = recommendationSchema.safeParse(request.body);
      if (!parsed.success)
        return reply.code(400).send({ error: "VALIDATION_ERROR" });
      try {
        return await assets.saveDraftRecommendation(
          userId,
          request.params.assetId,
          parsed.data,
        );
      } catch (error) {
        return assetError(reply, error);
      }
    },
  );

  app.post<{ Params: { assetId: string } }>(
    "/character-assets/:assetId/publish",
    async (request, reply) => {
      const userId = await request.requireUserId(reply);
      if (!userId) return;
      try {
        return await assets.publishDraft(userId, request.params.assetId);
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

  app.post<{ Params: { assetId: string }; Body: unknown }>(
    "/character-assets/:assetId/install/update",
    async (request, reply) => {
      const userId = await request.requireUserId(reply);
      if (!userId) return;
      const parsed = installSchema.safeParse(request.body ?? {});
      if (!parsed.success)
        return reply.code(400).send({ error: "VALIDATION_ERROR" });
      try {
        return await assets.updateInstallation(
          userId,
          request.params.assetId,
          parsed.data.applyRecommendedRuntimeConfig,
        );
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
  if (error instanceof CharacterAssetForbiddenError)
    return reply
      .code(409)
      .send({ error: "CHARACTER_ASSET_FORBIDDEN", message: error.message });
  throw error;
}
