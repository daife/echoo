import { ArrowRight, Key, LockKey, SealCheck, Sparkle, UserCircle } from "@phosphor-icons/react";
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
    verificationToken ? "Verification link detected. Confirm your account to continue." : resetToken ? "Reset link detected. Choose a new password." : null
  );
  const [devResetToken, setDevResetToken] = useState<string | null>(null);
  const [devVerificationToken, setDevVerificationToken] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const copy = useMemo(() => {
    if (auth.authMode === "register") {
      return {
        eyebrow: "Create access",
        title: "Start your Echoo space.",
        detail: "Create the account first, then verify your email before your private runtime can open.",
        action: "Create account"
      };
    }
    if (auth.authMode === "verify") {
      return {
        eyebrow: "Email check",
        title: "Verify your account.",
        detail: "Email verification activates sign-in and protects private conversations from unconfirmed addresses.",
        action: "Verify email"
      };
    }
    if (auth.authMode === "forgot") {
      return {
        eyebrow: "Recovery",
        title: "Find your way back in.",
        detail: "We will send a password reset link to the email on your Echoo account.",
        action: "Send reset link"
      };
    }
    if (auth.authMode === "reset") {
      return {
        eyebrow: "New password",
        title: "Set a fresh key.",
        detail: "Pick a new password and your old reset link will be retired.",
        action: "Reset password"
      };
    }
    return {
      eyebrow: "Protected runtime",
      title: "Sign in to continue.",
      detail: "This surface touches private conversations, external bindings, or account settings.",
      action: "Enter Echoo"
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
        const response = await auth.register({ email, password, displayName: displayName || undefined });
        setDevVerificationToken(response.verificationToken ?? null);
        setPassword("");
        auth.setAuthMode("login");
        setNotice("Account created. Verify your email before signing in.");
      } else if (auth.authMode === "forgot") {
        const response = await auth.forgotPassword({ email });
        setDevResetToken(response.resetToken ?? null);
        setNotice("If that email exists, a reset link is on its way.");
      } else if (auth.authMode === "reset") {
        await auth.resetPassword({ token: resetToken || devResetToken || "", password });
        setPassword("");
        setNotice("Password reset complete. You can sign in now.");
      } else if (auth.authMode === "verify") {
        await auth.verifyEmail({ token: verificationToken || devVerificationToken || "" });
        setNotice("Email verified. You can sign in now.");
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
              <p className="mt-8 text-xs uppercase tracking-[0.24em] text-white/38">{copy.eyebrow}</p>
              <h1 className="mt-4 max-w-md text-5xl font-semibold leading-tight text-white">{copy.title}</h1>
              <p className="mt-5 max-w-md text-base leading-7 text-white/52">{copy.detail}</p>
            </div>
            <div className="grid gap-3">
              {["Private message sync", "External interface bindings", "Native realtime keepalive"].map((item) => (
                <div key={item} className="flex items-center gap-3 text-sm text-white/60">
                  <SealCheck size={18} weight="duotone" className="text-white" />
                  {item}
                </div>
              ))}
            </div>
          </div>
        </div>

        <form className="space-y-5 p-6 md:p-8" onSubmit={onSubmit}>
          <div>
            <p className="text-xs uppercase tracking-[0.22em] text-white/38">{copy.eyebrow}</p>
            <h2 className="mt-2 text-3xl font-semibold text-white">{copy.action}</h2>
          </div>

          {auth.authMode === "register" ? (
            <label className="block">
              <span className="mb-2 block text-sm text-white/55">Display name</span>
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
              <span className="mb-2 block text-sm text-white/55">Email</span>
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
              <span className="mb-2 block text-sm text-white/55">Password</span>
              <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4">
                <LockKey size={18} className="text-white/35" />
                <input
                  className="h-12 min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/30"
                  placeholder={auth.authMode === "reset" ? "New password" : "At least 8 characters"}
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
                    setNotice("Development verification token loaded. Confirm your account.");
                  }}
                >
                  Use local verification link
                </button>
              ) : null}
              {devResetToken ? (
                <button
                  className="ml-2 text-white underline decoration-white/30 underline-offset-4"
                  type="button"
                  onClick={() => {
                    auth.setAuthMode("reset");
                    setNotice("Development reset token loaded. Choose a new password.");
                  }}
                >
                  Use local reset link
                </button>
              ) : null}
            </div>
          ) : null}

          <button
            className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-white px-5 text-sm font-semibold text-[#09090b] transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-55"
            disabled={isSubmitting}
          >
            {isSubmitting ? "Working..." : copy.action}
            <ArrowRight size={17} weight="bold" />
          </button>

          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-sm text-white/45">
            {auth.authMode !== "login" ? (
              <button type="button" className="hover:text-white" onClick={() => auth.setAuthMode("login")}>
                Sign in
              </button>
            ) : null}
            {auth.authMode !== "register" ? (
              <button type="button" className="hover:text-white" onClick={() => auth.setAuthMode("register")}>
                Create account
              </button>
            ) : null}
            {auth.authMode !== "forgot" ? (
              <button type="button" className="hover:text-white" onClick={() => auth.setAuthMode("forgot")}>
                Forgot password
              </button>
            ) : null}
          </div>
        </form>
      </div>
    </section>
  );
}
