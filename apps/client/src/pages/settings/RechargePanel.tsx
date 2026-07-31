import type {
  RechargeCheckoutView,
  RechargeConfigView,
  RechargeOrderView,
  RechargePaymentType,
} from "@echoo/shared";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { isTauri } from "../../runtimes/factory/detectPlatform";
import type { RechargeService } from "../../services/RechargeService";

export function RechargePanel({
  service,
  onWalletChanged,
}: {
  service: RechargeService;
  onWalletChanged: () => Promise<void>;
}) {
  const [config, setConfig] = useState<RechargeConfigView | null>(null);
  const [creditUsd, setCreditUsd] = useState("10");
  const [paymentType, setPaymentType] =
    useState<RechargePaymentType>("alipay");
  const [pendingOrder, setPendingOrder] = useState<RechargeOrderView | null>(
    null,
  );
  const [pendingCheckout, setPendingCheckout] =
    useState<RechargeCheckoutView | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const nativeShell = isTauri();
  const reconcileInFlight = useRef(false);
  const pendingOrderRef = useRef<RechargeOrderView | null>(null);

  useEffect(() => {
    let cancelled = false;
    void service
      .getConfig()
      .then((value) => {
        if (!cancelled) setConfig(value);
      })
      .catch((caught) => {
        if (!cancelled) setError(messageOf(caught));
      });
    return () => {
      cancelled = true;
    };
  }, [service]);

  useEffect(() => {
    const url = new URL(window.location.href);
    const outTradeNo = url.searchParams.get("rechargeOrder");
    if (!outTradeNo || !/^\d{1,32}$/.test(outTradeNo)) return;
    let cancelled = false;
    setStatus("正在确认充值结果…");
    void confirmOrder(service, outTradeNo)
      .then(async (order) => {
        if (cancelled) return;
        pendingOrderRef.current = order.status === "pending" ? order : null;
        setPendingOrder(order.status === "pending" ? order : null);
        if (order.status === "paid") {
          await onWalletChanged();
          if (!cancelled) setStatus(`充值成功，已到账 ${order.creditUsd} USD。`);
        } else if (!cancelled) {
          setStatus("支付结果尚未确认，可稍后手动刷新。");
        }
      })
      .catch((caught) => {
        if (!cancelled) setError(messageOf(caught));
      })
      .finally(() => {
        url.searchParams.delete("rechargeOrder");
        url.searchParams.delete("rechargeResult");
        window.history.replaceState({}, "", url);
      });
    return () => {
      cancelled = true;
    };
  }, [service, onWalletChanged]);

  const moneyCny = useMemo(() => {
    return calculatePreviewMoneyCny(creditUsd, config?.usdToCnyRate ?? null);
  }, [config?.usdToCnyRate, creditUsd]);

  const reconcilePending = useCallback(
    async (order: RechargeOrderView) => {
      if (reconcileInFlight.current) return;
      reconcileInFlight.current = true;
      setError("");
      setStatus("正在查询支付平台…");
      try {
        const current = await service.reconcile(order.outTradeNo);
        pendingOrderRef.current = current.status === "pending" ? current : null;
        setPendingOrder(current.status === "pending" ? current : null);
        if (current.status === "paid") {
          setPendingCheckout(null);
          await onWalletChanged();
          setStatus(`充值成功，已到账 ${current.creditUsd} USD。`);
        } else {
          setStatus("支付结果尚未确认，请稍后再试。");
        }
      } catch (caught) {
        setError(messageOf(caught));
        setStatus("");
      } finally {
        reconcileInFlight.current = false;
      }
    },
    [onWalletChanged, service],
  );

  useEffect(() => {
    if (!nativeShell) return;
    const handleVisibilityChange = () => {
      const order = pendingOrderRef.current;
      if (document.visibilityState === "visible" && order)
        void reconcilePending(order);
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [nativeShell, reconcilePending]);

  const createOrder = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setStatus("");
    setSubmitting(true);
    try {
      const checkout = await service.createOrder({ creditUsd, paymentType });
      pendingOrderRef.current = checkout.order;
      setPendingOrder(checkout.order);
      setPendingCheckout(checkout);
      const destination = await service.submitCheckout(checkout);
      if (destination === "external") {
        setStatus("收银台已在浏览器中打开。支付完成后请返回 Echoo。");
        setSubmitting(false);
      }
    } catch (caught) {
      setError(messageOf(caught));
      setSubmitting(false);
    }
  };

  const refreshPending = async () => {
    if (!pendingOrder) return;
    await reconcilePending(pendingOrder);
  };

  const reopenCheckout = async () => {
    if (!pendingCheckout) return;
    setError("");
    try {
      await service.submitCheckout(pendingCheckout);
      setStatus("收银台已在浏览器中打开。支付完成后请返回 Echoo。");
    } catch (caught) {
      setError(messageOf(caught));
    }
  };

  return (
    <section className="glass-panel rounded-2xl p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-white/35">
            Recharge
          </p>
          <h2 className="mt-2 text-xl font-semibold text-white">充值获取</h2>
          <p className="mt-2 text-sm leading-6 text-white/42">
            购买美元额度，人民币实付按下单时汇率锁定。
          </p>
        </div>
        {config?.usdToCnyRate ? (
          <span className="rounded-full bg-white/[0.05] px-3 py-1 text-xs text-white/50">
            1 USD = {config.usdToCnyRate} CNY
          </span>
        ) : null}
      </div>

      <form onSubmit={createOrder} className="mt-5 space-y-4">
        <div className="flex flex-wrap gap-2">
            {(config?.quickAmountsUsd ?? ["5", "10", "20", "50", "100"]).map(
              (amount) => (
                <button
                  key={amount}
                  type="button"
                  onClick={() => setCreditUsd(amount)}
                  className={`rounded-lg border px-3 py-2 text-sm ${creditUsd === amount ? "border-white/25 bg-white text-black" : "border-white/10 text-white/60"}`}
                >
                  ${amount}
                </button>
              ),
            )}
        </div>
        <div className="grid gap-3 md:grid-cols-2">
            <label className="text-sm text-white/55">
              充值美元额度
              <input
                required
                type="number"
                min={config?.minimumCreditUsd ?? "0.1"}
                max="1000"
                step="0.01"
                inputMode="decimal"
                value={creditUsd}
                onChange={(event) => setCreditUsd(event.target.value)}
                className="mt-1.5 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2.5"
              />
            </label>
            <div>
              <span className="text-sm text-white/55">支付方式</span>
              <div className="mt-1.5 grid grid-cols-2 gap-2">
                {(
                  [
                    ["alipay", "支付宝"],
                    ["wxpay", "微信支付"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setPaymentType(value)}
                    className={`rounded-lg border px-3 py-2.5 text-sm ${paymentType === value ? "border-white/25 bg-white/[0.08] text-white" : "border-white/10 text-white/45"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-black/15 p-4">
            <p className="text-sm text-white/50">
              ${creditUsd || "0"} × {config?.usdToCnyRate ?? "—"} =
              <strong className="ml-2 font-mono text-lg text-white/85">
                ¥{moneyCny ?? "—"}
              </strong>
            </p>
            <button
              disabled={!config?.enabled || submitting || !moneyCny}
              className="rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-35"
            >
              {submitting ? "正在创建订单…" : "前往支付"}
            </button>
        </div>
        {!config?.enabled ? (
          <p className="text-xs text-amber-100/55">
            {rechargeUnavailableMessage(config)}
          </p>
        ) : null}
      </form>

      {pendingOrder ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-white/8 pt-4 text-sm">
          <span className="text-white/45">
            待确认订单 {pendingOrder.outTradeNo} · ¥{pendingOrder.moneyCny}
          </span>
          <div className="flex flex-wrap gap-2">
            {nativeShell && pendingCheckout ? (
              <button
                type="button"
                onClick={() => void reopenCheckout()}
                className="rounded-lg border border-white/10 px-3 py-2 text-white/65"
              >
                重新打开收银台
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => void refreshPending()}
              className="rounded-lg border border-white/10 px-3 py-2 text-white/65"
            >
              刷新支付结果
            </button>
          </div>
        </div>
      ) : null}
      {status ? <p className="mt-4 text-sm text-emerald-100/65">{status}</p> : null}
      {error ? <p className="mt-4 text-sm text-red-200/75">{error}</p> : null}
    </section>
  );
}

async function confirmOrder(service: RechargeService, outTradeNo: string) {
  const order = await service.getOrder(outTradeNo);
  return order.status === "paid" ? order : service.reconcile(outTradeNo);
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : "充值操作失败。";
}

export function rechargeUnavailableMessage(config: RechargeConfigView | null) {
  if (!config?.paymentConfigured && !config?.usdToCnyRate)
    return "在线充值尚未配置商户，管理员也尚未设置汇率。";
  if (!config?.paymentConfigured)
    return "管理员已设置汇率，但在线充值尚未配置商户。请联系管理员配置并重启服务。";
  if (!config.usdToCnyRate) return "在线充值商户已配置，但管理员尚未设置汇率。";
  return "在线充值暂不可用，请稍后重试。";
}

export function calculatePreviewMoneyCny(
  creditUsd: string,
  usdToCnyRate: string | null,
) {
  if (
    !/^\d+(?:\.\d{1,2})?$/.test(creditUsd) ||
    !usdToCnyRate ||
    !/^\d+(?:\.\d{1,6})?$/.test(usdToCnyRate)
  )
    return null;
  const [usdWhole, usdFraction = ""] = creditUsd.split(".");
  const [rateWhole, rateFraction = ""] = usdToCnyRate.split(".");
  const creditMicro =
    BigInt(usdWhole) * 1_000_000n +
    BigInt(usdFraction.padEnd(2, "0")) * 10_000n;
  const rateMicro =
    BigInt(rateWhole) * 1_000_000n +
    BigInt(rateFraction.padEnd(6, "0"));
  const fen = (creditMicro * rateMicro + 5_000_000_000n) / 10_000_000_000n;
  return `${fen / 100n}.${String(fen % 100n).padStart(2, "0")}`;
}
