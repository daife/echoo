import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import {
  SocialActionForbiddenError,
  SocialObjectNotFoundError,
  SocialService,
} from "./social.service.js";

const commentSchema = z.object({
  body: z.string().trim().min(1).max(4000),
  parentCommentId: z.string().trim().min(1).max(120).optional(),
});
const updateCommentSchema = commentSchema.pick({ body: true });

export async function registerSocialRoutes(app: FastifyInstance) {
  const social = new SocialService();

  app.put<{ Params: { objectId: string } }>(
    "/social/objects/:objectId/like",
    async (request, reply) => {
      const userId = await request.requireUserId(reply);
      if (!userId) return;
      try {
        return await social.setLike(request.params.objectId, userId, true);
      } catch (error) {
        return socialError(reply, error);
      }
    },
  );
  app.delete<{ Params: { objectId: string } }>(
    "/social/objects/:objectId/like",
    async (request, reply) => {
      const userId = await request.requireUserId(reply);
      if (!userId) return;
      try {
        return await social.setLike(request.params.objectId, userId, false);
      } catch (error) {
        return socialError(reply, error);
      }
    },
  );
  app.get<{
    Params: { objectId: string };
    Querystring: { before?: string; limit?: string };
  }>("/social/objects/:objectId/comments", async (request, reply) => {
    const userId = await request.optionalUserId();
    try {
      return await social.listComments(
        request.params.objectId,
        userId,
        request.query.before ? Number(request.query.before) : undefined,
        Number(request.query.limit) || 30,
      );
    } catch (error) {
      return socialError(reply, error);
    }
  });
  app.post<{ Params: { objectId: string }; Body: unknown }>(
    "/social/objects/:objectId/comments",
    async (request, reply) => {
      const userId = await request.requireUserId(reply);
      if (!userId) return;
      const parsed = commentSchema.safeParse(request.body);
      if (!parsed.success)
        return reply.code(400).send({
          error: "VALIDATION_ERROR",
          message: parsed.error.issues[0]?.message,
        });
      try {
        const comment = await social.createComment({
          objectId: request.params.objectId,
          authorUserId: userId,
          ...parsed.data,
        });
        return reply.code(201).send(comment);
      } catch (error) {
        return socialError(reply, error);
      }
    },
  );
  app.patch<{ Params: { commentId: string }; Body: unknown }>(
    "/social/comments/:commentId",
    async (request, reply) => {
      const userId = await request.requireUserId(reply);
      if (!userId) return;
      const parsed = updateCommentSchema.safeParse(request.body);
      if (!parsed.success)
        return reply.code(400).send({ error: "VALIDATION_ERROR" });
      try {
        return await social.updateComment(
          request.params.commentId,
          userId,
          parsed.data.body,
        );
      } catch (error) {
        return socialError(reply, error);
      }
    },
  );
  app.delete<{ Params: { commentId: string } }>(
    "/social/comments/:commentId",
    async (request, reply) => {
      const userId = await request.requireUserId(reply);
      if (!userId) return;
      try {
        await social.deleteComment(request.params.commentId, userId);
        return { ok: true };
      } catch (error) {
        return socialError(reply, error);
      }
    },
  );
  app.post<{ Params: { commentId: string } }>(
    "/social/comments/:commentId/hide",
    async (request, reply) => {
      const userId = await request.requireUserId(reply);
      if (!userId) return;
      try {
        await social.hideComment(request.params.commentId, userId);
        return { ok: true };
      } catch (error) {
        return socialError(reply, error);
      }
    },
  );
}

function socialError(reply: FastifyReply, error: unknown) {
  if (error instanceof SocialObjectNotFoundError)
    return reply.code(404).send({ error: "SOCIAL_OBJECT_NOT_FOUND" });
  if (error instanceof SocialActionForbiddenError)
    return reply
      .code(403)
      .send({ error: "SOCIAL_ACTION_FORBIDDEN", message: error.message });
  throw error;
}
