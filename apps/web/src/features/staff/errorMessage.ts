import { ApiClientError } from "@/lib/api";

/** The server's own words for a refused request (they're written for people), else a friendly fallback. */
export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiClientError && error.message !== "" ? error.message : fallback;
}
