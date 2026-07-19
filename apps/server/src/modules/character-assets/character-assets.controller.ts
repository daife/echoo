import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import {
  createPrimeFigureSchema,
  createSliceFigureSchema,
} from "@echoo/shared";
import {
  CharacterAssetForbiddenError,
  CharacterAssetNotFoundError,
  CharacterAssetQueryError,
  CharacterAssetService,
} from "./character-asset.service.js";

const installSchema = z.object({
  applyRecommendedRuntimeConfig: z.boolean().default(false),
});
const recommendationSchema = z.object({
  enabled: z.boolean(),
  config: z.record(z.string(), z.unknown()).optional(),
});
const createDraftSchema = z.union([
  z.object({ type: z.enum(["slice-figure", "prime-figure"]) }).strict(),
  z
    .object({ importFromOriginalAgentId: z.string().trim().min(1).max(120) })
    .strict(),
]);
const publicListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(24).default(12),
  cursor: z.string().max(1024).optional(),
  q: z
    .string()
    .transform((value) => value.trim().replace(/\s+/g, " "))
    .refine((value) => value.length === 0 || value.length >= 2)
    .refine((value) => value.length <= 50)
    .optional(),
});
const featuredQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(12).default(6),
});

export async function registerCharacterAssetRoutes(app: FastifyInstance) {
  const assets = new CharacterAssetService();

  app.get<{
    Querystring: {
      limit?: string;
      cursor?: string;
      q?: string;
    };
  }>("/character-assets", async (request, reply) => {
    const parsed = publicListQuerySchema.safeParse(request.query);
    if (!parsed.success)
      return reply.code(400).send({
        error: "VALIDATION_ERROR",
        message: "搜索词需为 2 至 50 个字符，分页参数必须有效。",
      });
    const userId = await request.optionalUserId();
    try {
      return await assets.listPublished(userId, {
        limit: parsed.data.limit,
        cursor: parsed.data.cursor,
        query: parsed.data.q,
      });
    } catch (error) {
      return assetError(reply, error);
    }
  });

  app.get<{ Querystring: { limit?: string } }>(
    "/character-assets/featured",
    async (request, reply) => {
      const parsed = featuredQuerySchema.safeParse(request.query);
      if (!parsed.success)
        return reply.code(400).send({ error: "VALIDATION_ERROR" });
      return assets.listFeatured(
        await request.optionalUserId(),
        parsed.data.limit,
      );
    },
  );

  app.get("/users/me/character-assets", async (request, reply) => {
    const userId = await request.requireUserId(reply);
    if (!userId) return;
    return assets.listMine(userId);
  });

  app.get<{
    Params: { userId: string };
    Querystring: { limit?: string; cursor?: string };
  }>("/users/:userId/character-assets", async (request) =>
    assets.listPublishedByAuthor(
      await request.optionalUserId(),
      request.params.userId,
      {
        limit: Number(request.query.limit) || 24,
        cursor: request.query.cursor,
      },
    ),
  );

  app.get<{ Querystring: { limit?: string; cursor?: string } }>(
    "/feeds/following/character-assets",
    async (request, reply) => {
      const userId = await request.requireUserId(reply);
      if (!userId) return;
      return assets.listFollowing(userId, {
        limit: Number(request.query.limit) || 24,
        cursor: request.query.cursor,
      });
    },
  );

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

  app.post<{ Body: unknown }>(
    "/character-assets/drafts",
    async (request, reply) => {
      const userId = await request.requireUserId(reply);
      if (!userId) return;
      const parsed = createDraftSchema.safeParse(request.body);
      if (!parsed.success)
        return reply.code(400).send({ error: "VALIDATION_ERROR" });
      try {
        return await assets.createDraft(userId, parsed.data);
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

  app.delete<{ Params: { assetId: string } }>(
    "/character-assets/:assetId",
    async (request, reply) => {
      const userId = await request.requireUserId(reply);
      if (!userId) return;
      try {
        await assets.deleteAsset(userId, request.params.assetId);
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
  if (error instanceof CharacterAssetQueryError)
    return reply
      .code(400)
      .send({ error: "INVALID_CURSOR", message: error.message });
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
