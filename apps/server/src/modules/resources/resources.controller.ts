import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getRedis } from "../../infra/redis/redis.js";
import {
  InvalidMediaUploadError,
  ResourceRepository,
  type ResourceVariantRecord,
} from "./resource.repository.js";
import { ResourceProcessingQueue } from "./resource-processing.queue.js";

const variantSchema = z.enum(["original", "thumb", "display"]);
const createUploadSchema = z.object({
  kind: z.enum(["end_user_image", "end_user_voice"]),
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.enum(["image/jpeg", "audio/mpeg"]),
  byteSize: z.number().int().positive(),
});
const accessSchema = z.object({
  items: z
    .array(
      z.object({
        resourceId: z.string().trim().min(1).max(120),
        variant: variantSchema.default("original"),
      }),
    )
    .min(1)
    .max(100),
});

export async function registerResourceRoutes(app: FastifyInstance) {
  const resources = new ResourceRepository();
  const processingQueue = new ResourceProcessingQueue(resources);
  const directObjectStorageDownloads =
    process.env.RESOURCE_STORAGE_PROVIDER === "s3" &&
    process.env.RESOURCE_S3_DIRECT_DOWNLOADS === "true";

  app.post<{ Body: unknown }>("/uploads", async (request, reply) => {
    const userId = await request.requireUserId(reply);
    if (!userId) return;
    if (!(await allowRateLimit(userId, "upload-create", 30, 60)))
      return reply.code(429).send({ error: "RATE_LIMITED" });
    const parsed = createUploadSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({
        error: "VALIDATION_ERROR",
        message: parsed.error.issues[0]?.message,
      });
    try {
      const created = await resources.createPendingUpload({
        ownerUserId: userId,
        ...parsed.data,
      });
      return {
        resourceId: created.resource!.id,
        status: created.resource!.status,
        uploadMethod: created.uploadMethod,
        uploadUrl:
          created.uploadUrl ?? `/api/resources/${created.resource!.id}/content`,
        uploadHeaders: {
          "Content-Type": created.uploadUrl
            ? parsed.data.mimeType
            : "application/octet-stream",
        },
        expiresAt: Date.now() + 10 * 60_000,
      };
    } catch (error) {
      return mediaError(reply, error);
    }
  });

  app.put<{ Params: { id: string }; Body: Buffer }>(
    "/:id/content",
    { bodyLimit: 12 * 1024 * 1024 },
    async (request, reply) => {
      const userId = await request.requireUserId(reply);
      if (!userId) return;
      if (!Buffer.isBuffer(request.body))
        return reply.code(400).send({ error: "BINARY_BODY_REQUIRED" });
      try {
        const resource = await resources.putPendingUploadForOwner(
          userId,
          request.params.id,
          request.body,
        );
        if (!resource)
          return reply.code(404).send({ error: "RESOURCE_NOT_FOUND" });
        return { ok: true };
      } catch (error) {
        return mediaError(reply, error);
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    "/:id/complete",
    async (request, reply) => {
      const userId = await request.requireUserId(reply);
      if (!userId) return;
      if (!(await allowRateLimit(userId, "upload-complete", 60, 60)))
        return reply.code(429).send({ error: "RATE_LIMITED" });
      try {
        const resource = await resources.markPendingUploadProcessing(
          userId,
          request.params.id,
        );
        if (!resource)
          return reply.code(404).send({ error: "RESOURCE_NOT_FOUND" });
        if (resource.status === "processing") {
          await processingQueue.enqueue(resource.id).catch(async () => {
            await resources.processUpload(resource.id);
          });
        }
        return {
          resourceId: resource.id,
          status: (await resources.findById(resource.id))?.status,
        };
      } catch (error) {
        return mediaError(reply, error);
      }
    },
  );

  app.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const userId = await request.requireUserId(reply);
    if (!userId) return;
    const resource = await resources.findById(request.params.id);
    if (!resource || resource.ownerUserId !== userId)
      return reply.code(404).send({ error: "RESOURCE_NOT_FOUND" });
    return resourceView(resource, await resources.listVariants(resource.id));
  });

  app.post<{ Body: unknown }>("/access", async (request, reply) => {
    const userId = await request.requireUserId(reply);
    if (!userId) return;
    if (!(await allowRateLimit(userId, "media-access", 300, 60)))
      return reply.code(429).send({ error: "RATE_LIMITED" });
    const parsed = accessSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({
        error: "VALIDATION_ERROR",
        message: parsed.error.issues[0]?.message,
      });
    const items = await Promise.all(
      parsed.data.items.map(async (item) => {
        const resource = await resources.findById(item.resourceId);
        if (
          !resource ||
          resource.ownerUserId !== userId ||
          resource.status !== "ready"
        )
          return {
            resourceId: item.resourceId,
            error: "RESOURCE_NOT_FOUND" as const,
          };
        const access = await resources.createAccessUrl(
          resource,
          item.variant,
          directObjectStorageDownloads,
        );
        const token = app.jwt.sign(
          { mediaResourceId: resource.id, ownerUserId: userId },
          { expiresIn: "10m" },
        );
        return {
          resourceId: resource.id,
          variant: access.variant,
          url:
            access.url ??
            `/api/resources/${resource.id}/file?variant=${access.variant}&token=${encodeURIComponent(token)}`,
          expiresAt: Date.now() + 10 * 60_000,
          mimeType: access.mimeType,
          byteSize: access.byteSize,
          etag: access.etag,
          width: access.width,
          height: access.height,
        };
      }),
    );
    return { items };
  });

  app.get<{
    Params: { id: string };
    Querystring: { variant?: string; token?: string };
  }>("/:id/file", async (request, reply) => {
    const resource = await resources.findById(request.params.id);
    if (!resource || resource.status !== "ready")
      return reply.code(404).send({ error: "RESOURCE_NOT_FOUND" });

    const tokenUserId = verifyMediaToken(app, request.query.token, resource.id);
    const userId = tokenUserId ?? (await request.requireUserId(reply));
    if (!userId) return;
    if (resource.ownerUserId !== userId)
      return reply.code(403).send({ error: "RESOURCE_FORBIDDEN" });

    const variant = variantSchema
      .catch("original")
      .parse(request.query.variant);
    const opened = await resources.openVariantReadStream(
      resource,
      variant,
      request.headers.range,
    );
    const selected = await resources.createAccessUrl(resource, variant, false);
    reply.code(opened.statusCode);
    reply.header("Content-Type", selected.mimeType);
    reply.header("Content-Length", opened.size);
    reply.header("Accept-Ranges", "bytes");
    reply.header("Cache-Control", "private, max-age=31536000, immutable");
    if (opened.contentRange) reply.header("Content-Range", opened.contentRange);
    if (opened.etag) reply.header("ETag", `"${opened.etag}"`);
    return reply.send(opened.stream);
  });
}

function verifyMediaToken(
  app: FastifyInstance,
  token: string | undefined,
  resourceId: string,
) {
  if (!token) return null;
  try {
    const payload = app.jwt.verify<{
      mediaResourceId: string;
      ownerUserId: string;
    }>(token);
    return payload.mediaResourceId === resourceId ? payload.ownerUserId : null;
  } catch {
    return null;
  }
}

async function allowRateLimit(
  userId: string,
  action: string,
  maximum: number,
  seconds: number,
) {
  try {
    const redis = await getRedis();
    const now = Date.now();
    const windowMs = seconds * 1000;
    const key = `echoo:rate:${action}:${userId}`;
    const count = await redis.eval(
      `redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1] - ARGV[2])
       redis.call('ZADD', KEYS[1], ARGV[1], ARGV[3])
       local count = redis.call('ZCARD', KEYS[1])
       redis.call('PEXPIRE', KEYS[1], ARGV[2])
       return count`,
      {
        keys: [key],
        arguments: [String(now), String(windowMs), `${now}:${randomUUID()}`],
      },
    );
    return Number(count) <= maximum;
  } catch {
    return true;
  }
}

function resourceView(
  resource: Awaited<ReturnType<ResourceRepository["findById"]>>,
  variants: ResourceVariantRecord[],
) {
  if (!resource) return null;
  return {
    resourceId: resource.id,
    status: resource.status,
    mimeType: resource.mimeType,
    byteSize: resource.byteSize,
    width: resource.width,
    height: resource.height,
    durationSeconds: resource.durationSeconds,
    variants: variants.map((variant) => ({
      variant: variant.variant,
      mimeType: variant.mimeType,
      byteSize: variant.byteSize,
      width: variant.width,
      height: variant.height,
      etag: variant.etag,
    })),
  };
}

function mediaError(
  reply: Parameters<typeof mediaErrorReply>[0],
  error: unknown,
) {
  return mediaErrorReply(reply, error);
}

function mediaErrorReply(
  reply: import("fastify").FastifyReply,
  error: unknown,
) {
  if (error instanceof InvalidMediaUploadError)
    return reply
      .code(400)
      .send({ error: "INVALID_MEDIA", message: error.message });
  throw error;
}
