import { randomBytes } from "node:crypto";
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

export async function registerRechargeRoutes(
  app: FastifyInstance,
  options: { service?: RechargeService } = {},
) {
  const service = options.service ?? new RechargeService();

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

  app.get<{ Querystring: { outTradeNo?: string; token?: string } }>(
    "/payments/zpay/checkout",
    { logLevel: "silent" },
    async (request, reply) => {
      try {
        const checkout = await service.getExternalCheckout(
          request.query.outTradeNo ?? "",
          request.query.token ?? "",
        );
        if (checkout.status === "paid")
          return sendCheckoutPage(reply, completedCheckoutPage());
        return sendCheckoutPage(
          reply,
          autoSubmitCheckoutPage(checkout.form.actionUrl, checkout.form.fields),
          checkout.form.actionUrl,
        );
      } catch (error) {
        app.log.warn(
          { error: safeError(error), outTradeNo: request.query.outTradeNo },
          "Rejected native ZPAY checkout",
        );
        const statusCode =
          error instanceof PaymentOrderNotFoundError ? 404 : 400;
        return sendCheckoutPage(reply.code(statusCode), invalidCheckoutPage());
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

  app.get<{ Querystring: Record<string, unknown> }>(
    "/payments/zpay/native-return",
    { logLevel: "silent" },
    async (request, reply) => {
      const outTradeNo = safeOrderNo(request.query);
      let succeeded = true;
      try {
        await service.processCallback(request.query);
      } catch (error) {
        succeeded = false;
        app.log.warn(
          { error: safeError(error), outTradeNo },
          "Rejected native ZPAY browser return",
        );
      }
      return sendCheckoutPage(
        reply.code(succeeded ? 200 : 400),
        nativeReturnPage(succeeded),
      );
    },
  );
}

interface CheckoutPage {
  html: (nonce: string) => string;
}

function sendCheckoutPage(
  reply: import("fastify").FastifyReply,
  page: CheckoutPage,
  formAction?: string,
) {
  const nonce = randomBytes(18).toString("base64");
  const formActionSource = formAction
    ? new URL(formAction).protocol
    : "'none'";
  return reply
    .header("Cache-Control", "no-store")
    .header("Referrer-Policy", "no-referrer")
    .header("X-Content-Type-Options", "nosniff")
    .header(
      "Content-Security-Policy",
      `default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action ${formActionSource}; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'`,
    )
    .type("text/html; charset=utf-8")
    .send(page.html(nonce));
}

function autoSubmitCheckoutPage(
  actionUrl: string,
  fields: Record<string, string>,
): CheckoutPage {
  return {
    html: (nonce) => `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>正在前往收银台</title>${checkoutStyle(nonce)}</head>
<body><main><h1>正在前往收银台</h1><p>请稍候，页面将自动跳转。</p><form method="post" action="${escapeHtml(actionUrl)}">${Object.entries(
      fields,
    )
      .map(
        ([name, value]) =>
          `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`,
      )
      .join("")}<button type="submit">继续支付</button></form></main><script nonce="${nonce}">document.forms[0].submit()</script></body></html>`,
  };
}

function completedCheckoutPage(): CheckoutPage {
  return statusPage("该订单已完成", "请返回 Echoo 查看最新额度。");
}

function invalidCheckoutPage(): CheckoutPage {
  return statusPage("收银台链接无效", "请返回 Echoo 重新发起充值。");
}

function nativeReturnPage(succeeded: boolean): CheckoutPage {
  return succeeded
    ? statusPage("支付已确认", "请返回 Echoo，额度将自动刷新。")
    : statusPage("支付结果尚未确认", "请返回 Echoo 后刷新支付结果。");
}

function statusPage(title: string, message: string): CheckoutPage {
  return {
    html: (nonce) => `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title>${checkoutStyle(nonce)}</head>
<body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></main></body></html>`,
  };
}

function checkoutStyle(nonce: string) {
  return `<style nonce="${nonce}">:root{color-scheme:dark}body{margin:0;background:#101113;color:#f5f5f5;font-family:system-ui,sans-serif}main{max-width:32rem;margin:18vh auto;padding:2rem}h1{font-size:1.5rem;margin:0 0 1rem}p{color:#b7bac0;line-height:1.7}button{margin-top:1rem;border:0;border-radius:.5rem;padding:.75rem 1rem;font-weight:600}</style>`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
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
