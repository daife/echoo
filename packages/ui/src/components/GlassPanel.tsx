import type { PropsWithChildren } from "react";

export function GlassPanel({ children }: PropsWithChildren) {
  return <div className="glass-panel rounded-2xl">{children}</div>;
}
