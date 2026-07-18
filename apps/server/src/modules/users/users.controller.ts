import type { FastifyInstance, FastifyReply } from "fastify";
import {
  FollowForbiddenError,
  PublicUserNotFoundError,
  UsersService,
} from "./users.service.js";

export async function registerUsersRoutes(app: FastifyInstance) {
  const users = new UsersService();

  app.get<{ Params: { userId: string } }>(
    "/users/:userId",
    async (request, reply) => {
      try {
        return await users.getPublicProfile(
          await request.optionalUserId(),
          request.params.userId,
        );
      } catch (error) {
        return userError(reply, error);
      }
    },
  );

  app.put<{ Params: { userId: string } }>(
    "/users/:userId/follow",
    async (request, reply) => {
      const viewerUserId = await request.requireUserId(reply);
      if (!viewerUserId) return;
      try {
        return await users.setFollowing(
          viewerUserId,
          request.params.userId,
          true,
        );
      } catch (error) {
        return userError(reply, error);
      }
    },
  );

  app.delete<{ Params: { userId: string } }>(
    "/users/:userId/follow",
    async (request, reply) => {
      const viewerUserId = await request.requireUserId(reply);
      if (!viewerUserId) return;
      try {
        return await users.setFollowing(
          viewerUserId,
          request.params.userId,
          false,
        );
      } catch (error) {
        return userError(reply, error);
      }
    },
  );

  for (const direction of ["followers", "following"] as const)
    app.get<{
      Params: { userId: string };
      Querystring: { limit?: string; cursor?: string };
    }>(`/users/:userId/${direction}`, async (request, reply) => {
      try {
        const viewerUserId = await request.optionalUserId();
        const method =
          direction === "followers"
            ? users.listFollowers.bind(users)
            : users.listFollowing.bind(users);
        return await method(
          viewerUserId,
          request.params.userId,
          Number(request.query.limit) || 30,
          request.query.cursor,
        );
      } catch (error) {
        return userError(reply, error);
      }
    });
}

function userError(reply: FastifyReply, error: unknown) {
  if (error instanceof PublicUserNotFoundError)
    return reply
      .code(404)
      .send({ error: "USER_NOT_FOUND", message: error.message });
  if (error instanceof FollowForbiddenError)
    return reply
      .code(400)
      .send({ error: "FOLLOW_FORBIDDEN", message: error.message });
  throw error;
}
