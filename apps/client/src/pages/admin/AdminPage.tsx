import type {
  AdminRuntimeDefaultsView,
  ModelRecommendationCategory,
  PrimeFigureRuntimeConfigPatch,
  RecommendedModelView,
  SliceFigureRuntimeConfigPatch,
  WalletView,
} from "@echoo/shared";
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
    "billing" | "models" | "recommendations" | "runtime-defaults"
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
  }, []);

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
      <div className="flex flex-wrap gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索模型"
          className="min-w-60 flex-1 rounded-lg border border-white/10 bg-black/20 px-3 py-2"
        />
        <button
          onClick={() => void load()}
          className="rounded-lg border border-white/10 px-4 py-2"
        >
          搜索
        </button>
        <button
          onClick={() => void syncModels()}
          className="rounded-lg bg-white px-4 py-2 font-medium text-black"
        >
          从 OpenRouter 同步
        </button>
      </div>
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
  }, [category]);
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
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_.65fr]">
      <section className="rounded-2xl border border-white/10 bg-white/[0.025] p-5">
        <h2 className="text-xl font-semibold">推荐模型列表</h2>
        <select
          value={category}
          onChange={(e) =>
            setCategory(e.target.value as ModelRecommendationCategory)
          }
          className="mt-4 w-full rounded-lg border border-white/10 bg-[#15151a] px-3 py-2"
        >
          {categories.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
        <div className="mt-4 flex gap-2">
          <input
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
            placeholder="模型 ID"
            className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/20 px-3 py-2"
          />
          <input
            value={providers}
            onChange={(e) => setProviders(e.target.value)}
            placeholder="推荐服务商 slug，逗号分隔"
            className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/20 px-3 py-2"
          />
          <button
            onClick={() => {
              if (!modelId.trim()) return;
              setItems([
                ...items,
                {
                  modelId: modelId.trim(),
                  providerSlugs: providers
                    .split(",")
                    .map((v) => v.trim())
                    .filter(Boolean),
                },
              ]);
              setModelId("");
              setProviders("");
            }}
            className="rounded-lg bg-white px-4 text-black"
          >
            添加
          </button>
        </div>
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
  const response = await fetch(`${base.replace(/\/+$/, "")}/admin${path}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.body !== undefined
        ? { "Content-Type": "application/json" }
        : {}),
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as {
      message?: string;
    };
    throw new Error(payload.message ?? `请求失败：${response.status}`);
  }
  return (await response.json()) as T;
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
