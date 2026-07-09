import { CheckCircle, LinkSimple, Robot, WarningCircle } from "@phosphor-icons/react";

const bindings = [
  {
    name: "Interface 01",
    agent: "Aster",
    description: "Bound to Aster's figure session. Incoming text is treated as that same session.",
    status: "active"
  },
  {
    name: "Interface 02",
    agent: "Unbound",
    description: "Ready to bind to one figure session. One interface can only own one binding.",
    status: "empty"
  },
  {
    name: "Interface 03",
    agent: "Unbound",
    description: "Provider details stay in the server connector layer and are not shown in chat.",
    status: "empty"
  }
];

export function BindingsPanel() {
  return (
    <section className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-[0.22em] text-white/38">Bindings</p>
        <h1 className="mt-2 text-4xl font-semibold text-white">Figure interfaces</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-white/52">
          Each external interface binds to one figure session. Messages and model replies stay attached to that figure session across
          Web, Android, iOS, Windows, and the bound interface.
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
                      {active ? "bound" : "open"}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-white/42">Figure: {binding.agent}</p>
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
