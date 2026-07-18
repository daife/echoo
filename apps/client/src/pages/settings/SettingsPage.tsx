import type {
  PrimeFigureRuntimeConfigPatch,
  SliceFigureRuntimeConfigPatch,
  UserRuntimeConfigView,
  WalletView,
} from "@echoo/shared";
import { ArrowLeft } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../app/providers/AuthProvider";
import {
  PrimeRuntimeConfigForm,
  SliceRuntimeConfigForm,
} from "../../features/runtime-config/RuntimeConfigForms";
import type { RuntimeConfigService } from "../../services/RuntimeConfigService";
import type { RewardsService } from "../../services/RewardsService";
import type { RechargeService } from "../../services/RechargeService";
import { RewardCenter } from "./RewardCenter";
import { RechargePanel } from "./RechargePanel";

export function SettingsPage({
  runtimeConfigService,
  rewardsService,
  rechargeService,
  onBack,
}: {
  runtimeConfigService: RuntimeConfigService;
  rewardsService: RewardsService;
  rechargeService: RechargeService;
  onBack: () => void;
}) {
  const auth = useAuth();
  const [config, setConfig] = useState<UserRuntimeConfigView | null>(null);
  const [section, setSection] = useState<
    "slice-figure" | "prime-figure" | "prime-world"
  >("slice-figure");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [wallet, setWallet] = useState<WalletView | null>(null);

  const refreshWallet = useCallback(async () => {
    setWallet(await runtimeConfigService.getWallet());
  }, [runtimeConfigService]);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    void Promise.all([
      runtimeConfigService.getUserConfig(),
      runtimeConfigService.getWallet(),
    ])
      .then(([value, walletValue]) => {
        if (!cancelled) {
          setConfig(value);
          setWallet(walletValue);
        }
      })
      .catch((caught) => {
        if (!cancelled)
          setError(caught instanceof Error ? caught.message : "配置加载失败。");
      });
    return () => {
      cancelled = true;
    };
  }, [runtimeConfigService]);

  async function updateSlice(patch: SliceFigureRuntimeConfigPatch) {
    setError(null);
    setNotice(null);
    try {
      const next = await runtimeConfigService.updateUserConfig({
        sliceFigure: patch,
      });
      setConfig(next);
      setNotice(saveNotice("切片角色全局配置已保存。", next));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "配置保存失败。");
      throw caught;
    }
  }

  async function updatePrime(patch: PrimeFigureRuntimeConfigPatch) {
    setError(null);
    setNotice(null);
    try {
      const next = await runtimeConfigService.updateUserConfig({
        primeFigure: patch,
      });
      setConfig(next);
      setNotice(saveNotice("本初角色全局配置已保存。", next));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "配置保存失败。");
      throw caught;
    }
  }

  return (
    <section className="space-y-6">
      <div className="flex items-start gap-3">
        <button
          aria-label="返回"
          className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-lg text-white/48 transition hover:bg-white/[0.06] hover:text-white active:translate-y-px"
          type="button"
          onClick={onBack}
        >
          <ArrowLeft size={19} />
        </button>
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-white/38">
            账户与运行时
          </p>
          <h1 className="mt-2 text-4xl font-semibold text-white">设置</h1>
        </div>
      </div>
      <div className="glass-panel flex flex-col gap-4 rounded-2xl p-5 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="font-medium text-white">{auth.user?.displayName}</h2>
          <p className="mt-1 text-sm text-white/42">{auth.user?.email}</p>
        </div>
        <button
          className="rounded-full border border-white/10 px-4 py-2 text-sm text-white/65 transition hover:border-white/20 hover:text-white active:scale-95"
          onClick={() => void auth.signOut()}
        >
          退出登录
        </button>
      </div>
      <div className="glass-panel rounded-2xl p-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-white/35">
              Platform balance
            </p>
            <p
              className={`mt-2 font-mono text-3xl ${Number(wallet?.balanceUsd ?? 0) > 0 ? "text-emerald-100" : "text-red-200"}`}
            >
              ${wallet?.balanceUsd ?? "0"}
            </p>
          </div>
          <p className="max-w-md text-sm leading-6 text-white/40">
            仅平台提供的模型与 TTS 会扣除此余额；自定义地址和 Key
            不计入平台账单。
          </p>
        </div>
        {wallet?.entries.length ? (
          <details className="mt-4 border-t border-white/8 pt-4">
            <summary className="cursor-pointer text-sm text-white/55">
              最近账单
            </summary>
            <div className="mt-3 max-h-64 space-y-2 overflow-auto">
              {wallet.entries.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-start justify-between gap-4 rounded-lg bg-black/15 p-3 text-xs"
                >
                  <span>
                    <strong className="block text-white/70">
                      {entry.note ??
                        `${entry.service ?? "平台"} · ${entry.model ?? "余额调整"}`}
                    </strong>
                    <small className="text-white/30">
                      {new Date(entry.createdAt).toLocaleString()}
                    </small>
                  </span>
                  <span className="font-mono text-white/60">
                    {entry.amountUsd} USD
                  </span>
                </div>
              ))}
            </div>
          </details>
        ) : null}
      </div>
      <RechargePanel
        service={rechargeService}
        onWalletChanged={refreshWallet}
      />
      <RewardCenter
        service={rewardsService}
        onWalletChanged={refreshWallet}
      />
      <div className="glass-panel rounded-2xl p-5 md:p-6">
        <div className="mb-6">
          <h2 className="text-xl font-semibold text-white">用户全局运行配置</h2>
          <p className="mt-1 text-sm leading-6 text-white/42">
            选择使用全局配置的会话会在下一次运行时读取这里的最新值。
          </p>
        </div>
        <div className="mb-6 flex flex-wrap gap-2">
          {(
            [
              ["slice-figure", "切片角色"],
              ["prime-figure", "本初角色"],
              ["prime-world", "本初世界"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                setSection(id);
                setNotice(null);
                setError(null);
              }}
              className={`rounded-lg px-4 py-2 text-sm transition ${section === id ? "bg-white text-black" : "bg-white/[0.04] text-white/55 hover:text-white"}`}
            >
              {label}
            </button>
          ))}
        </div>
        {!config && !error ? (
          <p className="py-10 text-center text-sm text-white/38">
            正在加载运行配置…
          </p>
        ) : null}
        {config && section === "slice-figure" ? (
          <SliceRuntimeConfigForm
            value={config.sliceFigure}
            presets={config.presets?.sliceFigure}
            onSave={updateSlice}
            error={error}
            notice={notice}
          />
        ) : null}
        {config && section === "prime-figure" ? (
          <PrimeRuntimeConfigForm
            value={config.primeFigure}
            presets={config.presets?.primeFigure}
            onSave={updatePrime}
            error={error}
            notice={notice}
          />
        ) : null}
        {config && section === "prime-world" ? (
          <div className="rounded-xl border border-dashed border-white/10 px-5 py-12 text-center">
            <p className="text-sm font-medium text-white/70">
              本初世界配置 v{config.primeWorld.version}
            </p>
            <p className="mt-2 text-sm text-white/38">
              配置结构已预留，当前版本暂无可编辑参数。
            </p>
          </div>
        ) : null}
        {!config && error ? (
          <p className="text-sm text-red-200/75">{error}</p>
        ) : null}
      </div>
    </section>
  );
}

function saveNotice(base: string, config: UserRuntimeConfigView) {
  return config.warnings?.length
    ? `${base} 提示：${config.warnings.map((warning) => warning.message).join("；")}`
    : base;
}
