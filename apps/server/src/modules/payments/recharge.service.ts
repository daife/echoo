import { randomBytes } from "node:crypto";
import type {
  RechargeCheckoutView,
  RechargeConfigView,
  RechargeOrderView,
  RechargePaymentType,
} from "@echoo/shared";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { environment } from "../../infra/config/environment.js";
import {
  execute,
  queryOne,
  withTransaction,
} from "../../infra/database/mysql.js";
import { PlatformSettingsService } from "../platform-settings/platform-settings.service.js";
import {
  calculatePayAmountFen,
  formatFen,
  formatRechargeUsd,
  parseCnyToFen,
  parseRechargeUsd,
  parseUsdToCnyRateMicro,
} from "./recharge-money.js";
import {
  signZpayParams,
  verifyZpaySignature,
  type ZpaySignableParams,
} from "./zpay-signature.js";

const QUERY_INTERVAL_MS = 15_000;
const PROVIDER_TIMEOUT_MS = 3_000;
const QUICK_AMOUNTS = ["5", "10", "20", "50", "100"] as const;

interface RechargeOrderRow extends RowDataPacket {
  out_trade_no: string;
  owner_user_id: string;
  payment_type: RechargePaymentType;
  product_name: string;
  credit_micro_usd: number;
  usd_to_cny_rate_micro: number;
  pay_amount_fen: number;
  status: "pending" | "paid";
  provider_trade_no: string | null;
  credited_ledger_id: string | null;
  last_provider_query_at: number | null;
  created_at: number;
  updated_at: number;
  paid_at: number | null;
}

interface AccountRow extends RowDataPacket {
  balance_micro_usd: number;
}

interface ZpayQueryResponse {
  code?: number | string;
  msg?: string;
  trade_no?: string;
  out_trade_no?: string;
  type?: string;
  pid?: string;
  name?: string;
  money?: string;
  status?: number | string;
}

interface RechargeServiceOptions {
  settings?: PlatformSettingsService;
  fetcher?: typeof fetch;
  now?: () => number;
  paymentConfig?: ZpayPaymentConfig | null;
}

export interface ZpayPaymentConfig {
  publicServerUrl: string;
  pid: string;
  key: string;
  cid?: string;
  baseUrl: string;
}

export interface VerifiedRechargePayment {
  outTradeNo: string;
  providerTradeNo: string;
  paymentType: RechargePaymentType;
  moneyFen: number;
  productName: string;
}

export class PaymentUnavailableError extends Error {
  readonly code = "RECHARGE_DISABLED";
}

export class PaymentValidationError extends Error {
  readonly code = "INVALID_PAYMENT";
}

export class PaymentOrderNotFoundError extends Error {
  readonly code = "RECHARGE_ORDER_NOT_FOUND";
}

export class PaymentUpstreamError extends Error {
  readonly code = "ZPAY_QUERY_FAILED";
}

export class RechargeService {
  private readonly settings: PlatformSettingsService;
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  private readonly paymentConfig: ZpayPaymentConfig | null;

  constructor(options: RechargeServiceOptions = {}) {
    this.settings = options.settings ?? new PlatformSettingsService();
    this.fetcher = options.fetcher ?? fetch;
    this.now = options.now ?? Date.now;
    this.paymentConfig =
      options.paymentConfig === undefined
        ? paymentConfigFromEnvironment()
        : options.paymentConfig;
  }

  isPaymentConfigured() {
    return this.paymentConfig !== null;
  }

  async getConfig(): Promise<RechargeConfigView> {
    const rate = await this.settings.getUsdToCnyRate();
    return {
      enabled: this.isPaymentConfigured() && rate !== null,
      usdToCnyRate: rate,
      minimumCreditUsd: "1",
      maximumCreditUsd: "1000",
      quickAmountsUsd: [...QUICK_AMOUNTS],
      paymentTypes: ["alipay", "wxpay"],
    };
  }

  async createOrder(input: {
    ownerUserId: string;
    creditUsd: string;
    paymentType: RechargePaymentType;
  }): Promise<RechargeCheckoutView> {
    const payment = this.requirePaymentConfig();
    const rate = await this.settings.getUsdToCnyRate();
    if (!rate)
      throw new PaymentUnavailableError("管理员尚未设置美元兑人民币汇率。");
    const creditMicroUsd = parseRechargeUsd(input.creditUsd);
    const rateMicro = parseUsdToCnyRateMicro(rate);
    const payAmountFen = calculatePayAmountFen(creditMicroUsd, rateMicro);
    const creditUsd = formatRechargeUsd(creditMicroUsd);
    const productName = `Echoo AI 服务额度充值 ${creditUsd} 美元`;
    const now = this.now();
    const row = await this.insertOrderWithUniqueNumber({
      ownerUserId: input.ownerUserId,
      paymentType: input.paymentType,
      productName,
      creditMicroUsd,
      rateMicro,
      payAmountFen,
      now,
    });
    const fields: Record<string, string> = {
      name: row.product_name,
      money: formatFen(row.pay_amount_fen),
      type: row.payment_type,
      out_trade_no: row.out_trade_no,
      notify_url: `${payment.publicServerUrl}/api/payments/zpay/notify`,
      pid: payment.pid,
      return_url: `${payment.publicServerUrl}/api/payments/zpay/return`,
      sign_type: "MD5",
      ...(payment.cid ? { cid: payment.cid } : {}),
    };
    fields.sign = signZpayParams(fields, payment.key);
    return {
      order: toOrderView(row),
      form: {
        actionUrl: `${payment.baseUrl}/submit.php`,
        method: "POST",
        fields,
      },
    };
  }

  async getOrder(ownerUserId: string, outTradeNo: string) {
    const row = await this.findOwnedOrder(ownerUserId, outTradeNo);
    if (!row) throw new PaymentOrderNotFoundError("充值订单不存在。");
    return toOrderView(row);
  }

  async processCallback(input: Record<string, unknown>) {
    const payment = this.requirePaymentConfig();
    const params = normalizeCallbackParams(input);
    if (params.sign_type?.toUpperCase() !== "MD5")
      throw new PaymentValidationError("支付签名类型无效。");
    if (!verifyZpaySignature(params, payment.key))
      throw new PaymentValidationError("支付通知签名无效。");
    if (params.pid !== payment.pid)
      throw new PaymentValidationError("支付通知商户 ID 不匹配。");
    if (params.trade_status !== "TRADE_SUCCESS")
      throw new PaymentValidationError("支付尚未成功。");
    const outTradeNo = validateOutTradeNo(params.out_trade_no);
    const providerTradeNo = validateProviderTradeNo(params.trade_no);
    const paymentType = validatePaymentType(params.type);
    const moneyFen = parseCnyToFen(params.money ?? "");
    const productName = params.name ?? "";
    return this.settleVerifiedPayment({
      outTradeNo,
      providerTradeNo,
      paymentType,
      moneyFen,
      productName,
    });
  }

  async reconcile(ownerUserId: string, outTradeNo: string) {
    const payment = this.requirePaymentConfig();
    const claimed = await this.claimProviderQuery(ownerUserId, outTradeNo);
    if (claimed.row.status === "paid" || !claimed.shouldQuery)
      return toOrderView(claimed.row);

    const url = new URL(`${payment.baseUrl}/api.php`);
    url.searchParams.set("act", "order");
    url.searchParams.set("pid", payment.pid);
    url.searchParams.set("key", payment.key);
    url.searchParams.set("out_trade_no", claimed.row.out_trade_no);
    let response: Response;
    try {
      response = await this.fetcher(url, {
        method: "GET",
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      });
    } catch {
      throw new PaymentUpstreamError("查询支付状态超时，请稍后重试。");
    }
    if (!response.ok)
      throw new PaymentUpstreamError("支付平台暂时无法查询，请稍后重试。");
    let payload: ZpayQueryResponse;
    try {
      payload = (await response.json()) as ZpayQueryResponse;
    } catch {
      throw new PaymentUpstreamError("支付平台返回了无法识别的结果。");
    }
    if (Number(payload.code) !== 1)
      throw new PaymentUpstreamError(payload.msg || "支付平台查询失败。");
    if (Number(payload.status) !== 1) return toOrderView(claimed.row);
    if (providerString(payload.pid) !== payment.pid)
      throw new PaymentValidationError("查询结果商户 ID 不匹配。");
    if (providerString(payload.out_trade_no) !== claimed.row.out_trade_no)
      throw new PaymentValidationError("查询结果订单号不匹配。");
    return this.settleVerifiedPayment({
      outTradeNo: claimed.row.out_trade_no,
      providerTradeNo: validateProviderTradeNo(providerString(payload.trade_no)),
      paymentType: validatePaymentType(providerString(payload.type)),
      moneyFen: parseCnyToFen(providerString(payload.money) ?? ""),
      productName: providerString(payload.name) ?? "",
    });
  }

  private requirePaymentConfig() {
    if (!this.paymentConfig)
      throw new PaymentUnavailableError("在线充值尚未配置。");
    return this.paymentConfig;
  }

  protected async insertOrderWithUniqueNumber(input: {
    ownerUserId: string;
    paymentType: RechargePaymentType;
    productName: string;
    creditMicroUsd: number;
    rateMicro: number;
    payAmountFen: number;
    now: number;
  }) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const outTradeNo = generateOutTradeNo(input.now);
      try {
        await execute(
          `INSERT INTO recharge_orders
           (out_trade_no, owner_user_id, payment_type, product_name,
            credit_micro_usd, usd_to_cny_rate_micro, pay_amount_fen,
            status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
          [
            outTradeNo,
            input.ownerUserId,
            input.paymentType,
            input.productName,
            input.creditMicroUsd,
            input.rateMicro,
            input.payAmountFen,
            input.now,
            input.now,
          ],
        );
        return (await this.findOrder(outTradeNo))!;
      } catch (error) {
        if (!isDuplicateEntry(error) || attempt === 2) throw error;
      }
    }
    throw new Error("无法生成唯一充值订单号。");
  }

  private async claimProviderQuery(ownerUserId: string, outTradeNo: string) {
    validateOutTradeNo(outTradeNo);
    return withTransaction(async (connection) => {
      const row = await this.findOrder(outTradeNo, connection, true);
      if (!row || row.owner_user_id !== ownerUserId)
        throw new PaymentOrderNotFoundError("充值订单不存在。");
      const now = this.now();
      const shouldQuery =
        row.status === "pending" &&
        (row.last_provider_query_at === null ||
          now - row.last_provider_query_at >= QUERY_INTERVAL_MS);
      if (shouldQuery) {
        await execute(
          "UPDATE recharge_orders SET last_provider_query_at = ?, updated_at = ? WHERE out_trade_no = ?",
          [now, now, outTradeNo],
          connection,
        );
        row.last_provider_query_at = now;
        row.updated_at = now;
      }
      return { row, shouldQuery };
    });
  }

  protected settleVerifiedPayment(input: VerifiedRechargePayment) {
    return withTransaction(async (connection) => {
      const order = await this.findOrder(input.outTradeNo, connection, true);
      if (!order) throw new PaymentValidationError("支付订单不存在。");
      validatePaymentAgainstOrder(order, input);
      if (order.status === "paid") return toOrderView(order);

      const now = this.now();
      await execute(
        `INSERT IGNORE INTO billing_accounts
         (owner_user_id, balance_micro_usd, created_at, updated_at)
         VALUES (?, 0, ?, ?)`,
        [order.owner_user_id, now, now],
        connection,
      );
      const account = await queryOne<AccountRow>(
        "SELECT balance_micro_usd FROM billing_accounts WHERE owner_user_id = ? FOR UPDATE",
        [order.owner_user_id],
        connection,
      );
      const currentBalance = account?.balance_micro_usd ?? 0;
      const nextBalance = currentBalance + order.credit_micro_usd;
      if (!Number.isSafeInteger(nextBalance))
        throw new Error("充值后的账户余额超出支持范围。");
      const ledgerId = `recharge_${order.out_trade_no}`;
      await execute(
        "UPDATE billing_accounts SET balance_micro_usd = ?, updated_at = ? WHERE owner_user_id = ?",
        [nextBalance, now, order.owner_user_id],
        connection,
      );
      await execute(
        `INSERT INTO billing_ledger
         (id, owner_user_id, kind, amount_micro_usd, balance_after_micro_usd,
          note, metadata, created_at)
         VALUES (?, ?, 'recharge', ?, ?, ?, ?, ?)`,
        [
          ledgerId,
          order.owner_user_id,
          order.credit_micro_usd,
          nextBalance,
          "在线充值",
          JSON.stringify({
            outTradeNo: order.out_trade_no,
            providerTradeNo: input.providerTradeNo,
            paymentType: order.payment_type,
            moneyCny: formatFen(order.pay_amount_fen),
            usdToCnyRate: formatRateMicro(order.usd_to_cny_rate_micro),
          }),
          now,
        ],
        connection,
      );
      await execute(
        `UPDATE recharge_orders
            SET status = 'paid', provider_trade_no = ?, credited_ledger_id = ?,
                paid_at = ?, updated_at = ?
          WHERE out_trade_no = ?`,
        [input.providerTradeNo, ledgerId, now, now, order.out_trade_no],
        connection,
      );
      return toOrderView({
        ...order,
        status: "paid",
        provider_trade_no: input.providerTradeNo,
        credited_ledger_id: ledgerId,
        paid_at: now,
        updated_at: now,
      });
    });
  }

  private findOwnedOrder(ownerUserId: string, outTradeNo: string) {
    validateOutTradeNo(outTradeNo);
    return queryOne<RechargeOrderRow>(
      "SELECT * FROM recharge_orders WHERE out_trade_no = ? AND owner_user_id = ?",
      [outTradeNo, ownerUserId],
    );
  }

  private findOrder(
    outTradeNo: string,
    connection?: PoolConnection,
    lock = false,
  ) {
    return queryOne<RechargeOrderRow>(
      `SELECT * FROM recharge_orders WHERE out_trade_no = ?${lock ? " FOR UPDATE" : ""}`,
      [outTradeNo],
      connection,
    );
  }
}

function paymentConfigFromEnvironment(): ZpayPaymentConfig | null {
  if (
    !environment.zpayEnabled ||
    !environment.publicServerUrl ||
    !environment.zpayPid ||
    !environment.zpayKey
  )
    return null;
  return {
    publicServerUrl: environment.publicServerUrl.replace(/\/+$/, ""),
    pid: environment.zpayPid,
    key: environment.zpayKey,
    ...(environment.zpayCid ? { cid: environment.zpayCid } : {}),
    baseUrl: environment.zpayBaseUrl,
  };
}

function normalizeCallbackParams(input: Record<string, unknown>) {
  const params: ZpaySignableParams = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value !== "string")
      throw new PaymentValidationError("支付通知参数格式无效。");
    params[key] = value;
  }
  return params;
}

export function validatePaymentAgainstOrder(
  order: Pick<
    RechargeOrderRow,
    | "payment_type"
    | "pay_amount_fen"
    | "product_name"
    | "provider_trade_no"
  >,
  input: {
    providerTradeNo: string;
    paymentType: RechargePaymentType;
    moneyFen: number;
    productName: string;
  },
) {
  if (order.payment_type !== input.paymentType)
    throw new PaymentValidationError("支付方式与订单不匹配。");
  if (order.pay_amount_fen !== input.moneyFen)
    throw new PaymentValidationError("支付金额与订单不匹配。");
  if (order.product_name !== input.productName)
    throw new PaymentValidationError("支付商品名称与订单不匹配。");
  if (
    order.provider_trade_no &&
    order.provider_trade_no !== input.providerTradeNo
  )
    throw new PaymentValidationError("支付平台订单号与已入账记录不匹配。");
}

function validateOutTradeNo(value: string | undefined) {
  if (!value || !/^\d{1,32}$/.test(value))
    throw new PaymentValidationError("商户订单号无效。");
  return value;
}

function validateProviderTradeNo(value: string | undefined) {
  const normalized = value?.trim() ?? "";
  if (!normalized || normalized.length > 64)
    throw new PaymentValidationError("支付平台订单号无效。");
  return normalized;
}

function validatePaymentType(value: string | undefined): RechargePaymentType {
  if (value !== "alipay" && value !== "wxpay")
    throw new PaymentValidationError("支付方式无效。");
  return value;
}

function generateOutTradeNo(now: number) {
  const timestamp = String(Math.max(0, Math.floor(now))).padStart(13, "0").slice(-13);
  const random = Array.from(randomBytes(15), (value) => String(value % 10)).join("");
  return `${timestamp}${random}`;
}

function formatRateMicro(value: number) {
  const whole = Math.floor(value / 1_000_000);
  const fraction = String(value % 1_000_000)
    .padStart(6, "0")
    .replace(/0+$/, "");
  return `${whole}${fraction ? `.${fraction}` : ""}`;
}

function toOrderView(row: RechargeOrderRow): RechargeOrderView {
  return {
    outTradeNo: row.out_trade_no,
    status: row.status,
    paymentType: row.payment_type,
    creditUsd: formatRechargeUsd(row.credit_micro_usd),
    usdToCnyRate: formatRateMicro(row.usd_to_cny_rate_micro),
    moneyCny: formatFen(row.pay_amount_fen),
    createdAt: row.created_at,
    ...(row.paid_at !== null ? { paidAt: row.paid_at } : {}),
  };
}

function isDuplicateEntry(error: unknown) {
  const value = error as { code?: string; errno?: number };
  return value?.code === "ER_DUP_ENTRY" || value?.errno === 1062;
}

function providerString(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : undefined;
}
