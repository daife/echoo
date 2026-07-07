import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { RuntimeProvider } from "./RuntimeProvider";

const queryClient = new QueryClient();

export function AppProviders({ children }: PropsWithChildren) {
  return (
    <QueryClientProvider client={queryClient}>
      <RuntimeProvider>{children}</RuntimeProvider>
    </QueryClientProvider>
  );
}
