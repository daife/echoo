export function LoginPage() {
  return (
    <section className="mx-auto grid min-h-[100dvh] max-w-md place-items-center px-5">
      <form className="glass-panel w-full rounded-2xl p-6">
        <h1 className="text-3xl font-semibold text-white">登录 Echoo</h1>
        <p className="mt-2 text-sm text-white/45">
          身份验证运行时的账户界面占位页。
        </p>
        <input
          className="mt-6 w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-white outline-none"
          placeholder="邮箱"
        />
        <button className="mt-4 w-full rounded-full bg-white px-5 py-3 text-sm font-medium text-[#09090b] active:scale-95">
          Continue
        </button>
      </form>
    </section>
  );
}
