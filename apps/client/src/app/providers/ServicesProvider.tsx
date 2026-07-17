import type { PropsWithChildren } from "react";
import { createContext, useContext, useMemo } from "react";
import { initApp, type AppServices } from "../bootstrap/initApp";
import { useRuntime } from "./RuntimeProvider";

const ServicesContext = createContext<AppServices | null>(null);

export function ServicesProvider({ children }: PropsWithChildren) {
  const runtime = useRuntime();
  const services = useMemo(() => initApp(runtime), [runtime]);
  return (
    <ServicesContext.Provider value={services}>
      {children}
    </ServicesContext.Provider>
  );
}

export function useServices() {
  const services = useContext(ServicesContext);
  if (!services) throw new Error("ServicesProvider is missing");
  return services;
}

export function useOptionalServices() {
  return useContext(ServicesContext);
}
