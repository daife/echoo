import { randomUUID } from "node:crypto";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import {
  execute,
  queryOne,
  queryRows,
  withTransaction,
} from "../../infra/database/mysql.js";
import { BillingContext } from "./billing-context.js";

interface AccountRow extends RowDataPacket {
  balance_micro_usd: number;
}

interface LedgerRow extends RowDataPacket {
  id: string;
  kind: "admin_credit" | "admin_debit" | "usage";
  amount_micro_usd: number;
  balance_after_micro_usd: number;
  service: string | null;
  model: string | null;
  note: string | null;
  created_at: number;
}

interface SettingRow extends RowDataPacket {
  value_json: unknown;
}

export class InsufficientPlatformBalanceError extends Error {
  readonly code = "INSUFFICIENT_PLATFORM_BALANCE";
}

export class BillingService {
  async assertPlatformBalance() {
    const context = BillingContext.current();
    if (!context) return;
    const balance = await this.ensureAccount(context.ownerUserId);
    if (balance <= 0)
      throw new InsufficientPlatformBalanceError(
        "平台余额不足，请充值后再使用平台提供的 AI 服务。",
      );
  }

  async chargeUsage(input: {
    service: "openrouter" | "fish_audio";
    model: string;
    upstreamRequestId: string;
    upstreamCostUsd: number;
    metadata?: Record<string, unknown>;
  }) {
    const context = BillingContext.current();
    if (!context || !Number.isFinite(input.upstreamCostUsd)) return;
    const multiplier = await this.getMultiplier();
    const chargeMicroUsd = Math.max(
      0,
      Math.round(input.upstreamCostUsd * multiplier * 1_000_000),
    );
    if (!chargeMicroUsd) return;
    await withTransaction(async (connection) => {
      await this.ensureAccount(context.ownerUserId, connection);
      const duplicate = await queryOne<RowDataPacket & { id: string }>(
        "SELECT id FROM billing_ledger WHERE service = ? AND upstream_request_id = ?",
        [input.service, input.upstreamRequestId],
        connection,
      );
      if (duplicate) return;
      const account = await queryOne<AccountRow>(
        "SELECT balance_micro_usd FROM billing_accounts WHERE owner_user_id = ? FOR UPDATE",
        [context.ownerUserId],
        connection,
      );
      const nextBalance = (account?.balance_micro_usd ?? 0) - chargeMicroUsd;
      const now = Date.now();
      await execute(
        "UPDATE billing_accounts SET balance_micro_usd = ?, updated_at = ? WHERE owner_user_id = ?",
        [nextBalance, now, context.ownerUserId],
        connection,
      );
      await execute(
        `INSERT INTO billing_ledger
         (id, owner_user_id, kind, amount_micro_usd, balance_after_micro_usd,
          service, model, upstream_request_id, metadata, created_at)
         VALUES (?, ?, 'usage', ?, ?, ?, ?, ?, ?, ?)`,
        [
          `bill_${randomUUID()}`,
          context.ownerUserId,
          -chargeMicroUsd,
          nextBalance,
          input.service,
          input.model,
          input.upstreamRequestId,
          JSON.stringify({
            upstreamCostUsd: input.upstreamCostUsd,
            multiplier,
            conversationId: context.conversationId,
            ...input.metadata,
          }),
          now,
        ],
        connection,
      );
    });
  }

  async adjustBalance(input: {
    ownerUserId: string;
    amountUsd: string;
    note: string;
  }) {
    const amount = parseUsdToMicro(input.amountUsd);
    if (!amount) throw new Error("调整金额不能为 0。");
    return withTransaction(async (connection) => {
      await this.ensureAccount(input.ownerUserId, connection);
      const account = await queryOne<AccountRow>(
        "SELECT balance_micro_usd FROM billing_accounts WHERE owner_user_id = ? FOR UPDATE",
        [input.ownerUserId],
        connection,
      );
      const nextBalance = (account?.balance_micro_usd ?? 0) + amount;
      const now = Date.now();
      await execute(
        "UPDATE billing_accounts SET balance_micro_usd = ?, updated_at = ? WHERE owner_user_id = ?",
        [nextBalance, now, input.ownerUserId],
        connection,
      );
      await execute(
        `INSERT INTO billing_ledger
         (id, owner_user_id, kind, amount_micro_usd, balance_after_micro_usd, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          `bill_${randomUUID()}`,
          input.ownerUserId,
          amount > 0 ? "admin_credit" : "admin_debit",
          amount,
          nextBalance,
          input.note,
          now,
        ],
        connection,
      );
      return { balanceUsd: formatMicroUsd(nextBalance) };
    });
  }

  async getWallet(ownerUserId: string) {
    const balance = await this.ensureAccount(ownerUserId);
    const rows = await queryRows<LedgerRow>(
      `SELECT id, kind, amount_micro_usd, balance_after_micro_usd,
              service, model, note, created_at
         FROM billing_ledger WHERE owner_user_id = ?
        ORDER BY created_at DESC LIMIT 100`,
      [ownerUserId],
    );
    return {
      balanceUsd: formatMicroUsd(balance),
      entries: rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        amountUsd: formatMicroUsd(row.amount_micro_usd),
        balanceAfterUsd: formatMicroUsd(row.balance_after_micro_usd),
        ...(row.service ? { service: row.service } : {}),
        ...(row.model ? { model: row.model } : {}),
        ...(row.note ? { note: row.note } : {}),
        createdAt: row.created_at,
      })),
    };
  }

  async getMultiplier() {
    const row = await queryOne<SettingRow>(
      "SELECT value_json FROM platform_settings WHERE setting_key = 'billing_multiplier'",
    );
    const value = parseJson(row?.value_json) as { value?: unknown } | null;
    return typeof value?.value === "number" && value.value > 0
      ? value.value
      : 1;
  }

  async setMultiplier(value: number) {
    if (!Number.isFinite(value) || value <= 0 || value > 100)
      throw new Error("计费倍率必须在 0 到 100 之间。");
    await execute(
      `INSERT INTO platform_settings (setting_key, value_json, updated_at)
       VALUES ('billing_multiplier', ?, ?)
       ON DUPLICATE KEY UPDATE value_json = VALUES(value_json), updated_at = VALUES(updated_at)`,
      [JSON.stringify({ value }), Date.now()],
    );
    return { billingMultiplier: value };
  }

  private async ensureAccount(
    ownerUserId: string,
    connection?: PoolConnection,
  ) {
    const now = Date.now();
    await execute(
      `INSERT IGNORE INTO billing_accounts
       (owner_user_id, balance_micro_usd, created_at, updated_at) VALUES (?, 0, ?, ?)`,
      [ownerUserId, now, now],
      connection,
    );
    const row = await queryOne<AccountRow>(
      "SELECT balance_micro_usd FROM billing_accounts WHERE owner_user_id = ?",
      [ownerUserId],
      connection,
    );
    return row?.balance_micro_usd ?? 0;
  }
}

export function formatMicroUsd(value: number) {
  return (value / 1_000_000).toFixed(6).replace(/\.?0+$/, "") || "0";
}

function parseUsdToMicro(value: string) {
  if (!/^-?\d+(?:\.\d{1,6})?$/.test(value.trim()))
    throw new Error("金额必须是最多 6 位小数的美元数值。");
  const negative = value.trim().startsWith("-");
  const unsigned = value.trim().replace(/^-/, "");
  const [whole, fraction = ""] = unsigned.split(".");
  const micro = Number(whole) * 1_000_000 + Number(fraction.padEnd(6, "0"));
  if (!Number.isSafeInteger(micro)) throw new Error("金额超出支持范围。");
  return negative ? -micro : micro;
}

function parseJson(value: unknown) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
