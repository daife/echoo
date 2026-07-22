import { primeWorldDefinitionSchema } from "@echoo/shared";
import type { PrimeWorldDetail } from "@echoo/shared";
import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { PrimeWorldCompileError } from "./prime-world-compiler.js";
import { PrimeWorldService } from "./prime-world.service.js";

const eventSchema = z
  .object({
    clientEventId: z.string().min(1).max(120),
    type: z.enum([
      "world.start",
      "ui.action",
      "input.text",
      "input.voice",
      "timer.fired",
    ]),
    payload: z.record(z.string(), z.unknown()).optional(),
    expectedViewRevision: z.number().int().nonnegative().optional(),
    interruptCurrent: z.boolean().optional(),
  })
  .strict();

export async function registerPrimeWorldRoutes(app: FastifyInstance) {
  const worlds = new PrimeWorldService();
  app.get("/catalog", async (request, reply) => {
    const userId = await request.requireUserId(reply);
    if (!userId) return;
    return { nodes: worlds.catalog() };
  });
  app.post<{ Body: unknown }>("/import", { bodyLimit: 96 * 1024 * 1024 }, async (request, reply) => {
    const userId = await request.requireUserId(reply);
    if (!userId) return;
    try {
      const agent = await worlds.importBundle(userId, request.body);
      return reply.code(201).send({ agent });
    } catch (error) {
      if (error instanceof ZodError)
        return reply.code(400).send({ error: "BUNDLE_INVALID", message: error.issues[0]?.message ?? "导入包无效。" });
      if (error instanceof PrimeWorldCompileError)
        return reply.code(400).send({ error: error.code, message: error.message, issue: error.validationIssue });
      if (error instanceof Error && /^(?:DUPLICATE_BUNDLE_RESOURCE|BUNDLE_RESOURCE_MISSING|WORLD_RESOURCE_NOT_READY)/.test(error.message))
        return reply.code(400).send({ error: "BUNDLE_INVALID", message: error.message });
      throw error;
    }
  });
  app.post<{ Body: unknown }>("/validate", { bodyLimit: 2 * 1024 * 1024 }, async (request, reply) => {
    const userId = await request.requireUserId(reply);
    if (!userId) return;
    try {
      const issues = worlds.validate(
        primeWorldDefinitionSchema.parse(request.body) as PrimeWorldDetail,
      );
      return { valid: issues.length === 0, issues };
    } catch (error) {
      const issues =
        error instanceof PrimeWorldCompileError
          ? [error.validationIssue]
          : error instanceof ZodError
            ? error.issues.map((item) => ({
                code: "SCHEMA_INVALID",
                message: item.message,
                pointer: `/${item.path.join("/")}`,
              }))
            : [
                {
                  code: "WORKFLOW_INVALID",
                  message:
                    error instanceof Error ? error.message : "工作流无效。",
                  pointer: "/",
                },
              ];
      return reply.send({
          valid: false,
          issues,
          message: issues[0]?.message ?? "工作流无效。",
        });
    }
  });
  app.get<{ Params: { conversationId: string } }>(
    "/:conversationId",
    async (request, reply) => {
      const userId = await request.requireUserId(reply);
      if (!userId) return;
      const snapshot = await worlds.snapshot(
        userId,
        request.params.conversationId,
      );
      return (
        snapshot ??
        reply
          .code(404)
          .send({ error: "NOT_FOUND", message: "未找到本初世界。" })
      );
    },
  );
  app.get<{ Params: { conversationId: string } }>(
    "/:conversationId/export",
    async (request, reply) => {
      const userId = await request.requireUserId(reply);
      if (!userId) return;
      try { return await worlds.exportBundle(userId, request.params.conversationId); }
      catch (error) {
        if (error instanceof Error && error.message === "WORLD_NOT_FOUND")
          return reply.code(404).send({ error: "NOT_FOUND", message: "未找到本初世界。" });
        throw error;
      }
    },
  );
  app.get<{ Params: { conversationId: string; runId: string } }>(
    "/:conversationId/runs/:runId",
    async (request, reply) => {
      const userId = await request.requireUserId(reply);
      if (!userId) return;
      const run = await worlds.getRun(
        userId,
        request.params.conversationId,
        request.params.runId,
      );
      return run
        ? { run }
        : reply
            .code(404)
            .send({ error: "NOT_FOUND", message: "未找到运行记录。" });
    },
  );
  app.get<{ Params: { conversationId: string; runId: string } }>(
    "/:conversationId/runs/:runId/trace",
    async (request, reply) => {
      const userId = await request.requireUserId(reply);
      if (!userId) return;
      const trace = await worlds.getTrace(userId, request.params.conversationId, request.params.runId);
      return trace
        ? { trace }
        : reply.code(404).send({ error: "NOT_FOUND", message: "未找到运行记录。" });
    },
  );
  app.post<{ Params: { conversationId: string; runId: string } }>(
    "/:conversationId/runs/:runId/cancel",
    async (request, reply) => {
      const userId = await request.requireUserId(reply);
      if (!userId) return;
      const cancelled = await worlds.cancel(
        userId,
        request.params.conversationId,
        request.params.runId,
      );
      return { cancelled };
    },
  );
  app.post<{ Params: { conversationId: string }; Body: unknown }>(
    "/:conversationId/events",
    async (request, reply) => {
      const userId = await request.requireUserId(reply);
      if (!userId) return;
      try {
        const run = await worlds.dispatch(
          userId,
          request.params.conversationId,
          eventSchema.parse(request.body) as never,
        );
        return reply.code(202).send({ run });
      } catch (error) {
        if (error instanceof ZodError)
          return reply
            .code(400)
            .send({
              error: "VALIDATION_ERROR",
              message: error.issues[0]?.message ?? "世界事件无效。",
            });
        if (error instanceof Error && error.message === "WORLD_NOT_FOUND")
          return reply
            .code(404)
            .send({ error: "NOT_FOUND", message: "未找到本初世界。" });
        if (error instanceof Error && error.message === "WORLD_AUDIO_RESOURCE_INVALID")
          return reply.code(400).send({ error: "WORLD_AUDIO_RESOURCE_INVALID", message: "语音资源不存在、未就绪或不属于当前用户。" });
        if (error instanceof Error && error.message === "EVENT_QUOTA_EXCEEDED")
          return reply.code(413).send({ error: "EVENT_QUOTA_EXCEEDED", message: "世界事件不能超过 64 KiB。" });
        throw error;
      }
    },
  );
  app.post<{ Params: { conversationId: string } }>(
    "/:conversationId/reset",
    async (request, reply) => {
      const userId = await request.requireUserId(reply);
      if (!userId) return;
      try {
        const reset = await worlds.reset(userId, request.params.conversationId);
        return reply.code(202).send(reset);
      } catch (error) {
        if (error instanceof Error && error.message === "WORLD_NOT_FOUND")
          return reply.code(404).send({ error: "NOT_FOUND", message: "未找到本初世界。" });
        throw error;
      }
    },
  );
}
