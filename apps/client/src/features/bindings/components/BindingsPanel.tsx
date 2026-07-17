import { ArrowLeft, LockKey } from "@phosphor-icons/react";

export function BindingsPanel({ onBack }: { onBack: () => void }) {
  return (
    <section className="h-full min-h-0 overflow-y-auto rounded-2xl border border-white/8 bg-[#0d0d10]/80 p-6 md:p-8">
      <div className="flex items-start gap-3">
        <button
          aria-label="返回"
          className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-lg text-white/48 transition hover:bg-white/[0.06] hover:text-white"
          type="button"
          onClick={onBack}
        >
          <ArrowLeft size={19} />
        </button>
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-white/38">
            绑定
          </p>
          <h1 className="mt-2 text-4xl font-semibold text-white">角色接口</h1>
          <div className="mt-8 max-w-2xl rounded-2xl border border-white/8 bg-white/[0.025] p-6">
            <LockKey size={24} className="text-white/52" weight="duotone" />
            <h2 className="mt-4 text-lg font-medium text-white">运行时尚未启用</h2>
            <p className="mt-2 text-sm leading-6 text-white/48">
              Telegram、微信与 QQ 目前只保留领域契约，不提供绑定数据、演示账号或可调用通道路由。
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
