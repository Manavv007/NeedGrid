import {
  ApprovePurchaseRes,
  CaptureRes,
  CreateOrderRes,
  ImpactRes,
  IntakeReq,
  IntakeRes,
  MarkOrderedReq,
  NeedDetailRes,
  NeedRes,
  OrgListRes,
  OrgPageRes,
  paths,
  PurchasePlanRes,
  PurchaseRes,
  StaffMeRes,
  StaffNeedDetailRes,
  StaffNeedListRes,
  type AGENT_ACTION_STATUSES,
  type CreateOrderReq,
  type NeedCard,
  type NeedStatus,
  type PatchNeedReq,
  type PublishNeedReq,
} from "@needgrid/shared";
import { skipToken, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { ApiClientError, apiGet, apiPatch, apiPost } from "./api";
import { markOwnChange } from "./ownChanges";

type AgentActionStatus = (typeof AGENT_ACTION_STATUSES)[number];

/** Query keys (brief §7.5). Mutations and live updates invalidate or patch exactly these. */
export const queryKeys = {
  staffMe: () => ["staffMe"] as const,
  orgs: () => ["orgs"] as const,
  org: (slug: string) => ["org", slug] as const,
  need: (id: string) => ["need", id] as const,
  impact: (token: string) => ["impact", token] as const,
  staffNeeds: (status?: NeedStatus) => ["staffNeeds", status ?? null] as const,
  staffNeed: (id: string) => ["staffNeed", id] as const,
  /** The last purchase plan this tab checked for a need (filled by usePurchasePlan, never fetched). */
  purchasePlan: (needId: string) => ["purchasePlan", needId] as const,
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
    // The hold this creates comes back as a live update; this tab doesn't need it announced.
    onMutate: (req) => markOwnChange(req.needId),
    onSettled: (_data, _error, req) => markOwnChange(req.needId),
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

// ---------- staff ----------

const STAFF_QUERY_ROOTS = ["staffMe", "staffNeeds", "staffNeed", "purchasePlan", "actions", "invoices"] as const;

const isStaffQuery = (key: readonly unknown[]) => STAFF_QUERY_ROOTS.some((root) => root === key[0]);

/** Sign-out and sign-in: nothing one charity's staff loaded may show to the next person at this screen. */
export function clearStaffQueries(queryClient: QueryClient): void {
  void queryClient.cancelQueries({ predicate: (query) => isStaffQuery(query.queryKey) });
  queryClient.removeQueries({ predicate: (query) => isStaffQuery(query.queryKey) });
}

/** `GET /api/staff/me`: whose console this is. StaffGate calls it once; everything else reads the cache. */
export function useStaffMe() {
  return useQuery({
    queryKey: queryKeys.staffMe(),
    queryFn: ({ signal }) => apiGet(paths.staff.me, StaffMeRes, { staff: true, signal }),
  });
}

/** `GET /api/staff/needs?status=`: includes drafts. No status = every need of the charity. */
export function useStaffNeeds(status?: NeedStatus) {
  return useQuery({
    queryKey: queryKeys.staffNeeds(status),
    queryFn: ({ signal }) =>
      apiGet(status ? `${paths.staff.needs}?status=${status}` : paths.staff.needs, StaffNeedListRes, {
        staff: true,
        signal,
      }),
  });
}

export function useStaffNeed(id: string) {
  return useQuery({
    queryKey: queryKeys.staffNeed(id),
    queryFn: ({ signal }) => apiGet(paths.staff.need(id), StaffNeedDetailRes, { staff: true, signal }),
  });
}

/** A need changed: the staff lists, its detail pages and the public views of it are all out of date. */
function invalidateNeedViews(queryClient: QueryClient, need: NeedCard): void {
  void queryClient.invalidateQueries({ queryKey: ["staffNeeds"] });
  void queryClient.invalidateQueries({ queryKey: queryKeys.staffNeed(need.id) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.need(need.id) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.org(need.orgSlug) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.orgs() });
}

/**
 * `POST /api/staff/needs`. The server computes the target (unless staff override it) and the
 * status; the browser sends the chosen product and details only. Never retried automatically.
 */
export function usePublishNeed() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (req: PublishNeedReq) => apiPost(paths.staff.needs, req, NeedRes, { staff: true }),
    onSuccess: ({ need }) => {
      markOwnChange(need.id);
      invalidateNeedViews(queryClient, need);
    },
  });
}

/** `PATCH /api/staff/needs/:id` (publish a draft, edit, close). The server enforces every rule. */
export function usePatchNeed() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: PatchNeedReq }) =>
      apiPatch(paths.staff.need(id), patch, NeedRes, { staff: true }),
    // Staff hear live updates about other people's changes, not the edit they just made.
    onMutate: ({ id }) => markOwnChange(id),
    onSettled: (_data, _error, { id }) => markOwnChange(id),
    onSuccess: ({ need }) => invalidateNeedViews(queryClient, need),
  });
}

/**
 * `POST /api/staff/intake` (staff, 10 requests a minute). Photo or text in, draft needs out; nothing
 * is saved. Pass `signal` to cancel while the AI is working (10 to 30 s).
 */
export function useIntake() {
  return useMutation({
    mutationFn: ({ req, signal }: { req: IntakeReq; signal?: AbortSignal }) =>
      apiPost(paths.staff.intake, IntakeReq.parse(req), IntakeRes, { staff: true, signal }),
  });
}

// ---------- purchases ----------

/** The server refused because the need or purchase changed state: the page should show what it knows now. */
function refetchOnConflict(queryClient: QueryClient, error: unknown, needId: string): void {
  if (error instanceof ApiClientError && error.code === "INVALID_STATE") {
    void queryClient.invalidateQueries({ queryKey: queryKeys.staffNeed(needId) });
  }
}

/**
 * `POST /api/staff/needs/:id/purchase-plan` with `{}`: the server refreshes the price, picks the
 * offer and computes the money outcome (5 to 15 s). The response is kept per need, because only it
 * carries `priceChange`, `money` and the other offers; the stored purchase doesn't.
 */
export function usePurchasePlan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (needId: string) => apiPost(paths.staff.purchasePlan(needId), {}, PurchasePlanRes, { staff: true }),
    onSuccess: (plan, needId) => {
      queryClient.setQueryData(queryKeys.purchasePlan(needId), plan);
      void queryClient.invalidateQueries({ queryKey: queryKeys.staffNeed(needId) });
    },
    onError: (error, needId) => refetchOnConflict(queryClient, error, needId),
  });
}

/** The plan this tab last checked for `needId`, or null. Read from the cache only. */
export function useCheckedPurchasePlan(needId: string): PurchasePlanRes | null {
  const { data } = useQuery<PurchasePlanRes>({
    queryKey: queryKeys.purchasePlan(needId),
    queryFn: skipToken,
    staleTime: Infinity,
  });
  return data ?? null;
}

/**
 * `POST /api/staff/purchases/:id/approve` with `{}`. The server moves any surplus to the next need
 * or raises the target; the response says what happened. Never retried automatically.
 */
export function useApprovePurchase() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ purchaseId }: { purchaseId: string; needId: string }) =>
      apiPost(paths.staff.approvePurchase(purchaseId), {}, ApprovePurchaseRes, { staff: true }),
    onMutate: ({ needId }) => markOwnChange(needId),
    onSettled: (_data, _error, { needId }) => markOwnChange(needId),
    onSuccess: (res) => {
      invalidateNeedViews(queryClient, res.need);
      if (res.surplusMoved) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.need(res.surplusMoved.toNeedId) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.staffNeed(res.surplusMoved.toNeedId) });
      }
    },
    onError: (error, { needId }) => refetchOnConflict(queryClient, error, needId),
  });
}

/** `POST /api/staff/purchases/:id/ordered` with the retailer's order number. */
export function useMarkOrdered() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ purchaseId, orderRef }: { purchaseId: string; needId: string; orderRef: string }) =>
      apiPost(paths.staff.markOrdered(purchaseId), MarkOrderedReq.parse({ orderRef }), PurchaseRes, { staff: true }),
    onMutate: ({ needId }) => markOwnChange(needId),
    onSettled: (_data, _error, { needId }) => markOwnChange(needId),
    onSuccess: ({ need }) => invalidateNeedViews(queryClient, need),
    onError: (error, { needId }) => refetchOnConflict(queryClient, error, needId),
  });
}
