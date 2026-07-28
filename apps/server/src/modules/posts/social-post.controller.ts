import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import {
  SocialPostForbiddenError,
  SocialPostNotFoundError,
  SocialPostService,
} from "./social-post.service.js";

const postContentSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string().max(4000) }).strict(),
  z
    .object({
      type: z.literal("image"),
      resourceId: z.string().trim().min(1).max(120),
    })
    .strict(),
  z
    .object({
      type: z.literal("audio"),
      resourceId: z.string().trim().min(1).max(120),
    })
    .strict(),
]);

const postSchema = z
  .object({
    content: z.array(postContentSchema).max(64),
  })
  .strict();

export async function registerSocialPostRoutes(app: FastifyInstance) {
  const posts = new SocialPostService();

  app.post<{ Body: unknown }>("/posts", async (request, reply) => {
    const userId = await request.requireUserId(reply);
    if (!userId) return;
    const parsed = postSchema.safeParse(request.body ?? {});
    if (!parsed.success)
      return validationError(reply, parsed.error.issues[0]?.message);
    try {
      return reply
        .code(201)
        .send(
          await posts.create(userId, parsed.data.content),
        );
    } catch (error) {
      return postError(reply, error);
    }
  });

  app.get<{ Params: { postId: string } }>(
    "/posts/:postId",
    async (request, reply) => {
      try {
        return await posts.get(
          await request.optionalUserId(),
          request.params.postId,
        );
      } catch (error) {
        return postError(reply, error);
      }
    },
  );

  app.patch<{ Params: { postId: string }; Body: unknown }>(
    "/posts/:postId",
    async (request, reply) => {
      const userId = await request.requireUserId(reply);
      if (!userId) return;
      const parsed = postSchema.safeParse(request.body ?? {});
      if (!parsed.success)
        return validationError(reply, parsed.error.issues[0]?.message);
      try {
        return await posts.update(
          userId,
          request.params.postId,
          parsed.data.content,
        );
      } catch (error) {
        return postError(reply, error);
      }
    },
  );

  app.delete<{ Params: { postId: string } }>(
    "/posts/:postId",
    async (request, reply) => {
      const userId = await request.requireUserId(reply);
      if (!userId) return;
      try {
        await posts.delete(userId, request.params.postId);
        return { ok: true };
      } catch (error) {
        return postError(reply, error);
      }
    },
  );

  app.get<{
    Params: { userId: string };
    Querystring: { limit?: string; cursor?: string };
  }>("/users/:userId/posts", async (request) =>
    posts.listByAuthor(await request.optionalUserId(), request.params.userId, {
      limit: Number(request.query.limit) || 20,
      cursor: request.query.cursor,
    }),
  );

  app.get<{ Querystring: { limit?: string; cursor?: string } }>(
    "/feeds/following/posts",
    async (request, reply) => {
      const userId = await request.requireUserId(reply);
      if (!userId) return;
      return posts.listFollowing(userId, {
        limit: Number(request.query.limit) || 20,
        cursor: request.query.cursor,
      });
    },
  );
}

function validationError(reply: FastifyReply, message?: string) {
  return reply.code(400).send({ error: "VALIDATION_ERROR", message });
}

function postError(reply: FastifyReply, error: unknown) {
  if (error instanceof SocialPostNotFoundError)
    return reply
      .code(404)
      .send({ error: "POST_NOT_FOUND", message: error.message });
  if (error instanceof SocialPostForbiddenError)
    return reply
      .code(400)
      .send({ error: "POST_FORBIDDEN", message: error.message });
  throw error;
}
