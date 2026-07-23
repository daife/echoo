import type { RowDataPacket } from "mysql2";
import {
  execute,
  queryOne,
  queryRows,
  withTransaction,
} from "../../infra/database/mysql.js";
import { formatMicroUsd } from "../billing/billing.service.js";

interface AdminUserRow extends RowDataPacket {
  id: string;
  email: string;
  display_name: string;
  created_at: number;
  balance_micro_usd: number;
  is_admin: number;
  is_default_follow: number;
}

interface AccountFlagsRow extends RowDataPacket {
  id: string;
  is_admin: number;
  is_default_follow: number;
}

export interface AccountFlags {
  isAdmin: boolean;
  isDefaultFollow: boolean;
}

export class InvalidAccountFlagsError extends Error {}

export class AdminAccountService {
  async listUsers(input: { query?: string; adminsOnly?: boolean } = {}) {
    const query = input.query?.trim() ?? "";
    const rows = await queryRows<AdminUserRow>(
      `SELECT u.id, u.email, u.display_name, u.created_at, u.is_admin,
              u.is_default_follow, COALESCE(a.balance_micro_usd, 0) balance_micro_usd
         FROM users u LEFT JOIN billing_accounts a ON a.owner_user_id = u.id
        WHERE (? = '' OR u.email LIKE ? OR u.display_name LIKE ?)
          AND (? = FALSE OR u.is_admin = TRUE)
        ORDER BY u.created_at DESC LIMIT 200`,
      [query, `%${query}%`, `%${query}%`, input.adminsOnly ?? false],
    );
    return rows.map(toAdminUser);
  }

  async updateAccountFlags(userId: string, patch: Partial<AccountFlags>) {
    return withTransaction(async (connection) => {
      const current = await queryOne<AccountFlagsRow>(
        `SELECT id, is_admin, is_default_follow FROM users
         WHERE id = ? FOR UPDATE`,
        [userId],
        connection,
      );
      if (!current) return null;

      const flags = resolveAccountFlags(
        {
          isAdmin: Boolean(current.is_admin),
          isDefaultFollow: Boolean(current.is_default_follow),
        },
        patch,
      );
      await execute(
        `UPDATE users SET is_admin = ?, is_default_follow = ?, updated_at = ?
         WHERE id = ?`,
        [flags.isAdmin, flags.isDefaultFollow, Date.now(), userId],
        connection,
      );
      return { id: userId, ...flags };
    });
  }
}

export function resolveAccountFlags(
  current: AccountFlags,
  patch: Partial<AccountFlags>,
): AccountFlags {
  const isAdmin = patch.isAdmin ?? current.isAdmin;
  if (patch.isDefaultFollow === true && !isAdmin)
    throw new InvalidAccountFlagsError(
      "只有管理员账号才能设为新用户默认关注。",
    );
  return {
    isAdmin,
    isDefaultFollow: isAdmin
      ? (patch.isDefaultFollow ?? current.isDefaultFollow)
      : false,
  };
}

function toAdminUser(row: AdminUserRow) {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    balanceUsd: formatMicroUsd(row.balance_micro_usd),
    createdAt: row.created_at,
    isAdmin: Boolean(row.is_admin),
    isDefaultFollow: Boolean(row.is_default_follow),
  };
}
