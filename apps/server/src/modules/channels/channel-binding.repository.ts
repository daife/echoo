import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import type { ExternalInterfaceBinding } from "@echoo/shared";
import {
  execute,
  queryOne,
  queryRows,
  withTransaction,
} from "../../infra/database/mysql.js";

export interface WechatAccount {
  id: string;
  ownerUserId: string;
  accountId: string;
  baseUrl: string;
  botToken: string;
  externalUserId?: string;
  syncBuf?: string;
  status: "pending" | "connected" | "paused" | "error";
  leaseUntil?: number;
  lastError?: string;
}

export interface WechatBinding extends ExternalInterfaceBinding {
  interfaceType: "wechat";
  account: WechatAccount;
  conversationId: string;
}

const key = createHash("sha256")
  .update(process.env.JWT_SECRET ?? "dev-secret")
  .digest();

export function encryptToken(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString(
    "base64url",
  );
}

export function decryptToken(value: string) {
  const data = Buffer.from(value, "base64url");
  const decipher = createDecipheriv("aes-256-gcm", key, data.subarray(0, 12));
  decipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([
    decipher.update(data.subarray(28)),
    decipher.final(),
  ]).toString("utf8");
}

export class ChannelBindingRepository {
  async findWechat(ownerUserId: string): Promise<WechatBinding | null> {
    const row = await queryOne<any>(
      `SELECT b.*, a.account_id AS external_account_id, a.base_url, a.bot_token_ciphertext, a.external_user_id,
              a.sync_buf, a.status, a.lease_until, a.last_error
       FROM external_interface_bindings b
       JOIN external_interface_accounts a ON a.id = b.account_id
       WHERE b.owner_user_id = ? AND b.interface_type = 'wechat'`,
      [ownerUserId],
    );
    return row ? this.map(row) : null;
  }

  async findByAccount(accountId: string) {
    const row = await queryOne<any>(
      `SELECT b.*, a.account_id AS external_account_id, a.base_url, a.bot_token_ciphertext, a.external_user_id,
              a.sync_buf, a.status, a.lease_until, a.last_error
       FROM external_interface_bindings b JOIN external_interface_accounts a ON a.id = b.account_id
       WHERE a.id = ?`,
      [accountId],
    );
    return row ? this.map(row) : null;
  }

  async findByConversation(conversationId: string) {
    const row = await queryOne<any>(
      `SELECT b.*, a.account_id AS external_account_id, a.base_url, a.bot_token_ciphertext, a.external_user_id,
              a.sync_buf, a.status, a.lease_until, a.last_error
       FROM external_interface_bindings b JOIN external_interface_accounts a ON a.id = b.account_id
       WHERE b.conversation_id = ? AND b.interface_type = 'wechat'`,
      [conversationId],
    );
    return row ? this.map(row) : null;
  }

  async findById(bindingId: string) {
    const row = await queryOne<any>(
      `SELECT b.*, a.account_id AS external_account_id, a.base_url, a.bot_token_ciphertext, a.external_user_id,
              a.sync_buf, a.status, a.lease_until, a.last_error
       FROM external_interface_bindings b JOIN external_interface_accounts a ON a.id = b.account_id
       WHERE b.id = ? AND b.interface_type = 'wechat'`,
      [bindingId],
    );
    return row ? this.map(row) : null;
  }

  async listOwnerIds() {
    const rows = await queryRows<any>(
      "SELECT DISTINCT owner_user_id FROM external_interface_accounts WHERE interface_type = 'wechat' AND status IN ('connected', 'pending')",
    );
    return rows.map((row) => String(row.owner_user_id));
  }

  async saveConnected(input: {
    ownerUserId: string;
    conversationId: string;
    account: Omit<WechatAccount, "id" | "ownerUserId" | "status"> & {
      id?: string;
    };
  }) {
    const now = Date.now();
    await withTransaction(async (connection) => {
      const existing = await queryOne<any>(
        "SELECT id FROM external_interface_accounts WHERE owner_user_id = ? AND interface_type = 'wechat' FOR UPDATE",
        [input.ownerUserId],
        connection,
      );
      const accountId =
        existing?.id ?? input.account.id ?? `wxa_${randomUUID()}`;
      await execute(
        `INSERT INTO external_interface_accounts
         (id, owner_user_id, interface_type, account_id, base_url, bot_token_ciphertext, external_user_id, sync_buf, status, created_at, updated_at)
         VALUES (?, ?, 'wechat', ?, ?, ?, ?, ?, 'connected', ?, ?)
         ON DUPLICATE KEY UPDATE account_id=VALUES(account_id), base_url=VALUES(base_url), bot_token_ciphertext=VALUES(bot_token_ciphertext),
           external_user_id=VALUES(external_user_id), sync_buf=COALESCE(VALUES(sync_buf), sync_buf), status='connected', updated_at=VALUES(updated_at)`,
        [
          accountId,
          input.ownerUserId,
          input.account.accountId,
          input.account.baseUrl,
          encryptToken(input.account.botToken),
          input.account.externalUserId ?? null,
          input.account.syncBuf ?? null,
          now,
          now,
        ],
        connection,
      );
      const bindingId = `wxb_${randomUUID()}`;
      await execute(
        `INSERT INTO external_interface_bindings (id, owner_user_id, interface_type, account_id, conversation_id, enabled, bound_at, created_at, updated_at)
         VALUES (?, ?, 'wechat', ?, ?, TRUE, ?, ?, ?)
         ON DUPLICATE KEY UPDATE account_id=VALUES(account_id), conversation_id=VALUES(conversation_id), enabled=TRUE, bound_at=VALUES(bound_at), updated_at=VALUES(updated_at)`,
        [
          bindingId,
          input.ownerUserId,
          accountId,
          input.conversationId,
          now,
          now,
          now,
        ],
        connection,
      );
    });
    return this.findWechat(input.ownerUserId);
  }

  async updateCursor(accountId: string, syncBuf: string) {
    await execute(
      "UPDATE external_interface_accounts SET sync_buf = ?, updated_at = ? WHERE id = ?",
      [syncBuf, Date.now(), accountId],
    );
  }

  async setStatus(
    accountId: string,
    status: WechatAccount["status"],
    error?: string,
  ) {
    await execute(
      "UPDATE external_interface_accounts SET status = ?, last_error = ?, updated_at = ? WHERE id = ?",
      [status, error ?? null, Date.now(), accountId],
    );
  }

  async claim(accountId: string, leaseMs = 60_000) {
    const now = Date.now();
    const result = await execute(
      "UPDATE external_interface_accounts SET lease_until = ?, updated_at = ? WHERE id = ? AND (lease_until IS NULL OR lease_until < ?)",
      [now + leaseMs, now, accountId, now],
    );
    return result.affectedRows > 0;
  }

  async renewLease(accountId: string, leaseMs = 60_000) {
    const now = Date.now();
    await execute(
      "UPDATE external_interface_accounts SET lease_until = ?, updated_at = ? WHERE id = ?",
      [now + leaseMs, now, accountId],
    );
  }

  async deleteWechat(ownerUserId: string) {
    await execute(
      "DELETE FROM external_interface_bindings WHERE owner_user_id = ? AND interface_type = 'wechat'",
      [ownerUserId],
    );
  }

  async createDeliveryTask(bindingId: string, messageId: string) {
    const result = await execute(
      `INSERT IGNORE INTO external_delivery_tasks
       (id, binding_id, message_id, status, attempts, next_attempt_at, created_at, updated_at)
       VALUES (?, ?, ?, 'pending', 0, ?, ?, ?)`,
      [
        `wxd_${randomUUID()}`,
        bindingId,
        messageId,
        Date.now(),
        Date.now(),
        Date.now(),
      ],
    );
    return result.affectedRows > 0;
  }

  async finishDelivery(
    bindingId: string,
    messageId: string,
    error?: string,
    nextAttemptAt = Date.now(),
  ) {
    await execute(
      `UPDATE external_delivery_tasks SET status = ?, attempts = attempts + 1, failure_reason = ?, next_attempt_at = ?, updated_at = ?
       WHERE binding_id = ? AND message_id = ?`,
      [
        error ? "failed" : "sent",
        error ?? null,
        nextAttemptAt,
        Date.now(),
        bindingId,
        messageId,
      ],
    );
  }

  async listDueDeliveries(limit = 20) {
    return queryRows<any>(
      `SELECT id, binding_id, message_id, attempts FROM external_delivery_tasks
       WHERE status IN ('pending', 'failed') AND attempts < 5 AND next_attempt_at <= ?
       ORDER BY next_attempt_at ASC LIMIT ?`,
      [Date.now(), limit],
    );
  }

  async claimDelivery(id: string) {
    const result = await execute(
      `UPDATE external_delivery_tasks SET status = 'pending', next_attempt_at = ?, updated_at = ?
       WHERE id = ? AND status IN ('pending', 'failed') AND next_attempt_at <= ?`,
      [Date.now() + 120_000, Date.now(), id, Date.now()],
    );
    return result.affectedRows > 0;
  }

  private map(row: any): WechatBinding {
    const account: WechatAccount = {
      id: row.account_id,
      ownerUserId: row.owner_user_id,
      accountId: row.external_account_id ?? row.account_id,
      baseUrl: row.base_url,
      botToken: decryptToken(row.bot_token_ciphertext),
      ...(row.external_user_id ? { externalUserId: row.external_user_id } : {}),
      ...(row.sync_buf ? { syncBuf: row.sync_buf } : {}),
      status: row.status,
      ...(row.lease_until ? { leaseUntil: Number(row.lease_until) } : {}),
      ...(row.last_error ? { lastError: row.last_error } : {}),
    };
    return {
      id: row.id,
      ownerUserId: row.owner_user_id,
      interfaceType: "wechat",
      conversationId: row.conversation_id,
      displayName: "微信",
      externalAccountId: account.accountId,
      enabled: Boolean(row.enabled),
      status: account.status,
      boundAt: Number(row.bound_at),
      createdAt: Number(row.created_at),
      account,
    };
  }
}
