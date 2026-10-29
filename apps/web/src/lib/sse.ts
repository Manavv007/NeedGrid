/**
 * Live updates (brief §3, §7.2). `useOrgStream(slug)` listens to `GET /api/orgs/:slug/stream`
 * (event `need.updated`, data = one NeedCard) and patches the TanStack Query cache with the card
 * exactly as the server sent it:
 *
 * - `["org", slug]`: the need is replaced by id, added if new, removed if it became a draft. The
 *   org's stats are not touched here; the whole page is refetched at most once per 10 s instead.
 * - `["need", id]`: `need` is replaced when that page is cached.
 * - `["staffNeeds", …]`: invalidated (every status filter).
 *
 * There is one connection per slug (per query client), shared by every component that uses the hook
 * and closed when the last one unmounts. EventSource reconnects by itself after a network error
 * (the server asks for `retry: 3000`); this module only reports it. When the server answers with
 * anything but a stream (404 for an unknown charity, or another HTTP error) the browser gives up and
 * so do we: status `closed`.
 *
 * With VITE_USE_MOCKS=true the stream is the mock API's in-page feed (mocks/mockDb.ts) instead, so
 * mock live updates only reach screens in the same tab.
 */
import {
  NEED_UPDATED_EVENT,
  NeedCard,
  paths,
  type NeedDetailRes,
  type OrgPageRes,
  type StaffNeedListRes,
} from "@needgrid/shared";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { apiUrl } from "./api";
import { queryKeys } from "./queries";

/** `closed` (not in the brief's list): the server refused the stream, so live updates have stopped. */
export type StreamStatus = "connecting" | "live" | "reconnecting" | "closed";

/** One live change: the server's card and what this tab had cached for it before (null if nothing). */
export type NeedUpdate = { card: NeedCard; previous: NeedCard | null };

/** The org page (stats included) is refetched at most this often while updates arrive. */
export const ORG_REFRESH_MS = 10_000;

type Connection = {
  readonly queryClient: QueryClient;
  readonly slug: string;
  status: StreamStatus;
  users: number;
  readonly statusListeners: Set<() => void>;
  readonly updateListeners: Set<(update: NeedUpdate) => void>;
  stop: () => void;
  stopped: boolean;
  refreshTimer: ReturnType<typeof setTimeout> | null;
  /** The stream dropped since it last opened, so events may have been missed. */
  interrupted: boolean;
};

const connections = new WeakMap<QueryClient, Map<string, Connection>>();

function peek(queryClient: QueryClient, slug: string): Connection | null {
  return connections.get(queryClient)?.get(slug) ?? null;
}

function acquire(queryClient: QueryClient, slug: string): Connection {
  let bySlug = connections.get(queryClient);
  if (!bySlug) {
    bySlug = new Map();
    connections.set(queryClient, bySlug);
  }
  let conn = bySlug.get(slug);
  if (!conn) {
    conn = {
      queryClient,
      slug,
      status: "connecting",
      users: 0,
      statusListeners: new Set(),
      updateListeners: new Set(),
      stop: () => undefined,
      stopped: false,
      refreshTimer: null,
      interrupted: false,
    };
    bySlug.set(slug, conn);
    // Literal comparison: Vite replaces it at build time, so builds with mocks off drop the mock feed.
    conn.stop = import.meta.env.VITE_USE_MOCKS === "true" ? openMockFeed(conn) : openEventSource(conn);
  }
  conn.users += 1;
  return conn;
}

function release(conn: Connection): void {
  conn.users -= 1;
  // A route change unmounts one page and mounts the next in the same commit, and both usually want
  // this stream: close it a tick later, only if nobody picked it up again.
  queueMicrotask(() => {
    if (conn.users > 0 || conn.stopped) return;
    conn.stopped = true;
    const bySlug = connections.get(conn.queryClient);
    if (bySlug?.get(conn.slug) === conn) bySlug.delete(conn.slug);
    conn.stop();
    if (conn.refreshTimer !== null) clearTimeout(conn.refreshTimer);
    conn.refreshTimer = null;
  });
}

function setStatus(conn: Connection, status: StreamStatus): void {
  if (conn.status === status) return;
  conn.status = status;
  for (const notify of [...conn.statusListeners]) notify();
}

function openEventSource(conn: Connection): () => void {
  // No EventSource (very old browsers, jsdom): no live updates; pages still load and refresh normally.
  if (typeof EventSource === "undefined") return () => undefined;
  const source = new EventSource(apiUrl(paths.orgStream(conn.slug)));

  source.addEventListener("open", () => {
    if (conn.interrupted) catchUp(conn);
    conn.interrupted = false;
    setStatus(conn, "live");
  });
  source.addEventListener("error", () => {
    if (source.readyState === EventSource.CLOSED) {
      source.close();
      setStatus(conn, "closed");
      return;
    }
    // Still CONNECTING: the browser is already trying again.
    conn.interrupted = true;
    setStatus(conn, "reconnecting");
  });
  source.addEventListener(NEED_UPDATED_EVENT, (event) => {
    if (typeof event.data === "string") receive(conn, event.data);
  });
  return () => source.close();
}

function openMockFeed(conn: Connection): () => void {
  let stopped = false;
  let unsubscribe = () => undefined as void;
  void import("@/mocks/mockDb").then(({ mockDb }) => {
    if (stopped) return;
    unsubscribe = mockDb.subscribeNeedUpdates(conn.slug, (data) => receive(conn, data));
    setStatus(conn, "live");
  });
  return () => {
    stopped = true;
    unsubscribe();
  };
}

/** After a reconnect: anything could have changed while we weren't listening. */
function catchUp(conn: Connection): void {
  void conn.queryClient.invalidateQueries({ queryKey: queryKeys.org(conn.slug), exact: true });
  void conn.queryClient.invalidateQueries({ queryKey: ["need"] });
  void conn.queryClient.invalidateQueries({ queryKey: ["staffNeeds"] });
}

function receive(conn: Connection, data: string): void {
  const card = parseNeedCard(data, conn.slug);
  if (!card) return;
  const previous = cachedCard(conn.queryClient, conn.slug, card.id);
  patchCache(conn.queryClient, conn.slug, card);
  scheduleOrgRefresh(conn);
  for (const listener of [...conn.updateListeners]) {
    try {
      listener({ card, previous });
    } catch (error) {
      if (import.meta.env.DEV) console.error("[live] a need.updated listener failed", error);
    }
  }
}

/** A bad event is a contract bug to report, never a reason to break the page: log it (dev) and skip it. */
function parseNeedCard(data: string, slug: string): NeedCard | null {
  let json: unknown = null;
  try {
    json = JSON.parse(data);
  } catch {
    // Not JSON: the schema check below reports it.
  }
  const parsed = NeedCard.safeParse(json);
  if (parsed.success && parsed.data.orgSlug === slug) return parsed.data;
  if (import.meta.env.DEV) {
    console.error(
      `[live] ignored a ${NEED_UPDATED_EVENT} event on the ${slug} stream: it doesn't match the shared NeedCard schema`,
      parsed.success ? `orgSlug is "${parsed.data.orgSlug}"` : parsed.error.issues,
    );
  }
  return null;
}

/** What this tab knew about the need before the update (tile wall, need page, or staff list). */
function cachedCard(queryClient: QueryClient, slug: string, id: string): NeedCard | null {
  const fromOrg = queryClient.getQueryData<OrgPageRes>(queryKeys.org(slug))?.needs.find((need) => need.id === id);
  if (fromOrg) return fromOrg;
  const fromNeed = queryClient.getQueryData<NeedDetailRes>(queryKeys.need(id))?.need;
  if (fromNeed) return fromNeed;
  for (const [, list] of queryClient.getQueriesData<StaffNeedListRes>({ queryKey: ["staffNeeds"] })) {
    const fromStaff = list?.needs.find((need) => need.id === id);
    if (fromStaff) return fromStaff;
  }
  return null;
}

function patchCache(queryClient: QueryClient, slug: string, card: NeedCard): void {
  queryClient.setQueryData<OrgPageRes>(queryKeys.org(slug), (page) => (page ? withCard(page, card) : undefined));
  if (card.status !== "draft") {
    queryClient.setQueryData<NeedDetailRes>(queryKeys.need(card.id), (detail) =>
      detail ? { ...detail, need: card } : undefined,
    );
  }
  void queryClient.invalidateQueries({ queryKey: ["staffNeeds"] });
}

/** The org page with `card` in it; undefined (no change) when there is nothing to do. */
function withCard(page: OrgPageRes, card: NeedCard): OrgPageRes | undefined {
  const known = page.needs.some((need) => need.id === card.id);
  if (card.status === "draft") {
    return known ? { ...page, needs: page.needs.filter((need) => need.id !== card.id) } : undefined;
  }
  if (!known) return { ...page, needs: [...page.needs, card] };
  return { ...page, needs: page.needs.map((need) => (need.id === card.id ? card : need)) };
}

/** Stats (raised so far, counts) catch up with one refetch per window, however many events arrive. */
function scheduleOrgRefresh(conn: Connection): void {
  if (conn.refreshTimer !== null) return;
  conn.refreshTimer = setTimeout(() => {
    conn.refreshTimer = null;
    void conn.queryClient.invalidateQueries({ queryKey: queryKeys.org(conn.slug), exact: true });
  }, ORG_REFRESH_MS);
}

/**
 * Keeps this page's cache live for one charity and returns the connection status. `onUpdate` runs
 * once per update, after the cache was patched. Pass `null` while the slug isn't known.
 */
export function useOrgStream(slug: string | null, onUpdate?: (update: NeedUpdate) => void): StreamStatus {
  const queryClient = useQueryClient();
  const onUpdateRef = useRef(onUpdate);
  useLayoutEffect(() => {
    onUpdateRef.current = onUpdate;
  });

  const subscribe = useCallback(
    (notify: () => void) => {
      if (!slug) return () => undefined;
      const conn = acquire(queryClient, slug);
      const listener = (update: NeedUpdate) => onUpdateRef.current?.(update);
      conn.statusListeners.add(notify);
      conn.updateListeners.add(listener);
      return () => {
        conn.statusListeners.delete(notify);
        conn.updateListeners.delete(listener);
        release(conn);
      };
    },
    [queryClient, slug],
  );
  const status = (): StreamStatus => (slug ? peek(queryClient, slug)?.status : undefined) ?? "connecting";
  return useSyncExternalStore(subscribe, status, status);
}
