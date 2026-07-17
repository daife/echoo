import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { AuthProvider } from "./AuthProvider";
import { RuntimeProvider } from "./RuntimeProvider";
import { ServicesProvider } from "./ServicesProvider";

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
        <ServicesProvider>
          <AuthProvider>{children}</AuthProvider>
        </ServicesProvider>
      </RuntimeProvider>
    </QueryClientProvider>
  );
}
