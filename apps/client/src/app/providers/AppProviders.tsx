import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { AuthProvider } from "./AuthProvider";
import { RuntimeProvider } from "./RuntimeProvider";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      gcTime: 30 * 60 * 1000,
    },
  },
});

export function AppProviders({ children }: PropsWithChildren) {
  return (
    <QueryClientProvider client={queryClient}>
      <RuntimeProvider>
        <AuthProvider>{children}</AuthProvider>
      </RuntimeProvider>
    </QueryClientProvider>
  );
}
