import { formatMicroUsd } from "../billing/money.js";
import { normalizeUsdToCnyRate } from "../platform-settings/platform-settings.service.js";

export const MINIMUM_RECHARGE_MICRO_USD = 1_000_000;
export const MAXIMUM_RECHARGE_MICRO_USD = 1_000_000_000;

export function parseRechargeUsd(value: string) {
  const trimmed = value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(trimmed))
    throw new Error("充值额度必须是最多两位小数的美元金额。");
  const [whole, fraction = ""] = trimmed.split(".");
  const micro =
    BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(2, "0")) * 10_000n;
  if (
    micro < BigInt(MINIMUM_RECHARGE_MICRO_USD) ||
    micro > BigInt(MAXIMUM_RECHARGE_MICRO_USD)
  )
    throw new Error("充值额度必须在 1 到 1000 美元之间。");
  return Number(micro);
}

export function parseUsdToCnyRateMicro(value: string) {
  const normalized = normalizeUsdToCnyRate(value);
  const [whole, fraction = ""] = normalized.split(".");
  return Number(
    BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0")),
  );
}

export function calculatePayAmountFen(
  creditMicroUsd: number,
  rateMicro: number,
) {
  if (!Number.isSafeInteger(creditMicroUsd) || creditMicroUsd <= 0)
    throw new Error("充值美元额度无效。");
  if (!Number.isSafeInteger(rateMicro) || rateMicro <= 0)
    throw new Error("美元兑人民币汇率无效。");
  const product = BigInt(creditMicroUsd) * BigInt(rateMicro);
  const fen = (product + 5_000_000_000n) / 10_000_000_000n;
  if (fen <= 0n || fen > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("人民币支付金额超出支持范围。");
  return Number(fen);
}

export function parseCnyToFen(value: string) {
  const trimmed = value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(trimmed))
    throw new Error("人民币支付金额格式无效。");
  const [whole, fraction = ""] = trimmed.split(".");
  const fen = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  if (fen > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("人民币支付金额超出支持范围。");
  return Number(fen);
}

export function formatFen(value: number) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error("人民币分金额无效。");
  return `${Math.floor(value / 100)}.${String(value % 100).padStart(2, "0")}`;
}

export function formatRechargeUsd(value: number) {
  return formatMicroUsd(value);
}

