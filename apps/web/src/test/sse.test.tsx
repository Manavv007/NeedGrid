import {
  NEED_UPDATED_EVENT,
  type NeedCard,
  type NeedDetailRes,
  type OrgPageRes,
  type StaffNeedListRes,
} from "@needgrid/shared";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { act, render, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/lib/queries";
import { ORG_REFRESH_MS, useOrgStream, type NeedUpdate } from "@/lib/sse";
import { mockDb } from "@/mocks/mockDb";
import { fixtureCard, installFakeEventSource, onlyStream, sendNeedUpdate, FakeEventSource } from "./fakeEventSource";
import { createTestQueryClient } from "./render";

const SLUG = "harbor-food-bank";
const DIAPERS = "4c1f7a2e-9b3d-4e5f-8a6b-000000000101"; // $70 of $84, 6 donors
const NEW_NEED = "4c1f7a2e-9b3d-4e5f-8a6b-000000000999";

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

  it("stops for good when the server refuses the stream (unknown charity)", () => {
    const { result } = renderStream(loadedClient());
    act(() => onlyStream().fail({ permanent: true }));
    expect(result.current).toBe("closed");
    expect(onlyStream().closed).toBe(true);
    expect(FakeEventSource.instances).toHaveLength(1);
  });
});
