import { CheckCircle, LinkSimple, Robot, WarningCircle } from "@phosphor-icons/react";

const bindings = [
  {
    name: "接口 01",
    agent: "Aster",
    description: "已绑定至 Aster 的角色会话，收到的文本会被视为该会话中的消息。",
    status: "active"
  },
  {
    name: "接口 02",
    agent: "未绑定",
    description: "可以绑定一个角色会话。每个接口只能拥有一个绑定。",
    status: "empty"
  },
  {
    name: "接口 03",
    agent: "未绑定",
    description: "服务商详情保留在服务端连接层，不会显示在聊天中。",
    status: "empty"
  }
];

export function BindingsPanel() {
  return (
    <section className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-[0.22em] text-white/38">绑定</p>
        <h1 className="mt-2 text-4xl font-semibold text-white">角色接口</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-white/52">
          每个外部接口绑定一个角色会话。消息和模型回复会在网页端、Android、iOS、Windows 以及已绑定接口之间始终归属于同一角色会话。
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {bindings.map((binding) => {
          const active = binding.status === "active";
          return (
            <article key={binding.name} className="glass-panel rounded-2xl p-6 transition hover:border-white/18">
              <div className="flex items-center gap-4">
                <div className="grid h-12 w-12 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-white">
                  {active ? <Robot size={23} weight="duotone" /> : <LinkSimple size={23} weight="duotone" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-semibold text-white">{binding.name}</h2>
                    <span className="rounded-full border border-white/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.12em] text-white/42">
                      {active ? "已绑定" : "可绑定"}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-white/42">角色：{binding.agent}</p>
                </div>
                {active ? (
                  <CheckCircle size={22} className="text-white/60" weight="duotone" />
                ) : (
                  <WarningCircle size={22} className="text-white/38" weight="duotone" />
                )}
              </div>
              <p className="mt-5 text-sm leading-6 text-white/48">{binding.description}</p>
            </article>
          );
        })}
      </div>
    </section>
  );
}
