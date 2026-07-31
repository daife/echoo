import type {
  PromotionBindingView,
  PromotionQuoteView,
  RewardCenterView,
} from "@echoo/shared";
import { useEffect, useState, type FormEvent } from "react";
import { BACK_HANDLER_PRIORITY } from "../../app/backNavigation";
import { useBackHandler } from "../../app/providers/BackNavigationProvider";
import type { RechargeService } from "../../services/RechargeService";
import type { RewardsService } from "../../services/RewardsService";
import { RechargePanel } from "./RechargePanel";

export function RewardCenter({
  service,
  rechargeService,
  onWalletChanged,
}: {
  service: RewardsService;
  rechargeService: RechargeService;
  onWalletChanged: () => Promise<void>;
}) {
  const [center, setCenter] = useState<RewardCenterView | null>(null);
  const [inviteCode, setInviteCode] = useState("");
  const [shareText, setShareText] = useState("");
  const [quote, setQuote] = useState<PromotionQuoteView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  useBackHandler(
    () => {
      if (busy !== "settle") setQuote(null);
    },
    {
      enabled: quote !== null,
      priority: BACK_HANDLER_PRIORITY.dialog,
    },
  );

  const load = async () => setCenter(await service.getCenter());

  useEffect(() => {
    let cancelled = false;
    void service
      .getCenter()
      .then((value) => {
        if (!cancelled) setCenter(value);
      })
      .catch((reason) => {
        if (!cancelled) setError(messageOf(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [service]);

  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    setError("");
    setStatus("");
    try {
      await action();
    } catch (reason) {
      setError(messageOf(reason));
    } finally {
      setBusy(null);
    }
  };

  const redeem = (event: FormEvent) => {
    event.preventDefault();
    void run("invite", async () => {
      setCenter(await service.redeemInviteCode(inviteCode));
      setInviteCode("");
      setStatus("邀请码奖励已发放到双方账户。");
      await onWalletChanged();
    });
  };

  const bind = (event: FormEvent) => {
    event.preventDefault();
    void run("bind", async () => {
      await service.bindPromotion(shareText);
      setShareText("");
      await load();
      setStatus("作品已绑定。建议等待点赞增长后再结算。");
    });
  };

  const getQuote = (binding: PromotionBindingView) =>
    run(`quote:${binding.id}`, async () => {
      setQuote(await service.quotePromotion(binding.id));
    });

  const settle = () => {
    if (!quote) return;
    void run("settle", async () => {
      await service.settlePromotion(quote.bindingId, quote.quoteId);
      setQuote(null);
      await Promise.all([load(), onWalletChanged()]);
      setStatus("推广奖励已结算入账。");
    });
  };

  if (!center && !error)
    return (
      <section className="glass-panel rounded-2xl p-5 text-sm text-white/42">
        正在加载额度获取方式…
      </section>
    );

  return (
    <section className="space-y-4">
      <div>
        <p className="text-xs uppercase tracking-[0.18em] text-white/35">
          Earn balance
        </p>
        <h2 className="mt-2 text-2xl font-semibold text-white">获取额度</h2>
      </div>
      {status ? (
        <p className="rounded-xl border border-emerald-200/10 bg-emerald-200/[0.04] px-4 py-3 text-sm text-emerald-100/70">
          {status}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-xl border border-red-200/10 bg-red-200/[0.04] px-4 py-3 text-sm text-red-100/75">
          {error}
        </p>
      ) : null}
      {center ? (
        <div className="grid gap-4 md:grid-cols-2">
          <article className="glass-panel rounded-2xl p-5">
            <p className="text-xs uppercase tracking-[0.16em] text-amber-100/45">
              Invite
            </p>
            <h3 className="mt-2 text-lg font-semibold text-white">邀请注册</h3>
            <p className="mt-2 text-sm leading-6 text-white/42">
              邀请人获得 ${center.invitation.inviterRewardUsd}，新用户获得 $
              {center.invitation.inviteeRewardUsd}。每个账户只能填写一次。
            </p>
            <button
              type="button"
              className="mt-4 flex w-full items-center justify-between rounded-xl border border-white/10 bg-black/15 px-4 py-3 font-mono text-sm text-white/75"
              onClick={() => {
                void navigator.clipboard
                  .writeText(center.invitation.code)
                  .then(() => setStatus("邀请码已复制。"))
                  .catch(() => setError("复制失败，请手动选择邀请码。"));
              }}
            >
              <span>{center.invitation.code}</span>
              <span className="font-sans text-xs text-white/35">复制</span>
            </button>
            <form onSubmit={redeem} className="mt-3 flex gap-2">
              <input
                value={inviteCode}
                onChange={(event) =>
                  setInviteCode(event.target.value.toLocaleUpperCase())
                }
                disabled={
                  !center.invitation.enabled || center.invitation.hasRedeemed
                }
                placeholder={
                  center.invitation.hasRedeemed
                    ? "已使用过邀请码"
                    : center.invitation.enabled
                      ? "输入他人邀请码"
                      : "奖励暂未开放"
                }
                className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm disabled:opacity-45"
              />
              <button
                disabled={
                  busy === "invite" ||
                  !inviteCode.trim() ||
                  !center.invitation.enabled ||
                  center.invitation.hasRedeemed
                }
                className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black disabled:opacity-35"
              >
                兑换
              </button>
            </form>
          </article>

          <RechargePanel
            service={rechargeService}
            onWalletChanged={onWalletChanged}
          />

          <article className="glass-panel rounded-2xl p-5 md:col-span-2">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.16em] text-rose-100/45">
                  Promotion
                </p>
                <h3 className="mt-2 text-lg font-semibold text-white">
                  推广获取
                </h3>
              </div>
              <p className="text-right text-xs leading-5 text-white/38">
                自绑定起新增超过 {center.promotion.minimumLikes} 赞后，每赞 $
                {center.promotion.usdPerLike}
                <br />
                单作品最高 ${center.promotion.maxRewardUsd}
              </p>
            </div>
            <p className="mt-2 text-sm leading-6 text-white/42">
              支持抖音视频和图文、哔哩哔哩视频和动态、小红书图文和视频笔记。发布带
              #echoo
              标签的作品后请尽快绑定，防止作品被他人占位；结算只计算绑定后新增的点赞。
            </p>
            <form
              onSubmit={bind}
              className="mt-4 flex flex-col gap-2 sm:flex-row"
            >
              <textarea
                value={shareText}
                onChange={(event) => setShareText(event.target.value)}
                placeholder="粘贴平台分享文本或链接"
                rows={2}
                className="min-w-0 flex-1 resize-none rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm"
              />
              <button
                disabled={busy === "bind" || !shareText.trim()}
                className="rounded-lg bg-white px-5 py-2 text-sm font-medium text-black disabled:opacity-35"
              >
                {busy === "bind" ? "解析中…" : "绑定作品"}
              </button>
            </form>
            <div className="mt-4 space-y-2">
              {center.promotion.bindings.length ? (
                center.promotion.bindings.map((binding) => (
                  <div
                    key={binding.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/7 bg-black/15 p-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm text-white/70">
                        {platformLabel(binding.platform)} · {binding.workType}
                      </p>
                      <p className="mt-1 truncate font-mono text-[11px] text-white/30">
                        {binding.externalContentId}
                      </p>
                      <p className="mt-1 text-xs text-white/38">
                        绑定时 {binding.initialLikeCount} 赞
                        {binding.lastCheckedLikeCount !== undefined
                          ? ` · 最近 ${binding.lastCheckedLikeCount} 赞`
                          : ""}
                        {binding.settledRewardUsd
                          ? ` · 已结算 $${binding.settledRewardUsd}`
                          : ""}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={
                        binding.status === "settled" ||
                        !center.promotion.enabled ||
                        busy === `quote:${binding.id}`
                      }
                      onClick={() => void getQuote(binding)}
                      className="rounded-lg border border-white/10 px-3 py-2 text-xs text-white/65 disabled:opacity-35"
                    >
                      {binding.status === "settled"
                        ? "已结算"
                        : center.promotion.enabled
                          ? "获取结算报价"
                          : "结算暂未开放"}
                    </button>
                  </div>
                ))
              ) : (
                <p className="rounded-xl border border-dashed border-white/8 px-4 py-6 text-center text-sm text-white/32">
                  还没有绑定推广作品。
                </p>
              )}
            </div>
          </article>

          <article className="glass-panel rounded-2xl p-5 md:col-span-2">
            <p className="text-xs uppercase tracking-[0.16em] text-emerald-100/45">
              Creator reward
            </p>
            <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-white">创作激励</h3>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-white/42">
                  公开作品保持上架时，使用者通过该作品产生的平台服务 API
                  消耗，会按 1% 自动返还给创作者。创作者本人使用也参与返还。
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-white/35">累计返还</p>
                <p className="mt-1 font-mono text-2xl text-emerald-100">
                  ${center.creator.earnedUsd}
                </p>
              </div>
            </div>
          </article>
        </div>
      ) : null}

      {quote ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="确认推广结算"
          className="app-overlay fixed inset-0 grid place-items-center bg-black/70 p-5 backdrop-blur-sm"
        >
          <div className="w-full max-w-md rounded-2xl border border-white/12 bg-[#151519] p-6 shadow-2xl">
            <p className="text-xs uppercase tracking-[0.18em] text-white/35">
              One-time settlement
            </p>
            <h3 className="mt-2 text-2xl font-semibold text-white">
              确认一次性结算
            </h3>
            <p className="mt-4 text-sm leading-6 text-white/55">
              当前读取到 {quote.likeCount}{" "}
              个赞；本次奖励仅按绑定后新增的点赞计算，将获得
              <strong className="mx-1 text-emerald-100">
                ${quote.rewardUsd}
              </strong>
              。每个作品只能结算一次；点赞量可能继续增长，你可以取消并等待以后再结算。
            </p>
            <p className="mt-3 text-xs text-white/30">
              报价有效至 {new Date(quote.expiresAt).toLocaleTimeString()}
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                disabled={busy === "settle"}
                onClick={() => setQuote(null)}
                className="rounded-lg border border-white/10 px-4 py-2 text-sm text-white/60"
              >
                取消，继续等待
              </button>
              <button
                type="button"
                disabled={busy === "settle"}
                onClick={settle}
                className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black disabled:opacity-40"
              >
                {busy === "settle" ? "结算中…" : "确认结算"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function platformLabel(platform: PromotionBindingView["platform"]) {
  if (platform === "douyin") return "抖音";
  if (platform === "bilibili") return "哔哩哔哩";
  return "小红书";
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : "操作失败，请稍后重试。";
}
