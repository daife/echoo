import type { RowDataPacket } from "mysql2";
import type {
  AdminRewardSettingsRequest,
  RewardSettingsView,
} from "@echoo/shared";
import { execute, queryOne } from "../../infra/database/mysql.js";
import {
  normalizeNonNegativeUsd,
  parseUsdToMicro,
} from "../billing/money.js";
import { buildRuntimeConfigDefaults } from "../runtime-config/runtime-config.defaults.js";
import type { StoredUserRuntimeConfig } from "../runtime-config/runtime-config.types.js";
import type { StoredRuntimeConfigPresets } from "../runtime-config/runtime-config.types.js";

interface SettingRow extends RowDataPacket {
  value_json: unknown;
  updated_at: number;
}

const BILLING_MULTIPLIER = "billing_multiplier";
const NEW_USER_RUNTIME_DEFAULTS = "new_user_runtime_defaults";
const RUNTIME_CONFIG_PRESETS = "runtime_config_presets";
const REWARD_SETTINGS = "reward_settings";
const USD_TO_CNY_RATE = "usd_to_cny_rate";
const DEFAULT_NEW_USER_INITIAL_CREDIT_USD = "0.015";

export class PlatformSettingsService {
  async getUsdToCnyRate(): Promise<string | null> {
    const row = await this.find(USD_TO_CNY_RATE);
    const parsed = parseJson(row?.value_json);
    const value =
      typeof parsed === "string"
        ? parsed
        : typeof (parsed as { value?: unknown } | null)?.value === "string"
          ? (parsed as { value: string }).value
          : null;
    if (!value) return null;
    try {
      return normalizeUsdToCnyRate(value);
    } catch {
      return null;
    }
  }

  async setUsdToCnyRate(value: string) {
    const normalized = normalizeUsdToCnyRate(value);
    await this.save(USD_TO_CNY_RATE, normalized);
    return normalized;
  }

  async getBillingMultiplier() {
    const row = await this.find(BILLING_MULTIPLIER);
    const parsed = parseJson(row?.value_json);
    const value =
      typeof parsed === "number"
        ? parsed
        : typeof (parsed as { value?: unknown } | null)?.value === "number"
          ? (parsed as { value: number }).value
          : 1;
    return Number.isFinite(value) && value > 0 ? value : 1;
  }

  async setBillingMultiplier(value: number) {
    if (!Number.isFinite(value) || value <= 0 || value > 100)
      throw new Error("计费倍率必须大于 0 且不超过 100。");
    await this.save(BILLING_MULTIPLIER, value);
    return value;
  }

  async getRewardSettings(): Promise<RewardSettingsView> {
    const row = await this.find(REWARD_SETTINGS);
    const parsed = parseJson(row?.value_json) as
      | {
          newUserInitialCreditUsd?: unknown;
          invitation?: {
            inviterRewardUsd?: unknown;
            inviteeRewardUsd?: unknown;
          };
          promotion?: {
            minimumLikes?: unknown;
            usdPerLike?: unknown;
            maxRewardUsd?: unknown;
          };
        }
      | null;
    const newUserInitialCreditUsd = safeUsd(
      parsed?.newUserInitialCreditUsd,
      DEFAULT_NEW_USER_INITIAL_CREDIT_USD,
    );
    const inviterRewardUsd = safeUsd(parsed?.invitation?.inviterRewardUsd);
    const inviteeRewardUsd = safeUsd(parsed?.invitation?.inviteeRewardUsd);
    const usdPerLike = safeUsd(parsed?.promotion?.usdPerLike);
    const maxRewardUsd = safeUsd(parsed?.promotion?.maxRewardUsd);
    const minimumLikes =
      Number.isSafeInteger(parsed?.promotion?.minimumLikes) &&
      Number(parsed?.promotion?.minimumLikes) >= 0
        ? Number(parsed?.promotion?.minimumLikes)
        : 0;
    return {
      newUserInitialCreditUsd,
      invitation: {
        inviterRewardUsd,
        inviteeRewardUsd,
        enabled:
          parseUsdToMicro(inviterRewardUsd) > 0 &&
          parseUsdToMicro(inviteeRewardUsd) > 0,
      },
      promotion: {
        minimumLikes,
        usdPerLike,
        maxRewardUsd,
        enabled:
          parseUsdToMicro(usdPerLike) > 0 &&
          parseUsdToMicro(maxRewardUsd) > 0,
        requiredTag: "echoo",
      },
      creator: { rewardPercent: 1 },
    };
  }

  async setRewardSettings(input: AdminRewardSettingsRequest) {
    const current = await this.getRewardSettings();
    const next = {
      newUserInitialCreditUsd:
        input.newUserInitialCreditUsd === undefined
          ? current.newUserInitialCreditUsd
          : normalizeNonNegativeUsd(input.newUserInitialCreditUsd),
      invitation: input.invitation
        ? {
            inviterRewardUsd: normalizeNonNegativeUsd(
              input.invitation.inviterRewardUsd,
            ),
            inviteeRewardUsd: normalizeNonNegativeUsd(
              input.invitation.inviteeRewardUsd,
            ),
          }
        : {
            inviterRewardUsd: current.invitation.inviterRewardUsd,
            inviteeRewardUsd: current.invitation.inviteeRewardUsd,
          },
      promotion: input.promotion
        ? {
            minimumLikes: validateMinimumLikes(
              input.promotion.minimumLikes,
            ),
            usdPerLike: normalizeNonNegativeUsd(input.promotion.usdPerLike),
            maxRewardUsd: normalizeNonNegativeUsd(
              input.promotion.maxRewardUsd,
            ),
          }
        : {
            minimumLikes: current.promotion.minimumLikes,
            usdPerLike: current.promotion.usdPerLike,
            maxRewardUsd: current.promotion.maxRewardUsd,
          },
    };
    await this.save(REWARD_SETTINGS, next);
    return this.getRewardSettings();
  }

  async getNewUserInitialCreditUsd() {
    return (await this.getRewardSettings()).newUserInitialCreditUsd;
  }

  async getNewUserRuntimeDefaults(): Promise<{
    config: StoredUserRuntimeConfig;
    updatedAt: number;
  }> {
    let row = await this.find(NEW_USER_RUNTIME_DEFAULTS);
    if (!row) {
      const defaults = buildRuntimeConfigDefaults();
      const now = Date.now();
      await execute(
        `INSERT IGNORE INTO platform_settings (setting_key, value_json, updated_at)
         VALUES (?, ?, ?)`,
        [NEW_USER_RUNTIME_DEFAULTS, JSON.stringify(defaults), now],
      );
      row = await this.find(NEW_USER_RUNTIME_DEFAULTS);
      if (!row) return { config: defaults, updatedAt: now };
    }
    const parsed = parseJson(row.value_json);
    if (!parsed || typeof parsed !== "object") {
      console.warn(
        "new_user_runtime_defaults is invalid; using built-in defaults.",
      );
      return {
        config: buildRuntimeConfigDefaults(),
        updatedAt: row.updated_at,
      };
    }
    return {
      config: structuredClone(parsed as StoredUserRuntimeConfig),
      updatedAt: row.updated_at,
    };
  }

  async setNewUserRuntimeDefaults(config: StoredUserRuntimeConfig) {
    const updatedAt = Date.now();
    await this.save(NEW_USER_RUNTIME_DEFAULTS, config, updatedAt);
    return { config: structuredClone(config), updatedAt };
  }

  async getRuntimeConfigPresets(): Promise<StoredRuntimeConfigPresets> {
    const row = await this.find(RUNTIME_CONFIG_PRESETS);
    if (!row) return { sliceFigure: [], primeFigure: [] };
    const parsed = parseJson(
      row.value_json,
    ) as Partial<StoredRuntimeConfigPresets> | null;
    return {
      sliceFigure: Array.isArray(parsed?.sliceFigure)
        ? structuredClone(parsed.sliceFigure)
        : [],
      primeFigure: Array.isArray(parsed?.primeFigure)
        ? structuredClone(parsed.primeFigure)
        : [],
    };
  }

  async setRuntimeConfigPresets(presets: StoredRuntimeConfigPresets) {
    await this.save(RUNTIME_CONFIG_PRESETS, presets);
    return structuredClone(presets);
  }

  private find(key: string) {
    return queryOne<SettingRow>(
      "SELECT value_json, updated_at FROM platform_settings WHERE setting_key = ?",
      [key],
    );
  }

  private async save(key: string, value: unknown, updatedAt = Date.now()) {
    await execute(
      `INSERT INTO platform_settings (setting_key, value_json, updated_at)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE value_json = VALUES(value_json), updated_at = VALUES(updated_at)`,
      [key, JSON.stringify(value), updatedAt],
    );
  }
}

export function normalizeUsdToCnyRate(value: string) {
  const trimmed = value.trim();
  if (!/^\d+(?:\.\d{1,6})?$/.test(trimmed))
    throw new Error("美元兑人民币汇率必须是最多 6 位小数的正数。");
  const [whole, fraction = ""] = trimmed.split(".");
  const micro = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
  if (micro < 10_000n || micro > 100_000_000n)
    throw new Error("美元兑人民币汇率必须在 0.01 到 100 之间。");
  const normalizedFraction = fraction.replace(/0+$/, "");
  return `${BigInt(whole)}${normalizedFraction ? `.${normalizedFraction}` : ""}`;
}

export function parseJson(value: unknown) {
  const text =
    typeof value === "string"
      ? value
      : Buffer.isBuffer(value)
        ? value.toString("utf8")
        : value instanceof Uint8Array
          ? Buffer.from(value).toString("utf8")
          : null;
  if (text === null) return value;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function safeUsd(value: unknown, fallback = "0") {
  if (typeof value !== "string") return fallback;
  try {
    return normalizeNonNegativeUsd(value);
  } catch {
    return fallback;
  }
}

function validateMinimumLikes(value: number) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error("推广点赞门槛必须是非负整数。");
  return value;
}
