import type { FastifyPluginAsync } from "fastify";
import { WechatService } from "./wechat.service.js";

export const channelsController: FastifyPluginAsync = async (fastify) => {
  const service = new WechatService();

  fastify.get("/wechat/binding", async (request, reply) => {
    const userId = await request.requireUserId(reply);
    if (!userId) return;
    const binding = await service.getBinding(userId);
    return {
      binding: binding
        ? {
            id: binding.id,
            interfaceType: binding.interfaceType,
            conversationId: binding.conversationId,
            displayName: binding.displayName,
            externalAccountId: binding.externalAccountId,
            enabled: binding.enabled,
            status: binding.status,
            boundAt: binding.boundAt,
            createdAt: binding.createdAt,
          }
        : null,
    };
  });

  fastify.post<{ Body: { conversationId: string } }>(
    "/wechat/login",
    async (request, reply) => {
      const userId = await request.requireUserId(reply);
      if (!userId) return;
      try {
        const result = await service.startLogin(
          userId,
          request.body.conversationId,
        );
        if (result.kind === "already_bound")
          return reply.code(409).send(result);
        return result;
      } catch (error) {
        return reply
          .code(400)
          .send({
            error: "WECHAT_LOGIN_INVALID",
            message:
              error instanceof Error ? error.message : "无法开始微信登录。",
          });
      }
    },
  );

  fastify.get<{ Params: { attemptId: string } }>(
    "/wechat/login/:attemptId",
    async (request, reply) => {
      const userId = await request.requireUserId(reply);
      if (!userId) return;
      const result = await service.pollLogin(userId, request.params.attemptId);
      if (!result)
        return reply.code(404).send({ error: "WECHAT_LOGIN_NOT_FOUND" });
      return result;
    },
  );

  fastify.post<{ Body: { conversationId: string } }>(
    "/wechat/rebind",
    async (request, reply) => {
      const userId = await request.requireUserId(reply);
      if (!userId) return;
      try {
        const result = await service.rebind(
          userId,
          request.body.conversationId,
        );
        if (result.kind === "not_found")
          return reply.code(404).send({ error: "WECHAT_BINDING_NOT_FOUND" });
        return result;
      } catch (error) {
        return reply
          .code(400)
          .send({
            error: "WECHAT_REBIND_INVALID",
            message: error instanceof Error ? error.message : "无法改绑微信。",
          });
      }
    },
  );

  fastify.delete("/wechat/binding", async (request, reply) => {
    const userId = await request.requireUserId(reply);
    if (!userId) return;
    await service.unbind(userId);
    return { ok: true };
  });
};
