import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import {
  PaymentValidationError,
  type RechargeService,
} from "./recharge.service.js";
import { registerRechargeRoutes } from "./recharge.controller.js";

function createApp(service: Partial<RechargeService>) {
  const app = Fastify();
  return app
    .register(registerRechargeRoutes, { service: service as RechargeService })
    .then(() => app);
}

test("serves a no-store native checkout that posts signed fields", async (t) => {
  const app = await createApp({
    getExternalCheckout: async () => ({
      status: "pending",
      form: {
        actionUrl: "https://zpayz.cn/submit.php",
        method: "POST",
        fields: {
          name: "Echoo <充值>",
          sign: "provider-signature",
        },
      },
    }),
  });
  t.after(() => app.close());

  const response = await app.inject({
    method: "GET",
    url: "/payments/zpay/checkout?outTradeNo=123&token=signed",
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(response.headers["referrer-policy"], "no-referrer");
  assert.match(
    response.headers["content-security-policy"] ?? "",
    /form-action https:;/,
  );
  assert.match(response.body, /method="post"/);
  assert.match(response.body, /Echoo &lt;充值&gt;/);
  assert.match(response.body, /document\.forms\[0\]\.submit\(\)/);
});

test("does not resubmit paid orders and rejects invalid checkout links", async (t) => {
  let invalid = false;
  const app = await createApp({
    getExternalCheckout: async () => {
      if (invalid) throw new PaymentValidationError("invalid");
      return { status: "paid" };
    },
  });
  t.after(() => app.close());

  const paid = await app.inject({
    method: "GET",
    url: "/payments/zpay/checkout?outTradeNo=123&token=signed",
  });
  assert.equal(paid.statusCode, 200);
  assert.match(paid.body, /该订单已完成/);
  assert.doesNotMatch(paid.body, /<form/);
  assert.match(
    paid.headers["content-security-policy"] ?? "",
    /form-action 'none';/,
  );

  invalid = true;
  const rejected = await app.inject({
    method: "GET",
    url: "/payments/zpay/checkout?outTradeNo=123&token=tampered",
  });
  assert.equal(rejected.statusCode, 400);
  assert.equal(rejected.headers["cache-control"], "no-store");
  assert.match(rejected.body, /收银台链接无效/);
  assert.match(
    rejected.headers["content-security-policy"] ?? "",
    /form-action 'none';/,
  );
});

test("renders native payment return results without redirecting to the web app", async (t) => {
  let shouldFail = false;
  const app = await createApp({
    processCallback: async () => {
      if (shouldFail) throw new PaymentValidationError("invalid");
      return {} as never;
    },
  });
  t.after(() => app.close());

  const success = await app.inject({
    method: "GET",
    url: "/payments/zpay/native-return?out_trade_no=123",
  });
  assert.equal(success.statusCode, 200);
  assert.match(success.body, /支付已确认/);
  assert.equal(success.headers.location, undefined);

  shouldFail = true;
  const failed = await app.inject({
    method: "GET",
    url: "/payments/zpay/native-return?out_trade_no=123",
  });
  assert.equal(failed.statusCode, 400);
  assert.match(failed.body, /支付结果尚未确认/);
});
