import {
  NEED_UPDATED_EVENT,
  type NeedCard,
  type NeedDetailRes,
  type OrgPageRes,
  type StaffNeedListRes,
} from "@needgrid/shared";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { act, render, renderHook } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/lib/queries";
import { ORG_REFRESH_MS, STREAM_RETRY_DELAYS_MS, useOrgStream, type NeedUpdate } from "@/lib/sse";
import { DEMO_NEEDS } from "@/mocks/fixtures";
import { mockDb } from "@/mocks/mockDb";
import { server } from "@/mocks/node";
import { fixtureCard, installFakeEventSource, onlyStream, sendNeedUpdate, FakeEventSource } from "./fakeEventSource";
import { createTestQueryClient } from "./render";

const SLUG = "harbor-food-bank";
const DIAPERS = DEMO_NEEDS.fourteenLeft; // $70 of $84, 6 donors
const NEW_NEED = "4c1f7a2e-9b3d-4e5f-8a6b-000000000999";
/** MSW pattern for GET /api/orgs/:slug (paths.org would URL-encode the ":"). */
const ORG_ROUTE = "http://api.test/api/orgs/:slug";

beforeEach(() => {
  installFakeEventSource();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** A client with Harbor's tile wall, the diapers page and the staff list already loaded. */
function loadedClient(): QueryClient {
  const queryClient = createTestQueryClient();
  queryClient.setQueryData(queryKeys.org(SLUG), mockDb.getOrgPage(SLUG));
  queryClient.setQueryData(queryKeys.need(DIAPERS), mockDb.getNeedDetail(DIAPERS));
  const staffList: StaffNeedListRes = { needs: mockDb.getOrgPage(SLUG)?.needs ?? [] };
  queryClient.setQueryData(queryKeys.staffNeeds(), staffList);
  return queryClient;
}

function renderStream(queryClient: QueryClient, onUpdate?: (update: NeedUpdate) => void) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(() => useOrgStream(SLUG, onUpdate), { wrapper });
}

const orgPage = (queryClient: QueryClient) => queryClient.getQueryData<OrgPageRes>(queryKeys.org(SLUG));
const orgNeed = (queryClient: QueryClient, id: string) => orgPage(queryClient)?.needs.find((need) => need.id === id);

const diapers = (changes: Partial<NeedCard> = {}): NeedCard => ({ ...fixtureCard(SLUG, DIAPERS), ...changes });

describe("useOrgStream", () => {
  it("opens the org's stream on the API and reports live once it's open", () => {
    const { result } = renderStream(loadedClient());
    expect(onlyStream().url).toBe("http://api.test/api/orgs/harbor-food-bank/stream");
    expect(result.current).toBe("connecting");
    act(() => onlyStream().open());
    expect(result.current).toBe("live");
  });

  it("replaces the need on the tile wall and the need page with the card as sent, and invalidates staff lists", () => {
    const queryClient = loadedClient();
    const statsBefore = orgPage(queryClient)?.stats;
    const onUpdate = vi.fn();
    renderStream(queryClient, onUpdate);

    const card = diapers({ fundedCents: 8000, remainingCents: 400, donorCount: 7 });
    sendNeedUpdate(card);

    expect(orgNeed(queryClient, DIAPERS)).toEqual(card);
    expect(queryClient.getQueryData<NeedDetailRes>(queryKeys.need(DIAPERS))?.need).toEqual(card);
    // Stats are left to the debounced refetch; nothing is recomputed in the browser.
    expect(orgPage(queryClient)?.stats).toEqual(statsBefore);
    expect(queryClient.getQueryState(queryKeys.staffNeeds())?.isInvalidated).toBe(true);
    expect(onUpdate).toHaveBeenCalledWith({ card, previous: diapers() });
  });

  it("adds a new need that isn't a draft, and removes a need that became a draft", () => {
    const queryClient = loadedClient();
    const countBefore = orgPage(queryClient)?.needs.length ?? 0;
    renderStream(queryClient);

    sendNeedUpdate(diapers({ id: NEW_NEED, title: "Hand soap, 7.5 oz", status: "draft" }));
    expect(orgNeed(queryClient, NEW_NEED)).toBeUndefined();

    const published = diapers({ id: NEW_NEED, title: "Hand soap, 7.5 oz", fundedCents: 0, donorCount: 0 });
    sendNeedUpdate(published);
    expect(orgNeed(queryClient, NEW_NEED)).toEqual(published);
    expect(orgPage(queryClient)?.needs).toHaveLength(countBefore + 1);

    sendNeedUpdate(diapers({ status: "draft" }));
    expect(orgNeed(queryClient, DIAPERS)).toBeUndefined();
    expect(orgPage(queryClient)?.needs).toHaveLength(countBefore);
    // A draft is never put on the public need page.
    expect(queryClient.getQueryData<NeedDetailRes>(queryKeys.need(DIAPERS))?.need.status).toBe("open");
  });

  it("ignores malformed events (logged in dev) and keeps working", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const queryClient = loadedClient();
    const before = orgPage(queryClient);
    const onUpdate = vi.fn();
    renderStream(queryClient, onUpdate);
    const source = onlyStream();

    act(() => source.emit(NEED_UPDATED_EVENT, "not json"));
    act(() => source.emit(NEED_UPDATED_EVENT, JSON.stringify({ id: DIAPERS, fundedCents: "lots" })));
    act(() => source.emit(NEED_UPDATED_EVENT, JSON.stringify(diapers({ orgSlug: "second-chance-paws" }))));
    expect(orgPage(queryClient)).toBe(before);
    expect(onUpdate).not.toHaveBeenCalled();
    expect(errors).toHaveBeenCalledTimes(3);

    sendNeedUpdate(diapers({ fundedCents: 7500, remainingCents: 900 }));
    expect(orgNeed(queryClient, DIAPERS)?.fundedCents).toBe(7500);
    errors.mockRestore();
  });

  it("refetches the org page (stats) at most once per 10 s while updates keep coming", () => {
    vi.useFakeTimers();
    const queryClient = loadedClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const orgRefreshes = () =>
      invalidate.mock.calls.filter(([filters]) => JSON.stringify(filters?.queryKey) === JSON.stringify(["org", SLUG]))
        .length;
    renderStream(queryClient);

    sendNeedUpdate(diapers({ fundedCents: 7100 }));
    act(() => vi.advanceTimersByTime(4_000));
    sendNeedUpdate(diapers({ fundedCents: 7200 }));
    act(() => vi.advanceTimersByTime(4_000));
    sendNeedUpdate(diapers({ fundedCents: 7300 }));
    act(() => vi.advanceTimersByTime(ORG_REFRESH_MS - 8_000 - 1));
    expect(orgRefreshes()).toBe(0);
    act(() => vi.advanceTimersByTime(1));
    expect(orgRefreshes()).toBe(1);

    act(() => vi.advanceTimersByTime(ORG_REFRESH_MS * 3));
    expect(orgRefreshes()).toBe(1); // quiet stream: no more refetches
    sendNeedUpdate(diapers({ fundedCents: 7400 }));
    act(() => vi.advanceTimersByTime(ORG_REFRESH_MS));
    expect(orgRefreshes()).toBe(2);
  });

  it("shares one EventSource between components and closes it after the last one unmounts", async () => {
    const queryClient = loadedClient();
    function Listener() {
      useOrgStream(SLUG);
      return null;
    }
    const first = render(
      <QueryClientProvider client={queryClient}>
        <Listener />
        <Listener />
      </QueryClientProvider>,
    );
    const second = renderStream(queryClient);
    expect(FakeEventSource.instances).toHaveLength(1);
    const source = onlyStream();

    first.unmount();
    await Promise.resolve();
    expect(source.closed).toBe(false);

    second.unmount();
    await vi.waitFor(() => expect(source.closed).toBe(true));
  });

  it("shows reconnecting while the browser retries, and catches up when the stream is back", () => {
    const queryClient = loadedClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderStream(queryClient);
    act(() => onlyStream().open());

    act(() => onlyStream().fail());
    expect(result.current).toBe("reconnecting");
    act(() => onlyStream().open());
    expect(result.current).toBe("live");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["org", SLUG], exact: true });
    expect(FakeEventSource.instances).toHaveLength(1); // the browser reconnects, not us
  });
});

describe("useOrgStream when the browser gives up on the stream (a non-200, e.g. Render waking up)", () => {
  /** Only timers are fake; MSW answers the org check on real ticks. */
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });
  afterEach(() => {
    Reflect.deleteProperty(document, "visibilityState");
  });

  /** Counts the org checks (GET /api/orgs/:slug); `status` other than 200 answers with that error. */
  function orgChecks(status = 200): { count: () => number } {
    let count = 0;
    server.use(
      http.get(ORG_ROUTE, () => {
        count += 1;
        if (status === 200) return undefined; // the mock API answers with the org page
        const error =
          status === 404
            ? { code: "NOT_FOUND", message: "Organization not found" }
            : { code: "UPSTREAM", message: "Bad gateway" };
        return HttpResponse.json({ error }, { status });
      }),
    );
    return { count: () => count };
  }

  /** Lets the org check finish (a few real macrotasks; the fake timers don't move). */
  async function settle(): Promise<void> {
    await act(async () => {
      for (let i = 0; i < 20; i += 1) await new Promise<void>((resolve) => setImmediate(resolve));
    });
  }

  const latest = () => FakeEventSource.instances.at(-1) ?? onlyStream();

  function refuse(source: FakeEventSource = latest()) {
    act(() => source.fail({ permanent: true }));
  }

  async function advance(ms: number) {
    await act(() => vi.advanceTimersByTimeAsync(ms));
  }

  function setVisibility(state: DocumentVisibilityState) {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
  }

  it("checks the charity, then opens a new stream after 5 s, 15 s, 30 s, 60 s and every 60 s after that", async () => {
    const checks = orgChecks();
    const { result } = renderStream(loadedClient());
    refuse();
    expect(result.current).toBe("reconnecting");
    expect(onlyStream().closed).toBe(true);
    await settle();
    expect(checks.count()).toBe(1);

    for (const [i, delay] of [5_000, 15_000, 30_000, 60_000, 60_000, 60_000].entries()) {
      expect(STREAM_RETRY_DELAYS_MS[Math.min(i, STREAM_RETRY_DELAYS_MS.length - 1)]).toBe(delay);
      await advance(delay - 1);
      expect(FakeEventSource.instances).toHaveLength(i + 1);
      await advance(1);
      expect(FakeEventSource.instances).toHaveLength(i + 2);
      expect(latest().url).toBe("http://api.test/api/orgs/harbor-food-bank/stream");
      expect(result.current).toBe("reconnecting"); // the pill stays up meanwhile
      refuse();
      await settle();
      expect(checks.count()).toBe(i + 2);
    }
  });

  it("catches up once a new stream opens, and starts the delays over after the next refusal", async () => {
    orgChecks();
    const queryClient = loadedClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderStream(queryClient);
    refuse();
    await settle();
    await advance(5_000);
    refuse();
    await settle();
    await advance(15_000);
    expect(FakeEventSource.instances).toHaveLength(3);

    act(() => latest().open());
    expect(result.current).toBe("live");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["org", SLUG], exact: true });

    refuse();
    await settle();
    await advance(5_000);
    expect(FakeEventSource.instances).toHaveLength(4);
  });

  it("stops for good when the charity doesn't exist (404)", async () => {
    const checks = orgChecks(404);
    const { result } = renderStream(loadedClient());
    refuse();
    await settle();
    expect(checks.count()).toBe(1);
    expect(result.current).toBe("closed");
    await advance(10 * 60_000);
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it("keeps trying when the check itself fails (the API is still waking up)", async () => {
    const checks = orgChecks(502);
    const { result } = renderStream(loadedClient());
    refuse();
    await settle();
    expect(checks.count()).toBe(1);
    expect(result.current).toBe("reconnecting");
    await advance(5_000);
    expect(FakeEventSource.instances).toHaveLength(2);
  });

  it("cancels the pending retry when the last user unmounts", async () => {
    orgChecks();
    const { unmount } = renderStream(loadedClient());
    refuse();
    await settle();

    unmount();
    await act(() => Promise.resolve()); // the stream is released a microtask later
    await advance(10 * 60_000);
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it("pauses the retry while the tab is hidden and resumes it when the tab is visible", async () => {
    const checks = orgChecks();
    renderStream(loadedClient());
    refuse();
    await settle();

    setVisibility("hidden");
    await advance(10 * 60_000);
    expect(FakeEventSource.instances).toHaveLength(1);

    setVisibility("visible");
    await settle();
    expect(checks.count()).toBe(2);
    await advance(5_000); // the same step again: the cancelled retry never ran
    expect(FakeEventSource.instances).toHaveLength(2);
  });

  it("keeps one stream and one retry timer per charity, however many components or errors", async () => {
    const checks = orgChecks();
    const queryClient = loadedClient();
    function Listener() {
      useOrgStream(SLUG);
      return null;
    }
    render(
      <QueryClientProvider client={queryClient}>
        <Listener />
        <Listener />
      </QueryClientProvider>,
    );
    renderStream(queryClient);
    const first = onlyStream();
    refuse(first);
    refuse(first); // the same refusal reported twice
    await settle();
    expect(checks.count()).toBe(1);

    // One timer: a second one would have opened a third stream by now.
    await advance(5_000);
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(FakeEventSource.instances.filter((source) => !source.closed)).toHaveLength(1);
  });
});
