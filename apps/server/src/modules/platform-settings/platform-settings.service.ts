import type { RowDataPacket } from "mysql2";
import { execute, queryOne } from "../../infra/database/mysql.js";
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

export class PlatformSettingsService {
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

function parseJson(value: unknown) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
