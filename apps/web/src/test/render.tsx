import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { Toaster } from "@/components/ui/sonner";
import { registerUnauthorizedRedirect } from "@/lib/staffSession";
import { routes } from "@/router";

/** A fresh client per test: no retries, so error states show immediately. */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } });
}

/**
 * Renders the real route tree at `path` with the providers main.tsx sets up (toasts and the 401 →
 * login redirect included).
 */
export function renderRoute(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const queryClient = createTestQueryClient();
  registerUnauthorizedRedirect(router, queryClient);
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster />
    </QueryClientProvider>,
  );
  return { ...utils, router, queryClient };
}
