import {
  conversationRuntimeConfigPatchSchema,
  primeFigureRuntimeConfigPatchSchema,
  sliceFigureRuntimeConfigPatchSchema,
  userRuntimeConfigPatchSchema,
} from "@echoo/shared";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import {
  RuntimeConfigNotFoundError,
  RuntimeConfigService,
  RuntimeConfigValidationError,
} from "./runtime-config.service.js";

export async function registerRuntimeConfigRoutes(app: FastifyInstance) {
  const service = new RuntimeConfigService();

  app.get("/users/me/runtime-config", async (request, reply) => {
    const userId = await request.requireUserId(reply);
    if (!userId) return;
    return service.getUserConfig(userId);
  });

  app.patch<{ Body: unknown }>(
    "/users/me/runtime-config",
    async (request, reply) => {
      const userId = await request.requireUserId(reply);
      if (!userId) return;
      try {
        return await service.updateUserConfig(
          userId,
          userRuntimeConfigPatchSchema.parse(request.body),
        );
      } catch (error) {
        return handleConfigError(error, reply);
      }
    },
  );

  app.get<{ Params: { conversationId: string } }>(
    "/conversations/:conversationId/runtime-config",
    async (request, reply) => {
      const userId = await request.requireUserId(reply);
      if (!userId) return;
      try {
        return await service.getConversationConfig(
          userId,
          request.params.conversationId,
        );
      } catch (error) {
        return handleConfigError(error, reply);
      }
    },
  );

  app.patch<{ Params: { conversationId: string }; Body: unknown }>(
    "/conversations/:conversationId/runtime-config",
    async (request, reply) => {
      const userId = await request.requireUserId(reply);
      if (!userId) return;
      try {
        const base = conversationRuntimeConfigPatchSchema.parse(request.body);
        const current = await service.getConversationConfig(
          userId,
          request.params.conversationId,
        );
        const config = base.config
          ? current.conversationType === "slice-figure"
            ? sliceFigureRuntimeConfigPatchSchema.parse(base.config)
            : current.conversationType === "prime-figure"
              ? primeFigureRuntimeConfigPatchSchema.parse(base.config)
              : {}
          : undefined;
        return await service.updateConversationConfig(
          userId,
          request.params.conversationId,
          { mode: base.mode, ...(config ? { config } : {}) },
        );
      } catch (error) {
        return handleConfigError(error, reply);
      }
    },
  );
}

function handleConfigError(error: unknown, reply: any) {
  if (error instanceof RuntimeConfigNotFoundError)
    return reply.code(404).send({
      error: "RUNTIME_CONFIG_NOT_FOUND",
      message: error.message,
    });
  if (
    error instanceof ZodError ||
    error instanceof RuntimeConfigValidationError
  )
    return reply.code(400).send({
      error: "VALIDATION_ERROR",
      message:
        error instanceof ZodError
          ? (error.issues[0]?.message ?? "运行配置无效。")
          : error.message,
    });
  throw error;
}
