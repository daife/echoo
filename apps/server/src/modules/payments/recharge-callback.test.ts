import assert from "node:assert/strict";
import test from "node:test";
import type { RechargeOrderView } from "@echoo/shared";
import {
  PaymentValidationError,
  RechargeService,
  type VerifiedRechargePayment,
  validatePaymentAgainstOrder,
} from "./recharge.service.js";
import { signZpayParams } from "./zpay-signature.js";

const paymentConfig = {
  publicServerUrl: "https://api.example.com",
  pid: "1001",
  key: "merchant-key",
  baseUrl: "https://zpayz.cn",
};

class CallbackTestService extends RechargeService {
  settlements: VerifiedRechargePayment[] = [];

  constructor() {
    super({ paymentConfig });
  }

  protected override async settleVerifiedPayment(
    input: VerifiedRechargePayment,
  ): Promise<RechargeOrderView> {
    this.settlements.push(input);
    return {
      outTradeNo: input.outTradeNo,
      status: "paid",
      paymentType: input.paymentType,
      creditUsd: "10",
      usdToCnyRate: "7.2",
      moneyCny: "72.00",
      createdAt: 1,
      paidAt: 2,
    };
  }
}

function signedCallback(patch: Record<string, string> = {}) {
  const params: Record<string, string> = {
    pid: "1001",
    name: "Echoo AI 服务额度充值 10 美元",
    money: "72.00",
    out_trade_no: "1234567890123456789012345678",
    trade_no: "zpay_trade_1",
    trade_status: "TRADE_SUCCESS",
    type: "alipay",
    sign_type: "MD5",
    ...patch,
  };
  params.sign = signZpayParams(params, paymentConfig.key);
  return params;
}

test("accepts a correctly signed successful callback", async () => {
  const service = new CallbackTestService();
  await service.processCallback(signedCallback());
  assert.deepEqual(service.settlements, [
    {
      outTradeNo: "1234567890123456789012345678",
      providerTradeNo: "zpay_trade_1",
      paymentType: "alipay",
      moneyFen: 7_200,
      productName: "Echoo AI 服务额度充值 10 美元",
    },
  ]);
});

test("rejects tampered, wrong-merchant, and non-success callbacks", async () => {
  const service = new CallbackTestService();
  const tampered = signedCallback();
  tampered.money = "0.01";
  await assert.rejects(
    service.processCallback(tampered),
    PaymentValidationError,
  );
  await assert.rejects(
    service.processCallback(signedCallback({ pid: "other" })),
    PaymentValidationError,
  );
  await assert.rejects(
    service.processCallback(signedCallback({ trade_status: "WAIT_BUYER_PAY" })),
    PaymentValidationError,
  );
  assert.equal(service.settlements.length, 0);
});

test("matches every provider result field against the locked local order", () => {
  const order = {
    payment_type: "alipay" as const,
    pay_amount_fen: 7_200,
    product_name: "Echoo AI 服务额度充值 10 美元",
    provider_trade_no: null,
  };
  const verified = {
    providerTradeNo: "zpay_trade_1",
    paymentType: "alipay" as const,
    moneyFen: 7_200,
    productName: order.product_name,
  };
  assert.doesNotThrow(() => validatePaymentAgainstOrder(order, verified));
  assert.throws(
    () =>
      validatePaymentAgainstOrder(order, {
        ...verified,
        moneyFen: 1,
      }),
    PaymentValidationError,
  );
  assert.throws(
    () =>
      validatePaymentAgainstOrder(order, {
        ...verified,
        productName: "其它商品",
      }),
    PaymentValidationError,
  );
  assert.throws(
    () =>
      validatePaymentAgainstOrder(order, {
        ...verified,
        paymentType: "wxpay",
      }),
    PaymentValidationError,
  );
  assert.throws(
    () =>
      validatePaymentAgainstOrder(
        { ...order, provider_trade_no: "already_paid_trade" },
        verified,
      ),
    PaymentValidationError,
  );
});

test("creates a checkout from the current rate and signs all POST fields", async () => {
  let rate = "7.2";
  class CheckoutTestService extends RechargeService {
    readonly orders = new Map<string, any>();

    protected override async insertOrderWithUniqueNumber(input: any) {
      const row = {
        out_trade_no: input.rateMicro === 7_200_000 ? "1000000000000000000000000001" : "1000000000000000000000000002",
        owner_user_id: input.ownerUserId,
        payment_type: input.paymentType,
        product_name: input.productName,
        credit_micro_usd: input.creditMicroUsd,
        usd_to_cny_rate_micro: input.rateMicro,
        pay_amount_fen: input.payAmountFen,
        status: "pending",
        provider_trade_no: null,
        credited_ledger_id: null,
        last_provider_query_at: null,
        created_at: input.now,
        updated_at: input.now,
        paid_at: null,
      } as any;
      this.orders.set(row.out_trade_no, row);
      return row;
    }

    protected override async findOrder(outTradeNo: string) {
      return this.orders.get(outTradeNo) ?? null;
    }
  }
  const service = new CheckoutTestService({
    paymentConfig,
    now: () => 123,
    settings: {
      getUsdToCnyRate: async () => rate,
    } as never,
  });
  const first = await service.createOrder({
    ownerUserId: "user_1",
    creditUsd: "10",
    paymentType: "alipay",
  });
  assert.equal(first.order.usdToCnyRate, "7.2");
  assert.equal(first.order.moneyCny, "72.00");
  assert.equal(first.form.actionUrl, "https://zpayz.cn/submit.php");
  assert.match(
    first.externalCheckoutUrl,
    /^https:\/\/api\.example\.com\/api\/payments\/zpay\/checkout\?/,
  );
  assert.equal(first.externalCheckoutUrl.includes(paymentConfig.key), false);
  assert.equal(
    first.form.fields.sign,
    signZpayParams(first.form.fields, paymentConfig.key),
  );

  rate = "8";
  const second = await service.createOrder({
    ownerUserId: "user_1",
    creditUsd: "10",
    paymentType: "wxpay",
  });
  assert.equal(second.order.usdToCnyRate, "8");
  assert.equal(second.order.moneyCny, "80.00");
  assert.equal(first.order.moneyCny, "72.00");

  const externalUrl = new URL(first.externalCheckoutUrl);
  const external = await service.getExternalCheckout(
    externalUrl.searchParams.get("outTradeNo")!,
    externalUrl.searchParams.get("token")!,
  );
  assert.equal(external.status, "pending");
  if (external.status === "pending") {
    assert.equal(
      external.form.fields.return_url,
      "https://api.example.com/api/payments/zpay/native-return",
    );
    assert.equal(
      external.form.fields.sign,
      signZpayParams(external.form.fields, paymentConfig.key),
    );
  }
  await assert.rejects(
    service.getExternalCheckout(
      first.order.outTradeNo,
      `${externalUrl.searchParams.get("token")!.slice(0, -1)}${externalUrl.searchParams.get("token")!.endsWith("0") ? "1" : "0"}`,
    ),
    PaymentValidationError,
  );

  service.orders.get(first.order.outTradeNo)!.status = "paid";
  assert.deepEqual(
    await service.getExternalCheckout(
      first.order.outTradeNo,
      externalUrl.searchParams.get("token")!,
    ),
    { status: "paid" },
  );
});
