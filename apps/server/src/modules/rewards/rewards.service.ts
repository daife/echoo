import { randomBytes, randomUUID } from "node:crypto";
import type {
  PromotionBindingView,
  PromotionPlatform,
  RewardCenterView,
} from "@echoo/shared";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import {
  execute,
  queryOne,
  queryRows,
  withTransaction,
} from "../../infra/database/mysql.js";
import { formatMicroUsd, parseUsdToMicro } from "../billing/money.js";
import { PlatformSettingsService } from "../platform-settings/platform-settings.service.js";
import {
  hasEchooTag,
  parsePromotionShare,
  type ParsedPromotionContent,
} from "./promotion-parser.js";

const INVITE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const QUOTE_TTL_MS = 5 * 60_000;

interface InviteCodeRow extends RowDataPacket {
  owner_user_id: string;
  code: string;
}

interface AccountRow extends RowDataPacket {
  owner_user_id: string;
  balance_micro_usd: number;
}

interface PromotionRow extends RowDataPacket {
  id: string;
  owner_user_id: string;
  platform: PromotionPlatform;
  work_type: string;
  external_content_id: string;
  external_author_id: string | null;
  source_url: string;
  initial_like_count: number;
  last_checked_like_count: number | null;
  quote_id: string | null;
  quote_like_count: number | null;
  quote_reward_micro_usd: number | null;
  quote_expires_at: number | null;
  settled_like_count: number | null;
  settled_reward_micro_usd: number | null;
  settled_at: number | null;
  created_at: number;
}

interface CountRow extends RowDataPacket {
  count: number;
}

interface RedemptionRow extends RowDataPacket {
  invitee_user_id: string;
}

interface SumRow extends RowDataPacket {
  total: number;
}

export class RewardsError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400,
  ) {
    super(message);
  }
}

export class RewardsService {
  constructor(
    private readonly settings = new PlatformSettingsService(),
    private readonly parser: typeof parsePromotionShare = parsePromotionShare,
  ) {}

  async initializeInviteCode(ownerUserId: string) {
    return this.ensureInviteCode(ownerUserId);
  }

  async getCenter(ownerUserId: string): Promise<RewardCenterView> {
    const [code, settings, redemption, bindings, creatorTotal] =
      await Promise.all([
        this.ensureInviteCode(ownerUserId),
        this.settings.getRewardSettings(),
        queryOne<CountRow>(
          "SELECT COUNT(*) count FROM invite_redemptions WHERE invitee_user_id = ?",
          [ownerUserId],
        ),
        queryRows<PromotionRow>(
          `${promotionSelect} WHERE owner_user_id = ? ORDER BY created_at DESC`,
          [ownerUserId],
        ),
        queryOne<SumRow>(
          `SELECT COALESCE(SUM(amount_micro_usd), 0) total
             FROM billing_ledger
            WHERE owner_user_id = ? AND kind = 'creator_reward'`,
          [ownerUserId],
        ),
      ]);
    return {
      invitation: {
        ...settings.invitation,
        code,
        hasRedeemed: Boolean(redemption?.count),
      },
      promotion: {
        ...settings.promotion,
        bindings: bindings.map(toPromotionView),
      },
      creator: {
        ...settings.creator,
        earnedUsd: formatMicroUsd(creatorTotal?.total ?? 0),
      },
    };
  }

  async redeemInviteCode(inviteeUserId: string, rawCode: string) {
    const code = rawCode.trim().toLocaleUpperCase();
    if (!/^[2-9A-HJ-NP-Z]{10}$/.test(code))
      throw new RewardsError("INVALID_INVITE_CODE", "邀请码格式不正确。");
    const settings = await this.settings.getRewardSettings();
    if (!settings.invitation.enabled)
      throw new RewardsError(
        "INVITATION_DISABLED",
        "邀请奖励暂未开放，请稍后再试。",
        409,
      );
    const inviterAmount = parseUsdToMicro(settings.invitation.inviterRewardUsd);
    const inviteeAmount = parseUsdToMicro(settings.invitation.inviteeRewardUsd);
    try {
      await withTransaction(async (connection) => {
        const invitation = await queryOne<InviteCodeRow>(
          "SELECT owner_user_id, code FROM invite_codes WHERE code = ? FOR UPDATE",
          [code],
          connection,
        );
        if (!invitation)
          throw new RewardsError(
            "INVITE_CODE_NOT_FOUND",
            "邀请码不存在。",
            404,
          );
        if (invitation.owner_user_id === inviteeUserId)
          throw new RewardsError(
            "SELF_INVITATION",
            "不能使用自己的邀请码。",
            409,
          );
        const existing = await queryOne<RedemptionRow>(
          "SELECT invitee_user_id FROM invite_redemptions WHERE invitee_user_id = ? FOR UPDATE",
          [inviteeUserId],
          connection,
        );
        if (existing)
          throw new RewardsError(
            "INVITE_ALREADY_REDEEMED",
            "每个账户只能使用一次邀请码。",
            409,
          );
        const inviterUserId = invitation.owner_user_id;
        await ensureAccounts([inviterUserId, inviteeUserId], connection);
        const accounts = await lockAccounts(
          [inviterUserId, inviteeUserId],
          connection,
        );
        const now = Date.now();
        await execute(
          `INSERT INTO invite_redemptions
           (invitee_user_id, inviter_user_id, invite_code,
            inviter_reward_micro_usd, invitee_reward_micro_usd, redeemed_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            inviteeUserId,
            inviterUserId,
            code,
            inviterAmount,
            inviteeAmount,
            now,
          ],
          connection,
        );
        await creditAccount({
          ownerUserId: inviterUserId,
          currentBalance: accounts.get(inviterUserId) ?? 0,
          amount: inviterAmount,
          kind: "invite_referrer_reward",
          note: "邀请新用户奖励",
          metadata: { inviteeUserId },
          now,
          connection,
        });
        await creditAccount({
          ownerUserId: inviteeUserId,
          currentBalance: accounts.get(inviteeUserId) ?? 0,
          amount: inviteeAmount,
          kind: "invite_redeemer_reward",
          note: "填写邀请码奖励",
          metadata: { inviterUserId },
          now,
          connection,
        });
      });
    } catch (error) {
      if (error instanceof RewardsError) throw error;
      if (isDuplicateEntry(error))
        throw new RewardsError(
          "INVITE_ALREADY_REDEEMED",
          "每个账户只能使用一次邀请码。",
          409,
        );
      throw error;
    }
    return this.getCenter(inviteeUserId);
  }

  async bindPromotion(ownerUserId: string, shareText: string) {
    if (!shareText.trim() || shareText.length > 4_000)
      throw new RewardsError(
        "INVALID_PROMOTION_SHARE",
        "请粘贴长度不超过 4000 字的分享内容或链接。",
      );
    const parsed = await this.parser(shareText);
    if (!hasEchooTag(parsed.tags))
      throw new RewardsError(
        "ECHOO_TAG_REQUIRED",
        "未在内容中识别到 #echoo 标签，请添加后重新绑定。",
        422,
      );
    const now = Date.now();
    const id = `promo_${randomUUID()}`;
    try {
      await execute(
        `INSERT INTO promotion_bindings
         (id, owner_user_id, platform, work_type, external_content_id,
          external_author_id, source_url, initial_like_count, initial_tags,
          created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          ownerUserId,
          parsed.platform,
          parsed.workType,
          parsed.contentId,
          parsed.authorId ?? null,
          parsed.sourceUrl,
          parsed.likeCount,
          JSON.stringify(parsed.tags),
          now,
          now,
        ],
      );
    } catch (error) {
      if (isDuplicateEntry(error))
        throw new RewardsError(
          "PROMOTION_ALREADY_BOUND",
          "该作品已被绑定，请勿重复绑定。",
          409,
        );
      throw error;
    }
    const row = await this.findPromotion(ownerUserId, id);
    if (!row) throw new Error("推广作品绑定后读取失败。");
    return toPromotionView(row);
  }

  async quotePromotion(ownerUserId: string, bindingId: string) {
    const [binding, settings] = await Promise.all([
      this.findPromotion(ownerUserId, bindingId),
      this.settings.getRewardSettings(),
    ]);
    if (!binding)
      throw new RewardsError("PROMOTION_NOT_FOUND", "未找到推广作品。", 404);
    if (binding.settled_at)
      throw new RewardsError(
        "PROMOTION_ALREADY_SETTLED",
        "该作品已经结算，不能重复结算。",
        409,
      );
    if (!settings.promotion.enabled)
      throw new RewardsError(
        "PROMOTION_DISABLED",
        "推广奖励暂未开放，但已绑定作品会继续保留。",
        409,
      );
    const parsed = await this.parser(binding.source_url);
    assertSamePromotion(binding, parsed);
    if (!hasEchooTag(parsed.tags))
      throw new RewardsError(
        "ECHOO_TAG_REQUIRED",
        "作品当前未包含 #echoo 标签，无法结算。",
        422,
      );
    const reward = calculatePromotionRewardMicroUsd(
      parsed.likeCount,
      binding.initial_like_count,
      settings.promotion.minimumLikes,
      parseUsdToMicro(settings.promotion.usdPerLike),
      parseUsdToMicro(settings.promotion.maxRewardUsd),
    );
    const quoteId = `quote_${randomUUID()}`;
    const now = Date.now();
    const expiresAt = now + QUOTE_TTL_MS;
    const result = await execute(
      `UPDATE promotion_bindings
          SET last_checked_like_count = ?, last_checked_tags = ?, last_checked_at = ?,
              quote_id = ?, quote_like_count = ?, quote_reward_micro_usd = ?,
              quote_config = ?, quote_expires_at = ?, updated_at = ?
        WHERE id = ? AND owner_user_id = ? AND settled_at IS NULL`,
      [
        parsed.likeCount,
        JSON.stringify(parsed.tags),
        now,
        quoteId,
        parsed.likeCount,
        reward,
        JSON.stringify({
          minimumLikes: settings.promotion.minimumLikes,
          usdPerLike: settings.promotion.usdPerLike,
          maxRewardUsd: settings.promotion.maxRewardUsd,
        }),
        expiresAt,
        now,
        bindingId,
        ownerUserId,
      ],
    );
    if (!result.affectedRows)
      throw new RewardsError(
        "PROMOTION_ALREADY_SETTLED",
        "该作品已经结算，不能重复结算。",
        409,
      );
    return {
      quoteId,
      bindingId,
      likeCount: parsed.likeCount,
      rewardUsd: formatMicroUsd(reward),
      expiresAt,
    };
  }

  async settlePromotion(
    ownerUserId: string,
    bindingId: string,
    quoteId: string,
  ) {
    await withTransaction(async (connection) => {
      const binding = await queryOne<PromotionRow>(
        `${promotionSelect} WHERE id = ? AND owner_user_id = ? FOR UPDATE`,
        [bindingId, ownerUserId],
        connection,
      );
      if (!binding)
        throw new RewardsError("PROMOTION_NOT_FOUND", "未找到推广作品。", 404);
      if (binding.settled_at)
        throw new RewardsError(
          "PROMOTION_ALREADY_SETTLED",
          "该作品已经结算，不能重复结算。",
          409,
        );
      if (!quoteId || binding.quote_id !== quoteId)
        throw new RewardsError(
          "PROMOTION_QUOTE_INVALID",
          "结算报价无效，请重新获取。",
          409,
        );
      if (!binding.quote_expires_at || binding.quote_expires_at <= Date.now())
        throw new RewardsError(
          "PROMOTION_QUOTE_EXPIRED",
          "结算报价已过期，请重新获取。",
          409,
        );
      const reward = binding.quote_reward_micro_usd ?? 0;
      if (reward < 0)
        throw new RewardsError(
          "PROMOTION_QUOTE_INVALID",
          "结算金额无效，请重新获取报价。",
          409,
        );
      const now = Date.now();
      if (reward > 0) {
        await ensureAccounts([ownerUserId], connection);
        const accounts = await lockAccounts([ownerUserId], connection);
        await creditAccount({
          ownerUserId,
          currentBalance: accounts.get(ownerUserId) ?? 0,
          amount: reward,
          kind: "promotion_reward",
          note: `${promotionPlatformLabel(binding.platform)}推广结算`,
          metadata: {
            bindingId,
            platform: binding.platform,
            externalContentId: binding.external_content_id,
            likeCount: binding.quote_like_count,
          },
          now,
          connection,
        });
      }
      await execute(
        `UPDATE promotion_bindings
            SET settled_like_count = quote_like_count,
                settled_reward_micro_usd = quote_reward_micro_usd,
                settled_at = ?, updated_at = ?
          WHERE id = ?`,
        [now, now, bindingId],
        connection,
      );
    });
    const row = await this.findPromotion(ownerUserId, bindingId);
    if (!row) throw new Error("推广作品结算后读取失败。");
    return toPromotionView(row);
  }

  private async ensureInviteCode(ownerUserId: string) {
    const existing = await queryOne<InviteCodeRow>(
      "SELECT owner_user_id, code FROM invite_codes WHERE owner_user_id = ?",
      [ownerUserId],
    );
    if (existing) return existing.code;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const code = createInviteCode();
      await execute(
        "INSERT IGNORE INTO invite_codes (owner_user_id, code, created_at) VALUES (?, ?, ?)",
        [ownerUserId, code, Date.now()],
      );
      const created = await queryOne<InviteCodeRow>(
        "SELECT owner_user_id, code FROM invite_codes WHERE owner_user_id = ?",
        [ownerUserId],
      );
      if (created) return created.code;
    }
    throw new Error("邀请码生成失败，请稍后重试。");
  }

  private findPromotion(ownerUserId: string, bindingId: string) {
    return queryOne<PromotionRow>(
      `${promotionSelect} WHERE id = ? AND owner_user_id = ?`,
      [bindingId, ownerUserId],
    );
  }
}

export function calculatePromotionRewardMicroUsd(
  currentLikeCount: number,
  initialLikeCount: number,
  minimumLikes: number,
  microUsdPerLike: number,
  maxRewardMicroUsd: number,
) {
  if (
    !Number.isSafeInteger(currentLikeCount) ||
    !Number.isSafeInteger(initialLikeCount) ||
    !Number.isSafeInteger(minimumLikes) ||
    currentLikeCount <= initialLikeCount ||
    microUsdPerLike <= 0 ||
    maxRewardMicroUsd <= 0
  )
    return 0;
  const newLikeCount = currentLikeCount - initialLikeCount;
  if (newLikeCount <= minimumLikes) return 0;
  const calculated = (newLikeCount - minimumLikes) * microUsdPerLike;
  if (!Number.isSafeInteger(calculated)) return maxRewardMicroUsd;
  return Math.min(maxRewardMicroUsd, calculated);
}

const promotionSelect = `SELECT id, owner_user_id, platform, work_type,
  external_content_id, external_author_id, source_url, initial_like_count,
  last_checked_like_count, quote_id, quote_like_count,
  quote_reward_micro_usd, quote_expires_at, settled_like_count,
  settled_reward_micro_usd, settled_at, created_at
  FROM promotion_bindings`;

function createInviteCode() {
  const bytes = randomBytes(10);
  return Array.from(
    bytes,
    (byte) => INVITE_ALPHABET[byte % INVITE_ALPHABET.length],
  )
    .join("")
    .slice(0, 10);
}

function toPromotionView(row: PromotionRow): PromotionBindingView {
  return {
    id: row.id,
    platform: row.platform,
    workType: row.work_type,
    externalContentId: row.external_content_id,
    sourceUrl: row.source_url,
    initialLikeCount: row.initial_like_count,
    ...(row.last_checked_like_count === null
      ? {}
      : { lastCheckedLikeCount: row.last_checked_like_count }),
    ...(row.settled_like_count === null
      ? {}
      : { settledLikeCount: row.settled_like_count }),
    ...(row.settled_reward_micro_usd === null
      ? {}
      : { settledRewardUsd: formatMicroUsd(row.settled_reward_micro_usd) }),
    status: row.settled_at ? "settled" : "bound",
    createdAt: row.created_at,
    ...(row.settled_at ? { settledAt: row.settled_at } : {}),
  };
}

function assertSamePromotion(
  binding: PromotionRow,
  parsed: ParsedPromotionContent,
) {
  if (
    binding.platform !== parsed.platform ||
    binding.external_content_id !== parsed.contentId
  )
    throw new RewardsError(
      "PROMOTION_CONTENT_CHANGED",
      "分享链接当前指向的作品与绑定记录不一致。",
      409,
    );
  if (
    binding.external_author_id &&
    parsed.authorId &&
    binding.external_author_id !== parsed.authorId
  )
    throw new RewardsError(
      "PROMOTION_AUTHOR_CHANGED",
      "作品作者信息与绑定时不一致，无法结算。",
      409,
    );
}

async function ensureAccounts(
  ownerUserIds: string[],
  connection: PoolConnection,
) {
  const now = Date.now();
  for (const ownerUserId of new Set(ownerUserIds))
    await execute(
      `INSERT IGNORE INTO billing_accounts
       (owner_user_id, balance_micro_usd, created_at, updated_at)
       VALUES (?, 0, ?, ?)`,
      [ownerUserId, now, now],
      connection,
    );
}

async function lockAccounts(
  ownerUserIds: string[],
  connection: PoolConnection,
) {
  const ids = Array.from(new Set(ownerUserIds)).sort();
  const rows = await queryRows<AccountRow>(
    `SELECT owner_user_id, balance_micro_usd FROM billing_accounts
      WHERE owner_user_id IN (${ids.map(() => "?").join(",")})
      ORDER BY owner_user_id FOR UPDATE`,
    ids,
    connection,
  );
  return new Map(rows.map((row) => [row.owner_user_id, row.balance_micro_usd]));
}

async function creditAccount(input: {
  ownerUserId: string;
  currentBalance: number;
  amount: number;
  kind:
    "invite_referrer_reward" | "invite_redeemer_reward" | "promotion_reward";
  note: string;
  metadata: Record<string, unknown>;
  now: number;
  connection: PoolConnection;
}) {
  const nextBalance = input.currentBalance + input.amount;
  await execute(
    "UPDATE billing_accounts SET balance_micro_usd = ?, updated_at = ? WHERE owner_user_id = ?",
    [nextBalance, input.now, input.ownerUserId],
    input.connection,
  );
  await execute(
    `INSERT INTO billing_ledger
     (id, owner_user_id, kind, amount_micro_usd, balance_after_micro_usd,
      note, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      `bill_${randomUUID()}`,
      input.ownerUserId,
      input.kind,
      input.amount,
      nextBalance,
      input.note,
      JSON.stringify(input.metadata),
      input.now,
    ],
    input.connection,
  );
}

function promotionPlatformLabel(platform: PromotionPlatform) {
  if (platform === "douyin") return "抖音";
  if (platform === "bilibili") return "哔哩哔哩";
  return "小红书";
}

function isDuplicateEntry(error: unknown) {
  const value = error as { code?: string; errno?: number };
  return value?.code === "ER_DUP_ENTRY" || value?.errno === 1062;
}
