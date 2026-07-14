import {
  ArrowRight,
  Key,
  LockKey,
  SealCheck,
  Sparkle,
  UserCircle,
} from "@phosphor-icons/react";
import type { FormEvent } from "react";
import { useMemo, useState } from "react";
import { useAuth } from "../../app/providers/AuthProvider";

export function AuthPage({ onAuthenticated }: { onAuthenticated: () => void }) {
  const auth = useAuth();
  const resetToken = auth.authLinkParams.resetToken ?? "";
  const verificationToken = auth.authLinkParams.verificationToken ?? "";
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState<string | null>(
    verificationToken
      ? "检测到验证链接，请确认账户后继续。"
      : resetToken
        ? "检测到重置链接，请设置新密码。"
        : null,
  );
  const [devResetToken, setDevResetToken] = useState<string | null>(null);
  const [devVerificationToken, setDevVerificationToken] = useState<
    string | null
  >(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const copy = useMemo(() => {
    if (auth.authMode === "register") {
      return {
        eyebrow: "创建访问权限",
        title: "开启你的 Echoo 空间。",
        detail: "先创建账户并验证邮箱，之后即可开启你的私人运行空间。",
        action: "创建账户",
      };
    }
    if (auth.authMode === "verify") {
      return {
        eyebrow: "邮箱验证",
        title: "验证你的账户。",
        detail: "验证邮箱后即可登录，同时避免未确认的邮箱地址访问私人会话。",
        action: "验证邮箱",
      };
    }
    if (auth.authMode === "forgot") {
      return {
        eyebrow: "账户恢复",
        title: "重新进入你的空间。",
        detail: "我们会向 Echoo 账户绑定的邮箱发送密码重置链接。",
        action: "发送重置链接",
      };
    }
    if (auth.authMode === "reset") {
      return {
        eyebrow: "新密码",
        title: "设置一把新钥匙。",
        detail: "设置新密码后，旧的重置链接将立即失效。",
        action: "重置密码",
      };
    }
    return {
      eyebrow: "受保护空间",
      title: "登录后继续。",
      detail: "此页面涉及私人会话、外部绑定或账户设置。",
      action: "进入 Echoo",
    };
  }, [auth.authMode]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setNotice(null);
    setDevResetToken(null);
    setDevVerificationToken(null);

    try {
      if (auth.authMode === "register") {
        const response = await auth.register({
          email,
          password,
          displayName: displayName || undefined,
        });
        setDevVerificationToken(response.verificationToken ?? null);
        setPassword("");
        auth.setAuthMode("login");
        setNotice("账户已创建，请先验证邮箱再登录。");
      } else if (auth.authMode === "forgot") {
        const response = await auth.forgotPassword({ email });
        setDevResetToken(response.resetToken ?? null);
        setNotice("如果该邮箱已注册，重置链接正在发送。");
      } else if (auth.authMode === "reset") {
        await auth.resetPassword({
          token: resetToken || devResetToken || "",
          password,
        });
        setPassword("");
        setNotice("密码重置完成，现在可以登录。");
      } else if (auth.authMode === "verify") {
        await auth.verifyEmail({
          token: verificationToken || devVerificationToken || "",
        });
        setNotice("邮箱验证完成，现在可以登录。");
      } else {
        await auth.login({ email, password });
        onAuthenticated();
      }
    } catch {
      // AuthProvider owns the user-facing error state.
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="grid min-h-[calc(100dvh-8rem)] place-items-center">
      <div className="grid w-full max-w-5xl overflow-hidden rounded-3xl border border-white/8 bg-[#0d0d10]/80 md:grid-cols-[1fr_420px]">
        <div className="relative hidden min-h-[580px] overflow-hidden border-r border-white/8 p-10 md:block">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_18%,rgba(255,255,255,.12),transparent_18rem)]" />
          <div className="relative z-10 flex h-full flex-col justify-between">
            <div>
              <div className="grid h-12 w-12 place-items-center rounded-full border border-white/12 bg-white/[0.05]">
                <Sparkle size={22} weight="duotone" />
              </div>
              <p className="mt-8 text-xs uppercase tracking-[0.24em] text-white/38">
                {copy.eyebrow}
              </p>
              <h1 className="mt-4 max-w-md text-5xl font-semibold leading-tight text-white">
                {copy.title}
              </h1>
              <p className="mt-5 max-w-md text-base leading-7 text-white/52">
                {copy.detail}
              </p>
            </div>
            <div className="grid gap-3">
              {["私人消息同步", "外部界面绑定", "原生实时保活"].map((item) => (
                <div
                  key={item}
                  className="flex items-center gap-3 text-sm text-white/60"
                >
                  <SealCheck
                    size={18}
                    weight="duotone"
                    className="text-white"
                  />
                  {item}
                </div>
              ))}
            </div>
          </div>
        </div>

        <form className="space-y-5 p-6 md:p-8" onSubmit={onSubmit}>
          <div>
            <p className="text-xs uppercase tracking-[0.22em] text-white/38">
              {copy.eyebrow}
            </p>
            <h2 className="mt-2 text-3xl font-semibold text-white">
              {copy.action}
            </h2>
          </div>

          {auth.authMode === "register" ? (
            <label className="block">
              <span className="mb-2 block text-sm text-white/55">显示名称</span>
              <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4">
                <UserCircle size={18} className="text-white/35" />
                <input
                  className="h-12 min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/30"
                  placeholder="Aster"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                />
              </div>
            </label>
          ) : null}

          {auth.authMode !== "reset" && auth.authMode !== "verify" ? (
            <label className="block">
              <span className="mb-2 block text-sm text-white/55">邮箱</span>
              <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4">
                <Key size={18} className="text-white/35" />
                <input
                  className="h-12 min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/30"
                  placeholder="you@echoo.dev"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </div>
            </label>
          ) : null}

          {auth.authMode !== "forgot" && auth.authMode !== "verify" ? (
            <label className="block">
              <span className="mb-2 block text-sm text-white/55">密码</span>
              <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4">
                <LockKey size={18} className="text-white/35" />
                <input
                  className="h-12 min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/30"
                  placeholder={
                    auth.authMode === "reset" ? "新密码" : "至少 8 个字符"
                  }
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  minLength={auth.authMode === "login" ? undefined : 8}
                  required
                />
              </div>
            </label>
          ) : null}

          {auth.authError ? (
            <div className="rounded-2xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-100">
              {auth.authError}
            </div>
          ) : null}

          {notice ? (
            <div className="rounded-2xl border border-white/10 bg-white/[0.035] px-4 py-3 text-sm leading-6 text-white/62">
              {notice}
              {devVerificationToken ? (
                <button
                  className="ml-2 text-white underline decoration-white/30 underline-offset-4"
                  type="button"
                  onClick={() => {
                    auth.setAuthMode("verify");
                    setNotice("已加载开发环境验证令牌，请确认账户。");
                  }}
                >
                  使用本地验证链接
                </button>
              ) : null}
              {devResetToken ? (
                <button
                  className="ml-2 text-white underline decoration-white/30 underline-offset-4"
                  type="button"
                  onClick={() => {
                    auth.setAuthMode("reset");
                    setNotice("已加载开发环境重置令牌，请设置新密码。");
                  }}
                >
                  使用本地重置链接
                </button>
              ) : null}
            </div>
          ) : null}

          <button
            className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-white px-5 text-sm font-semibold text-[#09090b] transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-55"
            disabled={isSubmitting}
          >
            {isSubmitting ? "处理中……" : copy.action}
            <ArrowRight size={17} weight="bold" />
          </button>

          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-sm text-white/45">
            {auth.authMode !== "login" ? (
              <button
                type="button"
                className="hover:text-white"
                onClick={() => auth.setAuthMode("login")}
              >
                登录
              </button>
            ) : null}
            {auth.authMode !== "register" ? (
              <button
                type="button"
                className="hover:text-white"
                onClick={() => auth.setAuthMode("register")}
              >
                创建账户
              </button>
            ) : null}
            {auth.authMode !== "forgot" ? (
              <button
                type="button"
                className="hover:text-white"
                onClick={() => auth.setAuthMode("forgot")}
              >
                忘记密码
              </button>
            ) : null}
          </div>
        </form>
      </div>
    </section>
  );
}
