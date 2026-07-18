import type { CreateRechargeOrderRequest } from "@echoo/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { environment } from "../../infra/config/environment.js";
import {
  PaymentOrderNotFoundError,
  PaymentUnavailableError,
  PaymentUpstreamError,
  PaymentValidationError,
  RechargeService,
} from "./recharge.service.js";

const createOrderSchema = z.object({
  creditUsd: z.string().trim().min(1).max(40),
  paymentType: z.enum(["alipay", "wxpay"]),
});

export async function registerRechargeRoutes(app: FastifyInstance) {
  const service = new RechargeService();

  app.get("/users/me/recharge-config", async (request, reply) => {
    const userId = await request.requireUserId(reply);
    if (!userId) return;
    return service.getConfig();
  });

  app.post<{ Body: CreateRechargeOrderRequest }>(
    "/users/me/recharge-orders",
    async (request, reply) => {
      const userId = await request.requireUserId(reply);
      if (!userId) return;
      try {
        const body = createOrderSchema.parse(request.body);
        return await service.createOrder({ ownerUserId: userId, ...body });
      } catch (error) {
        return sendPaymentError(reply, error);
      }
    },
  );

  app.get<{ Params: { outTradeNo: string } }>(
    "/users/me/recharge-orders/:outTradeNo",
    async (request, reply) => {
      const userId = await request.requireUserId(reply);
      if (!userId) return;
      try {
        return await service.getOrder(userId, request.params.outTradeNo);
      } catch (error) {
        return sendPaymentError(reply, error);
      }
    },
  );

  app.post<{ Params: { outTradeNo: string } }>(
    "/users/me/recharge-orders/:outTradeNo/reconcile",
    async (request, reply) => {
      const userId = await request.requireUserId(reply);
      if (!userId) return;
      try {
        return await service.reconcile(userId, request.params.outTradeNo);
      } catch (error) {
        return sendPaymentError(reply, error);
      }
    },
  );

  app.get<{ Querystring: Record<string, unknown> }>(
    "/payments/zpay/notify",
    { logLevel: "silent" },
    async (request, reply) => {
      try {
        await service.processCallback(request.query);
        return reply.type("text/plain; charset=utf-8").send("success");
      } catch (error) {
        app.log.warn(
          { error: safeError(error), outTradeNo: safeOrderNo(request.query) },
          "Rejected ZPAY notification",
        );
        return reply
          .code(error instanceof PaymentValidationError ? 400 : 500)
          .type("text/plain; charset=utf-8")
          .send("fail");
      }
    },
  );

  app.get<{ Querystring: Record<string, unknown> }>(
    "/payments/zpay/return",
    { logLevel: "silent" },
    async (request, reply) => {
      const outTradeNo = safeOrderNo(request.query);
      let result = "success";
      try {
        await service.processCallback(request.query);
      } catch (error) {
        result = "failed";
        app.log.warn(
          { error: safeError(error), outTradeNo },
          "Rejected ZPAY browser return",
        );
      }
      const redirect = new URL(environment.clientUrl);
      if (outTradeNo) redirect.searchParams.set("rechargeOrder", outTradeNo);
      redirect.searchParams.set("rechargeResult", result);
      return reply.code(303).redirect(redirect.toString());
    },
  );
}

function sendPaymentError(reply: import("fastify").FastifyReply, error: unknown) {
  if (error instanceof PaymentOrderNotFoundError)
    return reply.code(404).send({ error: error.code, message: error.message });
  if (error instanceof PaymentUnavailableError)
    return reply.code(503).send({ error: error.code, message: error.message });
  if (error instanceof PaymentUpstreamError)
    return reply.code(502).send({ error: error.code, message: error.message });
  const message = error instanceof Error ? error.message : "充值操作失败。";
  return reply.code(400).send({
    error: error instanceof PaymentValidationError ? error.code : "INVALID_RECHARGE",
    message,
  });
}

function safeOrderNo(query: Record<string, unknown>) {
  const value = query.out_trade_no;
  return typeof value === "string" && /^\d{1,32}$/.test(value)
    ? value
    : undefined;
}

function safeError(error: unknown) {
  return error instanceof Error
    ? { name: error.name, message: error.message }
    : { name: "UnknownError", message: "Unknown payment error" };
}
