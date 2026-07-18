import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { PromotionParseError } from "./promotion-parser.js";
import { RewardsError, RewardsService } from "./rewards.service.js";

const inviteSchema = z.object({
  code: z.string().trim().min(1).max(32),
});
const promotionSchema = z.object({
  shareText: z.string().trim().min(1).max(4_000),
});
const settlementSchema = z.object({
  quoteId: z.string().trim().min(1).max(80),
});

export async function registerRewardsRoutes(app: FastifyInstance) {
  const rewards = new RewardsService();

  app.get("/users/me/rewards", async (request, reply) => {
    const userId = await request.requireUserId(reply);
    if (!userId) return;
    return rewards.getCenter(userId);
  });

  app.post<{ Body: unknown }>(
    "/users/me/invitations/redeem",
    async (request, reply) => {
      const userId = await request.requireUserId(reply);
      if (!userId) return;
      try {
        return await rewards.redeemInviteCode(
          userId,
          inviteSchema.parse(request.body).code,
        );
      } catch (error) {
        return sendRewardError(reply, error);
      }
    },
  );

  app.post<{ Body: unknown }>(
    "/users/me/promotions",
    async (request, reply) => {
      const userId = await request.requireUserId(reply);
      if (!userId) return;
      try {
        return await rewards.bindPromotion(
          userId,
          promotionSchema.parse(request.body).shareText,
        );
      } catch (error) {
        return sendRewardError(reply, error);
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    "/users/me/promotions/:id/quote",
    async (request, reply) => {
      const userId = await request.requireUserId(reply);
      if (!userId) return;
      try {
        return await rewards.quotePromotion(userId, request.params.id);
      } catch (error) {
        return sendRewardError(reply, error);
      }
    },
  );

  app.post<{ Params: { id: string }; Body: unknown }>(
    "/users/me/promotions/:id/settle",
    async (request, reply) => {
      const userId = await request.requireUserId(reply);
      if (!userId) return;
      try {
        return await rewards.settlePromotion(
          userId,
          request.params.id,
          settlementSchema.parse(request.body).quoteId,
        );
      } catch (error) {
        return sendRewardError(reply, error);
      }
    },
  );
}

function sendRewardError(
  reply: FastifyReply,
  error: unknown,
) {
  if (error instanceof RewardsError)
    return reply
      .code(error.statusCode)
      .send({ error: error.code, message: error.message });
  if (error instanceof PromotionParseError)
    return reply.code(error.retryable ? 502 : 422).send({
      error: error.retryable
        ? "PROMOTION_PLATFORM_UNAVAILABLE"
        : "INVALID_PROMOTION_SHARE",
      message: error.message,
    });
  if (error instanceof z.ZodError)
    return reply
      .code(400)
      .send({ error: "INVALID_REWARD_REQUEST", message: error.issues[0]?.message });
  throw error;
}
