import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import {
  createPrimeFigureSchema,
  createPrimeWorldSchema,
  createSliceFigureSchema,
  primeWorldExportBundleSchema,
} from "@echoo/shared";
import type {
  CreatePrimeFigureRequest,
  CreatePrimeWorldRequest,
  CreateSliceFigureRequest,
} from "@echoo/shared";
import {
  createPublicAssetDraftSchema,
  installPublicAssetSchema,
  savePublicAssetRecommendationSchema,
} from "@echoo/shared/public-assets";
import {
  PublicAssetForbiddenError,
  PublicAssetNotFoundError,
  PublicAssetQueryError,
  PublicAssetService,
} from "./public-asset.service.js";
import { PrimeWorldCompileError } from "../agents/kinds/prime-world/prime-world-compiler.js";

const publicListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(24).default(12),
  cursor: z.string().max(1024).optional(),
  q: z
    .string()
    .transform((value) => value.trim().replace(/\s+/g, " "))
    .refine((value) => value.length === 0 || value.length >= 2)
    .refine((value) => value.length <= 50)
    .optional(),
  type: z.enum(["slice-figure", "prime-figure", "prime-world"]).optional(),
});
const featuredQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(12).default(6),
});
const assetFeedQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(24),
  cursor: z.string().max(1024).optional(),
  type: z.enum(["slice-figure", "prime-figure", "prime-world"]).optional(),
});

export async function registerPublicAssetRoutes(app: FastifyInstance) {
  const assets = new PublicAssetService();

  app.get<{
    Querystring: {
      limit?: string;
      cursor?: string;
      q?: string;
      type?: string;
    };
  }>("/public-assets", async (request, reply) => {
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
        type: parsed.data.type,
      });
    } catch (error) {
      return assetError(reply, error);
    }
  });

  app.get<{ Querystring: { limit?: string } }>(
    "/public-assets/featured",
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

  app.get("/users/me/public-assets", async (request, reply) => {
    const userId = await request.requireUserId(reply);
    if (!userId) return;
    return assets.listMine(userId);
  });

  app.get<{
    Params: { userId: string };
    Querystring: { limit?: string; cursor?: string; type?: string };
  }>("/users/:userId/public-assets", async (request, reply) => {
    const parsed = assetFeedQuerySchema.safeParse(request.query);
    if (!parsed.success)
      return reply.code(400).send({ error: "VALIDATION_ERROR" });
    return assets.listPublishedByAuthor(
      await request.optionalUserId(),
      request.params.userId,
      parsed.data,
    );
  });

  app.get<{
    Querystring: { limit?: string; cursor?: string; type?: string };
  }>(
    "/feeds/following/public-assets",
    async (request, reply) => {
      const userId = await request.requireUserId(reply);
      if (!userId) return;
      const parsed = assetFeedQuerySchema.safeParse(request.query);
      if (!parsed.success)
        return reply.code(400).send({ error: "VALIDATION_ERROR" });
      return assets.listFollowing(userId, parsed.data);
    },
  );

  app.get<{ Params: { assetId: string } }>(
    "/public-assets/:assetId",
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
    "/public-assets/drafts",
    async (request, reply) => {
      const userId = await request.requireUserId(reply);
      if (!userId) return;
      const parsed = createPublicAssetDraftSchema.safeParse(request.body);
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
    "/public-assets/:assetId/draft",
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
    "/public-assets/:assetId/draft/content",
    { bodyLimit: 96 * 1024 * 1024 },
    async (request, reply) => {
      const userId = await request.requireUserId(reply);
      if (!userId) return;
      const parsed = z
        .union([createSliceFigureSchema, createPrimeFigureSchema, createPrimeWorldSchema])
        .safeParse(request.body);
      if (!parsed.success)
        return reply.code(400).send({
          error: "VALIDATION_ERROR",
          message: parsed.error.issues[0]?.message ?? "公共资产数据无效。",
        });
      try {
        return await assets.saveDraftContent(
          userId,
          request.params.assetId,
          parsed.data as
            | CreateSliceFigureRequest
            | CreatePrimeFigureRequest
            | CreatePrimeWorldRequest,
        );
      } catch (error) {
        return assetError(reply, error);
      }
    },
  );

  app.patch<{ Params: { assetId: string }; Body: unknown }>(
    "/public-assets/:assetId/draft/content/bundle",
    { bodyLimit: 96 * 1024 * 1024 },
    async (request, reply) => {
      const userId = await request.requireUserId(reply);
      if (!userId) return;
      const parsed = z
        .object({ bundle: primeWorldExportBundleSchema })
        .strict()
        .safeParse(request.body);
      if (!parsed.success)
        return reply.code(400).send({
          error: "BUNDLE_INVALID",
          message: parsed.error.issues[0]?.message ?? "bundle JSON 无效。",
        });
      try {
        return await assets.saveDraftBundle(
          userId,
          request.params.assetId,
          parsed.data.bundle,
        );
      } catch (error) {
        return assetError(reply, error);
      }
    },
  );

  app.patch<{ Params: { assetId: string }; Body: unknown }>(
    "/public-assets/:assetId/draft/recommendation",
    async (request, reply) => {
      const userId = await request.requireUserId(reply);
      if (!userId) return;
      const parsed = savePublicAssetRecommendationSchema.safeParse(request.body);
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
    "/public-assets/:assetId/publish",
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
    "/public-assets/:assetId/unlist",
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
    "/public-assets/:assetId",
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
    "/public-assets/:assetId/install",
    async (request, reply) => {
      const userId = await request.requireUserId(reply);
      if (!userId) return;
      const parsed = installPublicAssetSchema.safeParse(request.body ?? {});
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
    "/public-assets/:assetId/install/update",
    async (request, reply) => {
      const userId = await request.requireUserId(reply);
      if (!userId) return;
      const parsed = installPublicAssetSchema.safeParse(request.body ?? {});
      if (!parsed.success)
        return reply.code(400).send({ error: "VALIDATION_ERROR" });
      try {
        return await assets.updateInstallation(
          userId,
          request.params.assetId,
          parsed.data.applyRecommendedRuntimeConfig,
          parsed.data.worldProgressStrategy,
        );
      } catch (error) {
        return assetError(reply, error);
      }
    },
  );
}

function assetError(reply: FastifyReply, error: unknown) {
  if (error instanceof PrimeWorldCompileError)
    return reply.code(400).send({
      error: error.code,
      message: error.message,
      issue: error.validationIssue,
    });
  if (
    error instanceof Error &&
    /^(?:DUPLICATE_BUNDLE_RESOURCE|BUNDLE_RESOURCE_MISSING|WORLD_RESOURCE_NOT_READY)/.test(error.message)
  )
    return reply.code(400).send({
      error: "BUNDLE_INVALID",
      message: error.message,
    });
  if (error instanceof PublicAssetQueryError)
    return reply
      .code(400)
      .send({ error: "INVALID_CURSOR", message: error.message });
  if (error instanceof PublicAssetNotFoundError)
    return reply
      .code(404)
      .send({ error: "PUBLIC_ASSET_NOT_FOUND", message: error.message });
  if (error instanceof PublicAssetForbiddenError)
    return reply
      .code(409)
      .send({ error: "PUBLIC_ASSET_FORBIDDEN", message: error.message });
  throw error;
}
