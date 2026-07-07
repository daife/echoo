import type { PropsWithChildren } from "react";
import { createContext, useContext, useEffect, useState } from "react";
import { createRuntime } from "../../runtimes/factory/createRuntime";
import type { RuntimeBundle } from "../../runtimes/factory/RuntimeBundle";

const RuntimeContext = createContext<RuntimeBundle | null>(null);

export function RuntimeProvider({ children }: PropsWithChildren) {
  const [runtime, setRuntime] = useState<RuntimeBundle | null>(null);

  useEffect(() => {
    void createRuntime().then(setRuntime);
  }, []);

  if (!runtime) {
    return (
      <div className="grid min-h-[100dvh] place-items-center bg-[#09090b] text-white">
        <div className="glass-panel rounded-full px-5 py-3 text-sm text-white/70">Echoo is waking up</div>
      </div>
    );
  }

  return <RuntimeContext.Provider value={runtime}>{children}</RuntimeContext.Provider>;
}

export function useRuntime() {
  const runtime = useContext(RuntimeContext);
  if (!runtime) throw new Error("RuntimeProvider is missing");
  return runtime;
}
