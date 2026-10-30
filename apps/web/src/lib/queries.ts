import {
  CaptureRes,
  CreateOrderRes,
  ImpactRes,
  NeedDetailRes,
  OrgListRes,
  OrgPageRes,
  paths,
  type AGENT_ACTION_STATUSES,
  type CreateOrderReq,
  type NeedStatus,
} from "@needgrid/shared";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { ApiClientError, apiGet, apiPost } from "./api";

type AgentActionStatus = (typeof AGENT_ACTION_STATUSES)[number];

/** Query keys (brief §7.5). Mutations and live updates invalidate or patch exactly these. */
export const queryKeys = {
  orgs: () => ["orgs"] as const,
  org: (slug: string) => ["org", slug] as const,
  need: (id: string) => ["need", id] as const,
  impact: (token: string) => ["impact", token] as const,
  staffNeeds: (status?: NeedStatus) => ["staffNeeds", status ?? null] as const,
  staffNeed: (id: string) => ["staffNeed", id] as const,
  actions: (status?: AgentActionStatus) => ["actions", status ?? null] as const,
  invoices: () => ["invoices"] as const,
};

export function useOrgs() {
  return useQuery({
    queryKey: queryKeys.orgs(),
    queryFn: ({ signal }) => apiGet(paths.orgs, OrgListRes, { signal }),
  });
}

export function useOrg(slug: string) {
  return useQuery({
    queryKey: queryKeys.org(slug),
    queryFn: ({ signal }) => apiGet(paths.org(slug), OrgPageRes, { signal }),
  });
}

export function useNeed(id: string) {
  return useQuery({
    queryKey: queryKeys.need(id),
    queryFn: ({ signal }) => apiGet(paths.need(id), NeedDetailRes, { signal }),
  });
}

export function useImpact(token: string) {
  return useQuery({
    queryKey: queryKeys.impact(token),
    queryFn: ({ signal }) => apiGet(paths.impact(token), ImpactRes, { signal }),
  });
}

// ---------- donations ----------

/** A donation changes holds and funding on one or more needs, and the org totals. */
function invalidateMoneyViews(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: ["need"] });
  void queryClient.invalidateQueries({ queryKey: ["org"] });
  void queryClient.invalidateQueries({ queryKey: queryKeys.orgs() });
}

/**
 * `POST /api/donations/orders`. The body carries a REQUESTED amount; the server decides the real
 * one (clamped to what's left) and holds it for HOLD_MINUTES. Never retried automatically.
 */
export function useCreateOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (req: CreateOrderReq) => apiPost(paths.createOrder, req, CreateOrderRes),
    onSuccess: () => invalidateMoneyViews(queryClient),
    onError: (error) => {
      // Someone else funded it first: the page should show what the server knows now.
      if (error instanceof ApiClientError && error.code === "FULLY_FUNDED") invalidateMoneyViews(queryClient);
    },
  });
}

/** Wait before the one retry of a capture after a network error (the API may be waking up). */
const CAPTURE_RETRY_DELAY_MS = 1_000;

const isNetworkError = (error: unknown) => error instanceof ApiClientError && error.code === "NETWORK";

/**
 * `POST /api/donations/orders/:orderId/capture`. The endpoint is idempotent (a repeat returns the
 * same donation), so a network failure is retried exactly once. Callers still guard against
 * starting a second capture for the same order.
 */
export function useCapture() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (orderId: string) => {
      try {
        return await apiPost(paths.captureOrder(orderId), {}, CaptureRes);
      } catch (error) {
        if (!isNetworkError(error)) throw error;
        await new Promise((resolve) => setTimeout(resolve, CAPTURE_RETRY_DELAY_MS));
        return apiPost(paths.captureOrder(orderId), {}, CaptureRes);
      }
    },
    onSuccess: () => invalidateMoneyViews(queryClient),
  });
}
