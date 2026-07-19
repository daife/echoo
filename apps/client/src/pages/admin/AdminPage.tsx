import type {
  AdminRuntimeDefaultsView,
  ModelRecommendationCategory,
  PrimeFigureRuntimeConfigPatch,
  RecommendedModelView,
  SliceFigureRuntimeConfigPatch,
  RuntimeConfigPresetsView,
  WalletView,
  AdminPlatformSettingsView,
} from "@echoo/shared";
import { ApiClient } from "@echoo/api-client";
import { useEffect, useState, type FormEvent } from "react";
import {
  PrimeRuntimeConfigForm,
  SliceRuntimeConfigForm,
} from "../../features/runtime-config/RuntimeConfigForms";

type AdminUser = {
  id: string;
  email: string;
  displayName: string;
  balanceUsd: string;
  createdAt: number;
};

type CatalogModel = {
  modelId: string;
  name: string;
  description?: string | null;
  inputModalities: string[];
  outputModalities: string[];
  supportedParameters: string[];
  pricing: Record<string, string | number | null>;
  available: boolean;
  syncedAt: number;
  providers: Array<{
    provider_slug: string;
    provider_name: string;
    pricing: unknown;
    status: number;
  }>;
};

const categories: Array<{ value: ModelRecommendationCategory; label: string }> =
  [
    { value: "slice_text", label: "切片文本模型" },
    { value: "prime_decision", label: "本初决策模型" },
    { value: "image_generation", label: "图像生成" },
    { value: "image_optimization", label: "生图提示优化" },
    { value: "voice_optimization", label: "语音文本优化" },
    { value: "visual_understanding", label: "视觉理解" },
    { value: "audio_understanding", label: "音频理解" },
    { value: "fish_tts", label: "Fish Audio TTS" },
  ];

export function AdminPage() {
  const [token, setToken] = useState(
    () => sessionStorage.getItem("echoo_admin_token") ?? "",
  );
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function login(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const result = await adminRequest<{ accessToken: string }>("/login", {
        method: "POST",
        body: { password },
      });
      sessionStorage.setItem("echoo_admin_token", result.accessToken);
      setToken(result.accessToken);
      setPassword("");
    } catch (reason) {
      setError(messageOf(reason));
    }
  }

  if (!token)
    return (
      <main className="grid min-h-screen place-items-center bg-[#09090b] p-6 text-white">
        <form
          onSubmit={login}
          className="w-full max-w-sm space-y-5 rounded-2xl border border-white/10 bg-white/[0.035] p-7"
        >
          <div>
            <p className="text-xs uppercase tracking-[0.22em] text-white/35">
              Echoo Control
            </p>
            <h1 className="mt-2 text-3xl font-semibold">管理员后台</h1>
          </div>
          <input
            autoFocus
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="ADMIN_PASSWORD"
            className="w-full rounded-lg border border-white/10 bg-black/25 px-3 py-3 outline-none focus:border-white/25"
          />
          {error ? <p className="text-sm text-red-200/75">{error}</p> : null}
          <button className="w-full rounded-lg bg-white py-3 font-semibold text-black">
            登录
          </button>
        </form>
      </main>
    );

  return (
    <AdminConsole
      token={token}
      onExpired={() => {
        sessionStorage.removeItem("echoo_admin_token");
        setToken("");
      }}
    />
  );
}

function AdminConsole({
  token,
  onExpired,
}: {
  token: string;
  onExpired: () => void;
}) {
  const [section, setSection] = useState<
    | "billing"
    | "rewards"
    | "models"
    | "recommendations"
    | "runtime-defaults"
  >("billing");
  return (
    <main className="min-h-screen bg-[#09090b] p-5 text-[#e5e2e1] md:p-10">
      <div className="mx-auto max-w-7xl space-y-7">
        <header className="flex flex-wrap items-end justify-between gap-4 border-b border-white/10 pb-6">
          <div>
            <p className="text-xs uppercase tracking-[0.22em] text-white/35">
              Echoo Control
            </p>
            <h1 className="mt-2 text-4xl font-semibold text-white">平台管理</h1>
          </div>
          <button
            onClick={onExpired}
            className="rounded-lg border border-white/10 px-4 py-2 text-sm text-white/55"
          >
            退出
          </button>
        </header>
        <nav className="flex flex-wrap gap-2">
          {(
            [
              ["billing", "用户与余额"],
              ["rewards", "奖励配置"],
              ["models", "OpenRouter 模型"],
              ["recommendations", "推荐与计费"],
              ["runtime-defaults", "新用户默认配置"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setSection(id)}
              className={`rounded-lg px-4 py-2 text-sm ${section === id ? "bg-white text-black" : "bg-white/[0.05] text-white/60"}`}
            >
              {label}
            </button>
          ))}
        </nav>
        {section === "billing" ? (
          <BillingPanel token={token} onExpired={onExpired} />
        ) : null}
        {section === "rewards" ? (
          <RewardSettingsPanel token={token} onExpired={onExpired} />
        ) : null}
        {section === "models" ? (
          <ModelsPanel token={token} onExpired={onExpired} />
        ) : null}
        {section === "recommendations" ? (
          <RecommendationsPanel token={token} onExpired={onExpired} />
        ) : null}
        {section === "runtime-defaults" ? (
          <RuntimeDefaultsPanel token={token} onExpired={onExpired} />
        ) : null}
      </div>
    </main>
  );
}

function RuntimeDefaultsPanel({ token, onExpired }: PanelProps) {
  const [value, setValue] = useState<AdminRuntimeDefaultsView | null>(null);
  const [status, setStatus] = useState("");
  const [newSliceName, setNewSliceName] = useState("");
  const [newPrimeName, setNewPrimeName] = useState("");

  const load = async () => {
    try {
      setValue(
        await authed<AdminRuntimeDefaultsView>(token, "/runtime-defaults"),
      );
      setStatus("");
    } catch (error) {
      handlePanelError(error, setStatus, onExpired);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const save = async (patch: {
    sliceFigure?: SliceFigureRuntimeConfigPatch;
    primeFigure?: PrimeFigureRuntimeConfigPatch;
  }) => {
    try {
      const next = await authed<AdminRuntimeDefaultsView>(
        token,
        "/runtime-defaults",
        { method: "PATCH", body: patch },
      );
      setValue(next);
      setStatus("新用户默认配置已保存；既有用户配置不受影响。");
    } catch (error) {
      handlePanelError(error, setStatus, onExpired);
      throw error;
    }
  };

  const mutatePreset = async (
    method: "POST" | "PATCH" | "DELETE",
    path: string,
    body?: unknown,
  ) => {
    try {
      const presets = await authed<RuntimeConfigPresetsView>(
        token,
        `/runtime-presets/${path}`,
        { method, ...(body === undefined ? {} : { body }) },
      );
      setValue((current) => (current ? { ...current, presets } : current));
      setStatus("推荐配置已更新。");
      return presets;
    } catch (error) {
      handlePanelError(error, setStatus, onExpired);
      throw error;
    }
  };

  const setPresetName = (
    type: "sliceFigure" | "primeFigure",
    id: string,
    name: string,
  ) =>
    setValue((current) =>
      current
        ? {
            ...current,
            presets: {
              ...current.presets,
              [type]: current.presets[type].map((preset) =>
                preset.id === id ? { ...preset, name } : preset,
              ),
            },
          }
        : current,
    );

  if (!value)
    return (
      <section className="rounded-2xl border border-white/10 bg-white/[0.025] p-5">
        <p className="text-sm text-white/50">{status || "正在加载默认配置…"}</p>
      </section>
    );

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-white/10 bg-white/[0.025] p-5">
        <h2 className="text-xl font-semibold">新用户配置快照</h2>
        <p className="mt-2 text-sm leading-6 text-white/45">
          这里只允许平台来源，不保存 API Key。保存后仅影响之后注册的用户。
          最后更新：{new Date(value.updatedAt).toLocaleString()}
        </p>
        {status ? <p className="mt-3 text-sm text-white/60">{status}</p> : null}
      </section>
      <section className="rounded-2xl border border-white/10 bg-white/[0.025] p-5">
        <h2 className="mb-5 text-xl font-semibold">切片角色默认配置</h2>
        <SliceRuntimeConfigForm
          platformOnly
          value={value.config.sliceFigure}
          onSave={(sliceFigure) => save({ sliceFigure })}
        />
      </section>
      <section className="rounded-2xl border border-white/10 bg-white/[0.025] p-5">
        <h2 className="mb-5 text-xl font-semibold">本初角色默认配置</h2>
        <PrimeRuntimeConfigForm
          platformOnly
          value={value.config.primeFigure}
          onSave={(primeFigure) => save({ primeFigure })}
        />
      </section>
      <section className="rounded-2xl border border-white/10 bg-white/[0.025] p-5">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">切片角色推荐配置</h2>
            <p className="mt-1 text-sm text-white/40">
              数量不限，用户可在同一配置表单中一键应用。
            </p>
          </div>
          <div className="flex gap-2">
            <input
              value={newSliceName}
              onChange={(event) => setNewSliceName(event.target.value)}
              placeholder="例如：极致节省"
              className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm"
            />
            <button
              type="button"
              onClick={() => {
                if (!newSliceName.trim()) return;
                void mutatePreset("POST", "slice-figure", {
                  name: newSliceName,
                }).then(() => setNewSliceName(""));
              }}
              className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black"
            >
              新增
            </button>
          </div>
        </div>
        <div className="space-y-5">
          {value.presets.sliceFigure.map((preset) => (
            <article
              key={preset.id}
              className="rounded-xl border border-white/8 bg-black/10 p-4"
            >
              <div className="mb-5 flex flex-wrap gap-2">
                <input
                  value={preset.name}
                  onChange={(event) =>
                    setPresetName("sliceFigure", preset.id, event.target.value)
                  }
                  className="min-w-52 flex-1 rounded-lg border border-white/10 bg-black/20 px-3 py-2"
                />
                <button
                  type="button"
                  onClick={() =>
                    void mutatePreset("PATCH", `slice-figure/${preset.id}`, {
                      name: preset.name,
                    })
                  }
                  className="rounded-lg border border-white/10 px-3 py-2 text-sm"
                >
                  保存名称
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void mutatePreset("DELETE", `slice-figure/${preset.id}`)
                  }
                  className="rounded-lg border border-red-300/15 px-3 py-2 text-sm text-red-100/65"
                >
                  删除
                </button>
              </div>
              <SliceRuntimeConfigForm
                platformOnly
                value={preset.config}
                onSave={async (config) => {
                  await mutatePreset("PATCH", `slice-figure/${preset.id}`, {
                    config,
                  });
                }}
              />
            </article>
          ))}
        </div>
      </section>
      <section className="rounded-2xl border border-white/10 bg-white/[0.025] p-5">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">本初角色推荐配置</h2>
            <p className="mt-1 text-sm text-white/40">
              预设编辑与用户编辑复用完全相同的表单。
            </p>
          </div>
          <div className="flex gap-2">
            <input
              value={newPrimeName}
              onChange={(event) => setNewPrimeName(event.target.value)}
              placeholder="例如：均衡"
              className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm"
            />
            <button
              type="button"
              onClick={() => {
                if (!newPrimeName.trim()) return;
                void mutatePreset("POST", "prime-figure", {
                  name: newPrimeName,
                }).then(() => setNewPrimeName(""));
              }}
              className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black"
            >
              新增
            </button>
          </div>
        </div>
        <div className="space-y-5">
          {value.presets.primeFigure.map((preset) => (
            <article
              key={preset.id}
              className="rounded-xl border border-white/8 bg-black/10 p-4"
            >
              <div className="mb-5 flex flex-wrap gap-2">
                <input
                  value={preset.name}
                  onChange={(event) =>
                    setPresetName("primeFigure", preset.id, event.target.value)
                  }
                  className="min-w-52 flex-1 rounded-lg border border-white/10 bg-black/20 px-3 py-2"
                />
                <button
                  type="button"
                  onClick={() =>
                    void mutatePreset("PATCH", `prime-figure/${preset.id}`, {
                      name: preset.name,
                    })
                  }
                  className="rounded-lg border border-white/10 px-3 py-2 text-sm"
                >
                  保存名称
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void mutatePreset("DELETE", `prime-figure/${preset.id}`)
                  }
                  className="rounded-lg border border-red-300/15 px-3 py-2 text-sm text-red-100/65"
                >
                  删除
                </button>
              </div>
              <PrimeRuntimeConfigForm
                platformOnly
                value={preset.config}
                onSave={async (config) => {
                  await mutatePreset("PATCH", `prime-figure/${preset.id}`, {
                    config,
                  });
                }}
              />
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function BillingPanel({ token, onExpired }: PanelProps) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [wallet, setWallet] = useState<WalletView | null>(null);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [status, setStatus] = useState("");
  const [usdToCnyRate, setUsdToCnyRate] = useState("");
  const [paymentConfigured, setPaymentConfigured] = useState(false);

  const loadUsers = async () => {
    try {
      setUsers(
        await authed<AdminUser[]>(
          token,
          `/users?q=${encodeURIComponent(query)}`,
        ),
      );
    } catch (error) {
      handlePanelError(error, setStatus, onExpired);
    }
  };
  useEffect(() => {
    void loadUsers();
    void authed<AdminPlatformSettingsView>(token, "/settings")
      .then((settings) => {
        setUsdToCnyRate(settings.recharge.usdToCnyRate ?? "");
        setPaymentConfigured(settings.recharge.paymentConfigured);
      })
      .catch((error) => handlePanelError(error, setStatus, onExpired));
  }, []);

  const saveRechargeSettings = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const settings = await authed<AdminPlatformSettingsView>(
        token,
        "/settings",
        { method: "PATCH", body: { usdToCnyRate } },
      );
      setUsdToCnyRate(settings.recharge.usdToCnyRate ?? "");
      setPaymentConfigured(settings.recharge.paymentConfigured);
      setStatus("充值汇率已保存，仅影响新创建的订单。");
    } catch (error) {
      handlePanelError(error, setStatus, onExpired);
    }
  };

  const openUser = async (user: AdminUser) => {
    setSelected(user);
    try {
      setWallet(await authed<WalletView>(token, `/users/${user.id}/wallet`));
    } catch (error) {
      handlePanelError(error, setStatus, onExpired);
    }
  };
  const adjust = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    try {
      await authed(token, `/users/${selected.id}/balance-adjustments`, {
        method: "POST",
        body: { amountUsd: amount, note },
      });
      setAmount("");
      setNote("");
      setStatus("余额调整已入账。");
      await Promise.all([loadUsers(), openUser(selected)]);
    } catch (error) {
      handlePanelError(error, setStatus, onExpired);
    }
  };
  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-white/10 bg-white/[0.025] p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold">在线充值设置</h2>
            <p className="mt-2 text-sm leading-6 text-white/40">
              用户购买美元额度，订单按创建时的汇率快照计算人民币实付金额。
            </p>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-xs ${paymentConfigured ? "bg-emerald-300/10 text-emerald-100/70" : "bg-amber-300/10 text-amber-100/70"}`}
          >
            {paymentConfigured ? "易支付环境已配置" : "易支付环境未配置"}
          </span>
        </div>
        <form
          onSubmit={saveRechargeSettings}
          className="mt-5 flex max-w-xl flex-col gap-3 sm:flex-row sm:items-end"
        >
          <label className="flex-1 text-sm text-white/58">
            1 USD = 多少 CNY
            <input
              required
              inputMode="decimal"
              value={usdToCnyRate}
              onChange={(event) => setUsdToCnyRate(event.target.value)}
              placeholder="例如 7.2"
              className="mt-1.5 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2.5"
            />
          </label>
          <button className="rounded-lg bg-white px-4 py-2.5 text-sm font-medium text-black">
            保存充值汇率
          </button>
        </form>
      </section>
      <div className="grid gap-6 lg:grid-cols-[1.1fr_.9fr]">
      <section className="rounded-2xl border border-white/10 bg-white/[0.025] p-5">
        <div className="mb-4 flex gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="邮箱或昵称"
            className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/20 px-3 py-2"
          />
          <button
            onClick={() => void loadUsers()}
            className="rounded-lg bg-white px-4 text-sm font-medium text-black"
          >
            搜索
          </button>
        </div>
        <div className="divide-y divide-white/6">
          {users.map((user) => (
            <button
              key={user.id}
              onClick={() => void openUser(user)}
              className="flex w-full items-center justify-between gap-4 py-3 text-left"
            >
              <span>
                <strong className="block text-sm text-white">
                  {user.displayName}
                </strong>
                <small className="text-white/40">{user.email}</small>
              </span>
              <span
                className={`font-mono text-sm ${Number(user.balanceUsd) > 0 ? "text-emerald-200" : "text-red-200"}`}
              >
                ${user.balanceUsd}
              </span>
            </button>
          ))}
        </div>
      </section>
      <section className="rounded-2xl border border-white/10 bg-white/[0.025] p-5">
        {selected ? (
          <>
            <h2 className="text-xl font-semibold">{selected.displayName}</h2>
            <p className="mt-1 text-sm text-white/40">
              当前余额：${wallet?.balanceUsd ?? selected.balanceUsd}
            </p>
            <form onSubmit={adjust} className="mt-5 space-y-3">
              <input
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="美元金额，如 10 或 -2.5"
                className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2"
              />
              <input
                required
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="调整原因"
                className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2"
              />
              <button className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black">
                确认入账
              </button>
            </form>
            <div className="mt-6 max-h-80 space-y-2 overflow-auto">
              {wallet?.entries.map((entry) => (
                <div
                  key={entry.id}
                  className="rounded-lg bg-black/20 p-3 text-xs"
                >
                  <span className="font-mono">{entry.amountUsd} USD</span>
                  <span className="float-right text-white/35">
                    {new Date(entry.createdAt).toLocaleString()}
                  </span>
                  <p className="mt-1 text-white/45">
                    {entry.note ??
                      `${entry.service ?? ""} ${entry.model ?? ""}`}
                  </p>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="text-sm text-white/40">
            选择一个用户查看账本并调整余额。
          </p>
        )}
        {status ? <p className="mt-4 text-sm text-white/55">{status}</p> : null}
      </section>
      </div>
    </div>
  );
}

function RewardSettingsPanel({ token, onExpired }: PanelProps) {
  const [value, setValue] = useState<AdminPlatformSettingsView | null>(null);
  const [status, setStatus] = useState("");

  const load = async () => {
    try {
      setValue(await authed<AdminPlatformSettingsView>(token, "/settings"));
      setStatus("");
    } catch (error) {
      handlePanelError(error, setStatus, onExpired);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!value) return;
    try {
      const next = await authed<AdminPlatformSettingsView>(token, "/settings", {
        method: "PATCH",
        body: {
          newUserInitialCreditUsd: value.newUserInitialCreditUsd,
          invitation: {
            inviterRewardUsd: value.invitation.inviterRewardUsd,
            inviteeRewardUsd: value.invitation.inviteeRewardUsd,
          },
          promotion: {
            minimumLikes: value.promotion.minimumLikes,
            usdPerLike: value.promotion.usdPerLike,
            maxRewardUsd: value.promotion.maxRewardUsd,
          },
        },
      });
      setValue(next);
      setStatus("奖励配置已保存。新兑换和新报价将使用最新参数。");
    } catch (error) {
      handlePanelError(error, setStatus, onExpired);
    }
  };

  if (!value)
    return (
      <section className="rounded-2xl border border-white/10 bg-white/[0.025] p-5">
        <p className="text-sm text-white/50">{status || "正在加载奖励配置…"}</p>
      </section>
    );

  return (
    <form onSubmit={save} className="space-y-6">
      <section className="rounded-2xl border border-white/10 bg-white/[0.025] p-5">
        <h2 className="text-xl font-semibold">新用户初始额度</h2>
        <p className="mt-2 text-sm leading-6 text-white/42">
          仅影响之后首次创建余额账户的新用户。
        </p>
        <label className="mt-5 block text-sm text-white/58">
          初始额度（USD）
          <input
            required
            inputMode="decimal"
            value={value.newUserInitialCreditUsd}
            onChange={(event) =>
              setValue({
                ...value,
                newUserInitialCreditUsd: event.target.value,
              })
            }
            className="mt-1.5 w-full max-w-sm rounded-lg border border-white/10 bg-black/20 px-3 py-2.5"
          />
        </label>
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/[0.025] p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold">邀请注册奖励</h2>
            <p className="mt-2 text-sm leading-6 text-white/42">
              两项都大于 0 时开放。修改只影响之后发生的兑换。
            </p>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-xs ${value.invitation.enabled ? "bg-emerald-200/10 text-emerald-100/75" : "bg-white/[0.05] text-white/40"}`}
          >
            {value.invitation.enabled ? "已开放" : "已关闭"}
          </span>
        </div>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <label className="text-sm text-white/58">
            邀请人奖励（USD）
            <input
              required
              inputMode="decimal"
              value={value.invitation.inviterRewardUsd}
              onChange={(event) =>
                setValue({
                  ...value,
                  invitation: {
                    ...value.invitation,
                    inviterRewardUsd: event.target.value,
                  },
                })
              }
              className="mt-1.5 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2.5"
            />
          </label>
          <label className="text-sm text-white/58">
            新用户奖励（USD）
            <input
              required
              inputMode="decimal"
              value={value.invitation.inviteeRewardUsd}
              onChange={(event) =>
                setValue({
                  ...value,
                  invitation: {
                    ...value.invitation,
                    inviteeRewardUsd: event.target.value,
                  },
                })
              }
              className="mt-1.5 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2.5"
            />
          </label>
        </div>
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/[0.025] p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold">推广结算</h2>
            <p className="mt-2 text-sm leading-6 text-white/42">
              三个平台共用：min(上限, max(0, 点赞 - 门槛) × 每赞金额)。每赞金额和上限都大于 0 时开放结算。
            </p>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-xs ${value.promotion.enabled ? "bg-emerald-200/10 text-emerald-100/75" : "bg-white/[0.05] text-white/40"}`}
          >
            {value.promotion.enabled ? "已开放" : "已关闭"}
          </span>
        </div>
        <div className="mt-5 grid gap-4 md:grid-cols-3">
          <label className="text-sm text-white/58">
            有效点赞门槛
            <input
              required
              type="number"
              min="0"
              step="1"
              value={value.promotion.minimumLikes}
              onChange={(event) =>
                setValue({
                  ...value,
                  promotion: {
                    ...value.promotion,
                    minimumLikes: Number(event.target.value),
                  },
                })
              }
              className="mt-1.5 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2.5"
            />
          </label>
          <label className="text-sm text-white/58">
            每赞金额（USD）
            <input
              required
              inputMode="decimal"
              value={value.promotion.usdPerLike}
              onChange={(event) =>
                setValue({
                  ...value,
                  promotion: {
                    ...value.promotion,
                    usdPerLike: event.target.value,
                  },
                })
              }
              className="mt-1.5 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2.5"
            />
          </label>
          <label className="text-sm text-white/58">
            单作品上限（USD）
            <input
              required
              inputMode="decimal"
              value={value.promotion.maxRewardUsd}
              onChange={(event) =>
                setValue({
                  ...value,
                  promotion: {
                    ...value.promotion,
                    maxRewardUsd: event.target.value,
                  },
                })
              }
              className="mt-1.5 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2.5"
            />
          </label>
        </div>
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/[0.025] p-5">
        <h2 className="text-xl font-semibold">创作激励</h2>
        <p className="mt-2 text-sm leading-6 text-white/45">
          固定返还 {value.creator.rewardPercent}%：仅公开作品处于上架状态且使用平台服务 API 时触发，暂不支持修改。
        </p>
      </section>

      <button className="rounded-lg bg-white px-5 py-2.5 text-sm font-medium text-black">
        保存奖励配置
      </button>
      {status ? <p className="text-sm text-white/55">{status}</p> : null}
    </form>
  );
}

function ModelsPanel({ token, onExpired }: PanelProps) {
  const [models, setModels] = useState<CatalogModel[]>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const load = async () => {
    try {
      setModels(
        await authed<CatalogModel[]>(
          token,
          `/models?q=${encodeURIComponent(query)}&limit=200`,
        ),
      );
    } catch (error) {
      handlePanelError(error, setStatus, onExpired);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const syncModels = async () => {
    try {
      const result = await authed<{ count: number }>(
        token,
        "/openrouter/sync-models",
        { method: "POST", body: {} },
      );
      setStatus(`已同步 ${result.count} 个模型。`);
      await load();
    } catch (error) {
      handlePanelError(error, setStatus, onExpired);
    }
  };
  const syncEndpoints = async (modelId: string) => {
    try {
      const result = await authed<{ count: number }>(
        token,
        "/openrouter/sync-endpoints",
        { method: "POST", body: { modelId } },
      );
      setStatus(`${modelId} 已同步 ${result.count} 个服务商端点。`);
      await load();
    } catch (error) {
      handlePanelError(error, setStatus, onExpired);
    }
  };
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.025] p-5">
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void load();
        }}
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索模型"
          aria-label="搜索模型"
          className="min-w-60 flex-1 rounded-lg border border-white/10 bg-black/20 px-3 py-2"
        />
        <button
          type="submit"
          className="rounded-lg border border-white/10 px-4 py-2"
        >
          搜索
        </button>
        <button
          type="button"
          onClick={() => void syncModels()}
          className="rounded-lg bg-white px-4 py-2 font-medium text-black"
        >
          从 OpenRouter 同步
        </button>
      </form>
      {status ? <p className="mt-3 text-sm text-white/50">{status}</p> : null}
      <div className="mt-5 grid gap-3 md:grid-cols-2">
        {models.map((model) => (
          <article
            key={model.modelId}
            className="rounded-xl border border-white/8 bg-black/15 p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-medium text-white">{model.name}</h3>
                <p className="mt-1 break-all text-xs text-white/35">
                  {model.modelId}
                </p>
              </div>
              <button
                onClick={() => void syncEndpoints(model.modelId)}
                className="shrink-0 rounded-lg border border-white/10 px-3 py-1.5 text-xs"
              >
                获取服务商
              </button>
            </div>
            <p className="mt-3 text-xs text-white/50">
              {model.inputModalities.join(" + ")} →{" "}
              {model.outputModalities.join(" + ")}
            </p>
            <p className="mt-2 break-all font-mono text-[11px] text-white/35">
              {JSON.stringify(model.pricing)}
            </p>
            <p className="mt-2 text-[11px] text-white/35">
              参数：{model.supportedParameters.join(" · ") || "未声明"}
            </p>
            {model.providers.length ? (
              <div className="mt-3 space-y-1 text-xs text-emerald-100/55">
                {model.providers.map((provider) => (
                  <p key={provider.provider_slug}>
                    {provider.provider_name} ({provider.provider_slug}) ·{" "}
                    <span className="font-mono text-white/35">
                      {JSON.stringify(provider.pricing)}
                    </span>
                  </p>
                ))}
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}

function RecommendationsPanel({ token, onExpired }: PanelProps) {
  const [category, setCategory] =
    useState<ModelRecommendationCategory>("slice_text");
  const [items, setItems] = useState<
    Array<{ modelId: string; providerSlugs: string[] }>
  >([]);
  const [modelId, setModelId] = useState("");
  const [providers, setProviders] = useState("");
  const [candidateModels, setCandidateModels] = useState<CatalogModel[]>([]);
  const [candidatesOpen, setCandidatesOpen] = useState(false);
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [candidateError, setCandidateError] = useState("");
  const [providerCandidates, setProviderCandidates] = useState<
    CatalogModel["providers"]
  >([]);
  const [providersLoading, setProvidersLoading] = useState(false);
  const [multiplier, setMultiplier] = useState("1");
  const [status, setStatus] = useState("");
  const load = async () => {
    try {
      const [recommended, settings] = await Promise.all([
        authed<RecommendedModelView[]>(token, `/recommendations/${category}`),
        authed<{ billingMultiplier: number }>(token, "/settings"),
      ]);
      setItems(
        recommended.map((item) => ({
          modelId: item.modelId,
          providerSlugs: item.recommendedProviders.map(
            (provider) => provider.slug,
          ),
        })),
      );
      setMultiplier(String(settings.billingMultiplier));
    } catch (error) {
      handlePanelError(error, setStatus, onExpired);
    }
  };
  useEffect(() => {
    void load();
    void loadCandidates();
  }, [category]);
  const loadCandidates = async () => {
    if (category === "fish_tts") {
      setCandidateModels([]);
      setCandidateError("");
      return;
    }
    setCandidatesLoading(true);
    setCandidateError("");
    try {
      setCandidateModels(
        await authed<CatalogModel[]>(
          token,
          `/models?category=${encodeURIComponent(category)}&limit=500&includeProviders=false`,
        ),
      );
    } catch (error) {
      if ((error as { expired?: boolean })?.expired) onExpired();
      setCandidateError(messageOf(error));
    } finally {
      setCandidatesLoading(false);
    }
  };
  const getProviders = async () => {
    const id = modelId.trim();
    if (!id || category === "fish_tts") return;
    setProvidersLoading(true);
    setCandidateError("");
    try {
      const result = await authed<{
        count: number;
        providers: CatalogModel["providers"];
      }>(token, "/openrouter/sync-endpoints", {
        method: "POST",
        body: { modelId: id },
      });
      setProviderCandidates(result.providers);
      setStatus(`已获取 ${result.count} 个支持服务商。`);
    } catch (error) {
      handlePanelError(error, setStatus, onExpired);
    } finally {
      setProvidersLoading(false);
    }
  };
  const toggleProvider = (slug: string) => {
    const current = commaSeparatedValues(providers);
    setProviders(
      (current.includes(slug)
        ? current.filter((item) => item !== slug)
        : [...current, slug]
      ).join(", "),
    );
  };
  const addRecommendation = (event: FormEvent) => {
    event.preventDefault();
    const id = modelId.trim();
    if (!id) return;
    if (items.some((item) => item.modelId === id)) {
      setStatus(`${id} 已在当前推荐列表中。`);
      return;
    }
    setItems([
      ...items,
      { modelId: id, providerSlugs: commaSeparatedValues(providers) },
    ]);
    setModelId("");
    setProviders("");
    setProviderCandidates([]);
    setCandidatesOpen(false);
  };
  const save = async () => {
    try {
      await authed(token, `/recommendations/${category}`, {
        method: "PUT",
        body: {
          items: items.map((item) => ({
            ...item,
            service: category === "fish_tts" ? "fish_audio" : "openrouter",
          })),
        },
      });
      setStatus("推荐列表已保存。");
    } catch (error) {
      handlePanelError(error, setStatus, onExpired);
    }
  };
  const saveMultiplier = async () => {
    try {
      await authed(token, "/settings", {
        method: "PATCH",
        body: { billingMultiplier: Number(multiplier) },
      });
      setStatus("计费倍率已保存。");
    } catch (error) {
      handlePanelError(error, setStatus, onExpired);
    }
  };
  const visibleCandidateModels = filteredCandidateModels(
    candidateModels,
    modelId,
  );
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_.65fr]">
      <section className="rounded-2xl border border-white/10 bg-white/[0.025] p-5">
        <h2 className="text-xl font-semibold">推荐模型列表</h2>
        <select
          value={category}
          onChange={(e) => {
            setCategory(e.target.value as ModelRecommendationCategory);
            setModelId("");
            setProviders("");
            setProviderCandidates([]);
            setCandidatesOpen(false);
          }}
          className="mt-4 w-full rounded-lg border border-white/10 bg-[#15151a] px-3 py-2"
        >
          {categories.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
        <form className="mt-4 space-y-3" onSubmit={addRecommendation}>
          <label
            htmlFor="recommendation-model-id"
            className="block text-sm text-white/58"
          >
            模型 ID
          </label>
          <div className="relative">
            <input
              id="recommendation-model-id"
              value={modelId}
              onKeyDown={(event) => {
                if (event.key === "Escape") setCandidatesOpen(false);
              }}
              onChange={(e) => {
                setModelId(e.target.value);
                setProviderCandidates([]);
              }}
              placeholder="选择候选或自行输入模型 ID"
              autoComplete="off"
              aria-controls="recommendation-model-candidates"
              aria-expanded={candidatesOpen}
              className="w-full rounded-lg border border-white/10 bg-black/20 py-2.5 pl-3 pr-24 text-white outline-none focus:border-white/25"
            />
            {category !== "fish_tts" ? (
              <button
                type="button"
                onClick={() => setCandidatesOpen((open) => !open)}
                aria-controls="recommendation-model-candidates"
                aria-expanded={candidatesOpen}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md px-2.5 py-1.5 text-xs text-white/55 hover:bg-white/[0.06] hover:text-white/80"
              >
                {candidatesOpen ? "隐藏列表" : "显示列表"}
              </button>
            ) : null}
            {candidatesOpen && category !== "fish_tts" ? (
              <div
                id="recommendation-model-candidates"
                className="absolute inset-x-0 top-full z-20 mt-1 max-h-72 overflow-auto rounded-lg border border-white/10 bg-[#15151a] p-1 shadow-2xl shadow-black/45"
              >
                  {candidatesLoading ? (
                    <p className="px-3 py-2 text-xs text-white/40">
                      正在获取匹配当前分类的模型...
                    </p>
                  ) : visibleCandidateModels.length ? (
                    visibleCandidateModels.map((model) => (
                      <button
                        key={model.modelId}
                        type="button"
                        onClick={() => {
                          setModelId(model.modelId);
                          setProviders("");
                          setProviderCandidates([]);
                          setCandidatesOpen(false);
                        }}
                        className="block w-full rounded-md px-3 py-2 text-left hover:bg-white/[0.06] focus:bg-white/[0.06] focus:outline-none"
                      >
                        <span className="block text-sm text-white/85">
                          {model.name}
                        </span>
                        <span className="mt-0.5 block break-all font-mono text-[11px] text-white/40">
                          {model.modelId}
                        </span>
                        <span className="mt-1 block text-[11px] text-emerald-100/50">
                          {modelCapabilityLabel(model)}
                        </span>
                      </button>
                    ))
                  ) : (
                    <p className="px-3 py-2 text-xs text-white/40">
                      没有匹配候选，仍可直接使用手填 ID。
                    </p>
                  )}
                </div>
              ) : null}
          </div>
          {candidateError ? (
            <p className="text-xs text-red-200/70">{candidateError}</p>
          ) : null}
          <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
            <label className="block text-sm text-white/58">
              推荐服务商
              <input
                value={providers}
                onFocus={() => setCandidatesOpen(false)}
                onChange={(e) => setProviders(e.target.value)}
                placeholder="服务商 slug，逗号分隔，也可点击下方候选"
                className="mt-1.5 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2.5 text-white outline-none focus:border-white/25"
              />
            </label>
            {category !== "fish_tts" ? (
              <button
                type="button"
                disabled={!modelId.trim() || providersLoading}
                onClick={() => {
                  setCandidatesOpen(false);
                  void getProviders();
                }}
                className="self-end rounded-lg border border-white/10 px-4 py-2.5 text-sm text-white/75 disabled:cursor-not-allowed disabled:opacity-35"
              >
                {providersLoading ? "获取中..." : "获取支持服务商"}
              </button>
            ) : null}
          </div>
          {providerCandidates.length ? (
            <div className="flex flex-wrap gap-2" aria-label="支持服务商候选">
              {providerCandidates.map((provider) => {
                const selected = commaSeparatedValues(providers).includes(
                  provider.provider_slug,
                );
                return (
                  <button
                    key={provider.provider_slug}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => toggleProvider(provider.provider_slug)}
                    className={`rounded-lg border px-3 py-1.5 text-left text-xs ${
                      selected
                        ? "border-emerald-200/25 bg-emerald-200/10 text-emerald-50/80"
                        : "border-white/10 bg-white/[0.025] text-white/55"
                    }`}
                  >
                    {provider.provider_name}
                    <span className="ml-1 font-mono text-[10px] opacity-60">
                      {provider.provider_slug}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}
          <button
            type="submit"
            className="rounded-lg bg-white px-4 py-2.5 text-sm font-medium text-black"
          >
            添加推荐模型
          </button>
        </form>
        <div className="mt-4 space-y-2">
          {items.map((item, index) => (
            <div
              key={`${item.modelId}-${index}`}
              className="flex items-center justify-between rounded-lg bg-black/20 p-3 text-sm"
            >
              <span>
                <strong className="block">{item.modelId}</strong>
                <small className="text-white/35">
                  {item.providerSlugs.join(", ") || "OpenRouter 自动路由"}
                </small>
              </span>
              <button
                onClick={() => setItems(items.filter((_, i) => i !== index))}
                className="text-red-200/60"
              >
                移除
              </button>
            </div>
          ))}
        </div>
        <button
          onClick={() => void save()}
          className="mt-5 rounded-lg bg-white px-5 py-2 font-medium text-black"
        >
          保存推荐列表
        </button>
      </section>
      <section className="h-fit rounded-2xl border border-white/10 bg-white/[0.025] p-5">
        <h2 className="text-xl font-semibold">平台计费</h2>
        <p className="mt-2 text-sm leading-6 text-white/40">
          用户扣费 = 上游实际美元成本 × 统一倍率。默认 1.0。
        </p>
        <input
          type="number"
          min="0.000001"
          max="100"
          step="0.01"
          value={multiplier}
          onChange={(e) => setMultiplier(e.target.value)}
          className="mt-4 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2"
        />
        <button
          onClick={() => void saveMultiplier()}
          className="mt-3 rounded-lg bg-white px-4 py-2 text-sm font-medium text-black"
        >
          保存倍率
        </button>
        {status ? <p className="mt-4 text-sm text-white/50">{status}</p> : null}
      </section>
    </div>
  );
}

type PanelProps = { token: string; onExpired: () => void };

async function authed<T = unknown>(
  token: string,
  path: string,
  options: { method?: string; body?: unknown } = {},
) {
  try {
    return await adminRequest<T>(path, { ...options, token });
  } catch (error) {
    if (error instanceof Error && error.message === "管理员登录已失效。")
      (error as Error & { expired?: boolean }).expired = true;
    throw error;
  }
}

async function adminRequest<T>(
  path: string,
  options: { method?: string; body?: unknown; token?: string },
) {
  const base = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787/api";
  const client = new ApiClient({
    baseUrl: `${base.replace(/\/+$/, "")}/admin`,
    getAccessToken: async () => options.token ?? null,
  });
  if (options.method === "POST") return client.post<T>(path, options.body);
  if (options.method === "PUT") return client.put<T>(path, options.body);
  if (options.method === "PATCH") return client.patch<T>(path, options.body);
  if (options.method === "DELETE") return client.delete<T>(path, options.body);
  return client.get<T>(path);
}

function handlePanelError(
  error: unknown,
  setStatus: (value: string) => void,
  onExpired: () => void,
) {
  if ((error as { expired?: boolean })?.expired) onExpired();
  setStatus(messageOf(error));
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : "操作失败。";
}

function commaSeparatedValues(value: string) {
  return Array.from(
    new Set(
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

function filteredCandidateModels(models: CatalogModel[], query: string) {
  const normalized = query.trim().toLocaleLowerCase();
  return models
    .filter(
      (model) =>
        !normalized ||
        model.modelId.toLocaleLowerCase().includes(normalized) ||
        model.name.toLocaleLowerCase().includes(normalized),
    )
    .slice(0, 20);
}

function modelCapabilityLabel(model: CatalogModel) {
  const capabilities = [
    `${model.inputModalities.join("+")} → ${model.outputModalities.join("+")}`,
  ];
  if (model.supportedParameters.includes("tools")) capabilities.push("工具调用");
  if (
    model.supportedParameters.includes("structured_outputs") ||
    model.supportedParameters.includes("response_format")
  )
    capabilities.push("JSON 输出");
  return capabilities.join(" · ");
}
