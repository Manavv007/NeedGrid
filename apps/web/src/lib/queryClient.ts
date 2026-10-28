import { QueryClient } from "@tanstack/react-query";
import { ApiClientError } from "./api";

/** Client errors (4xx) won't change on retry; anything else gets one more try on top of apiGet's own. */
function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiClientError && error.status >= 400 && error.status < 500) return false;
  return failureCount < 1;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000, // public data: 30 s
        retry: shouldRetry,
      },
    },
  });
}
