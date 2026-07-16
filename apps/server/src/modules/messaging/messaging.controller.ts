import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { MessagingService } from "./messaging.service.js";

const createTextMessageSchema = z.object({
  text: z.string().trim().min(1),
  clientMessageId: z.string().trim().min(1).max(96).optional(),
});

const mediaUploadBaseSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
});

const createMediaMessageSchema = z.discriminatedUnion("contentType", [
  z.object({
    contentType: z.literal("image"),
    upload: mediaUploadBaseSchema
      .extend({
        mimeType: z.literal("image/jpeg"),
        dataBase64: z.string().min(1).max(7_000_000),
      })
      .optional(),
    resourceId: z.string().trim().min(1).max(120).optional(),
    clientMessageId: z.string().trim().min(1).max(96).optional(),
  }),
  z.object({
    contentType: z.literal("voice"),
    upload: mediaUploadBaseSchema
      .extend({
        mimeType: z.literal("audio/mpeg"),
        dataBase64: z.string().min(1),
      })
      .optional(),
    resourceId: z.string().trim().min(1).max(120).optional(),
    durationSeconds: z.number().finite().min(1).max(60),
    clientMessageId: z.string().trim().min(1).max(96).optional(),
  }),
  z.object({
    contentType: z.literal("video"),
    upload: mediaUploadBaseSchema
      .extend({
        mimeType: z.enum([
          "video/mp4",
          "video/webm",
          "video/quicktime",
          "video/mov",
          "video/mpeg",
        ]),
        dataBase64: z.string().min(1),
      })
      .optional(),
    resourceId: z.string().trim().min(1).max(120).optional(),
    clientMessageId: z.string().trim().min(1).max(96).optional(),
  }),
  z.object({
    contentType: z.literal("sticker"),
    stickerId: z.string().trim().min(1).max(120),
    clientMessageId: z.string().trim().min(1).max(96).optional(),
  }),
  z.object({
    contentType: z.literal("transfer"),
    amount: z
      .number()
      .finite()
      .positive()
      .refine((value) => Number.isInteger(value * 100), {
        message: "转账金额最多保留两位小数。",
      }),
    currency: z.literal("CNY").default("CNY"),
    note: z.string().trim().max(200).optional().default(""),
    clientMessageId: z.string().trim().min(1).max(96).optional(),
  }),
]);

const createMessageSchema = z.union([
  createTextMessageSchema,
  createMediaMessageSchema,
]);

const primeFigureHintSchema = z.object({
  instruction: z.string().trim().min(1),
});

const rollbackConversationSchema = z.object({
  messageId: z.string().trim().min(1),
});

const updateAssistantMessageSchema = z.object({
  text: z.string().trim().min(1),
});

const resolveTransferSchema = z.object({
  resolution: z.enum(["accepted", "rejected"]),
});

const listMessagesQuerySchema = z.object({
  after: z.string().trim().min(1).optional(),
  before: z.string().trim().min(1).optional(),
  conversationId: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

export async function registerMessagingRoutes(app: FastifyInstance) {
  const messaging = new MessagingService();

  app.get<{
    Querystring: { after?: string; conversationId?: string; limit?: number };
  }>("/messages", async (request, reply) => {
    const userId = await request.requireUserId(reply);
    if (!userId) return;

    const parsed = listMessagesQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "VALIDATION_ERROR",
        message: parsed.error.issues[0]?.message ?? "消息查询无效。",
      });
    }

    const query = parsed.data;
    return await messaging.listMessages(
      userId,
      query.after,
      query.conversationId,
      query.limit,
    );
  });

  app.get<{
    Params: { conversationId: string };
    Querystring: { after?: string; before?: string; limit?: number };
  }>("/conversations/:conversationId/messages", async (request, reply) => {
    const userId = await request.requireUserId(reply);
    if (!userId) return;

    const parsed = listMessagesQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "VALIDATION_ERROR",
        message: parsed.error.issues[0]?.message ?? "消息查询无效。",
      });
    }

    const query = parsed.data;
    const messages = await messaging.listConversationMessages(
      userId,
      request.params.conversationId,
      query,
    );
    if (!messages)
      return reply.code(404).send({ error: "CONVERSATION_NOT_FOUND" });
    return messages;
  });

  app.post<{ Params: { conversationId: string }; Body: unknown }>(
    "/conversations/:conversationId/messages",
    { bodyLimit: 96 * 1024 * 1024 },
    async (request, reply) => {
      const userId = await request.requireUserId(reply);
      if (!userId) return;

      const parsed = createMessageSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "VALIDATION_ERROR",
          message: parsed.error.issues[0]?.message ?? "消息无效。",
        });
      }

      if ("contentType" in parsed.data) {
        const result = await messaging.createUserMediaMessage({
          ownerUserId: userId,
          conversationId: request.params.conversationId,
          ...parsed.data,
        });
        if (result.kind === "not_found")
          return reply.code(404).send({ error: "CONVERSATION_NOT_FOUND" });
        if (result.kind === "unsupported_type")
          return reply.code(409).send({
            error: "MEDIA_MESSAGE_UNSUPPORTED",
            message: "图片、视频、语音、表情和转账消息仅支持本初角色会话。",
          });
        if (result.kind === "invalid_sticker")
          return reply.code(400).send({
            error: "INVALID_STICKER",
            message: "该表情不在当前角色的可用表情列表中。",
          });
        if (result.kind === "invalid_media")
          return reply.code(400).send({
            error: "INVALID_MEDIA_UPLOAD",
            message: result.message,
          });
        return reply.code(201).send({ message: result.message });
      }

      const result = await messaging.createUserTextMessage({
        ownerUserId: userId,
        conversationId: request.params.conversationId,
        text: parsed.data.text,
        clientMessageId: parsed.data.clientMessageId,
      });

      if (!result)
        return reply.code(404).send({ error: "CONVERSATION_NOT_FOUND" });
      return reply.code(201).send(result);
    },
  );

  app.patch<{
    Params: { conversationId: string; messageId: string };
    Body: unknown;
  }>(
    "/conversations/:conversationId/messages/:messageId/transfer",
    async (request, reply) => {
      const userId = await request.requireUserId(reply);
      if (!userId) return;
      const parsed = resolveTransferSchema.safeParse(request.body);
      if (!parsed.success)
        return reply.code(400).send({
          error: "VALIDATION_ERROR",
          message: parsed.error.issues[0]?.message ?? "转账处理请求无效。",
        });
      const result = await messaging.resolveFigureTransfer({
        ownerUserId: userId,
        conversationId: request.params.conversationId,
        messageId: request.params.messageId,
        resolution: parsed.data.resolution,
      });
      if (result.kind === "not_found")
        return reply.code(404).send({ error: "CONVERSATION_NOT_FOUND" });
      if (result.kind === "invalid_transfer")
        return reply.code(409).send({
          error: "TRANSFER_NOT_PENDING",
          message: "该转账不存在、已处理，或不是 figure 发出的转账。",
        });
      return { message: result.message };
    },
  );

  app.post<{ Params: { conversationId: string }; Body: unknown }>(
    "/conversations/:conversationId/prime-figure/hint",
    async (request, reply) => {
      const userId = await request.requireUserId(reply);
      if (!userId) return;

      const parsed = primeFigureHintSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "VALIDATION_ERROR",
          message: parsed.error.issues[0]?.message ?? "调试指令无效。",
        });
      }

      const result = await messaging.triggerPrimeFigureHint({
        ownerUserId: userId,
        conversationId: request.params.conversationId,
        instruction: parsed.data.instruction,
      });
      if (result.kind === "not_found")
        return reply.code(404).send({ error: "CONVERSATION_NOT_FOUND" });
      if (result.kind === "unsupported_type") {
        return reply.code(409).send({
          error: "PRIME_FIGURE_HINT_UNSUPPORTED",
          message: "调试指令仅支持本初角色会话。",
        });
      }
      return reply.code(202).send({ ok: true });
    },
  );

  app.post<{ Params: { conversationId: string }; Body: unknown }>(
    "/conversations/:conversationId/rollback",
    async (request, reply) => {
      const userId = await request.requireUserId(reply);
      if (!userId) return;

      const parsed = rollbackConversationSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "VALIDATION_ERROR",
          message: parsed.error.issues[0]?.message ?? "回溯请求无效。",
        });
      }

      const result = await messaging.rollbackConversation(
        userId,
        request.params.conversationId,
        parsed.data.messageId,
      );
      if (result.kind === "not_found")
        return reply.code(404).send({ error: "CONVERSATION_NOT_FOUND" });
      if (result.kind === "message_not_found")
        return reply.code(404).send({ error: "MESSAGE_NOT_FOUND" });
      if (result.kind === "unsupported_type") {
        return reply.code(409).send({
          error: "ROLLBACK_UNSUPPORTED",
          message: "只有切片角色会话支持回溯。",
        });
      }

      return {
        ok: true,
        retainedThroughMessageId: result.retainedThroughMessageId,
        deletedCount: result.deletedCount,
      };
    },
  );

  app.patch<{
    Params: { conversationId: string; messageId: string };
    Body: unknown;
  }>(
    "/conversations/:conversationId/messages/:messageId",
    async (request, reply) => {
      const userId = await request.requireUserId(reply);
      if (!userId) return;
      const parsed = updateAssistantMessageSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "VALIDATION_ERROR",
          message: parsed.error.issues[0]?.message ?? "消息修改内容无效。",
        });
      }
      const result = await messaging.updateAssistantTextMessage({
        ownerUserId: userId,
        conversationId: request.params.conversationId,
        messageId: request.params.messageId,
        text: parsed.data.text,
      });
      if (result.kind === "not_found")
        return reply.code(404).send({ error: "CONVERSATION_NOT_FOUND" });
      if (result.kind === "message_not_found")
        return reply.code(404).send({ error: "MESSAGE_NOT_FOUND" });
      if (result.kind === "unsupported_type")
        return reply.code(409).send({
          error: "MESSAGE_EDIT_UNSUPPORTED",
          message: "只有切片角色会话支持修改回复。",
        });
      if (result.kind === "unsupported_message")
        return reply.code(409).send({
          error: "MESSAGE_EDIT_UNSUPPORTED",
          message: "只能修改角色发送的文字消息。",
        });
      if (result.kind === "pending")
        return reply
          .code(409)
          .send({ error: "MESSAGE_PENDING", message: "回复完成后才能修改。" });
      return { message: result.message };
    },
  );

  app.post<{ Params: { id: string }; Body?: { readAt?: number } }>(
    "/messages/:id/read",
    async (request, reply) => {
      const userId = await request.requireUserId(reply);
      if (!userId) return;

      const updated = await messaging.markRead(
        userId,
        request.params.id,
        request.body?.readAt ?? Date.now(),
      );
      if (!updated) return reply.code(404).send({ error: "MESSAGE_NOT_FOUND" });
      return { ok: true };
    },
  );
}
