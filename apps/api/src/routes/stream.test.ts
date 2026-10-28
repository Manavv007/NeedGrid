/** GET /api/orgs/:slug/stream over a real socket (SSE can't be tested with inject). */
import { NeedCard } from "@needgrid/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { closeDb } from "../db/client";
import { FakePayPalOrders } from "../paypal/__fakes__";
import { realOrdersGateway, setOrdersGateway } from "../paypal/orders";
import { createTestDb, hasTestDb, migrateTestDb, truncateAll, type TestDb } from "../test/db";
import { seedNeed, seedOrg } from "../test/fixtures";

/** Incremental reader for one SSE response: `until(predicate)` reads until the text so far matches. */
function sseReader(res: Response) {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let text = "";
  return {
    async until(predicate: (text: string) => boolean, timeoutMs = 15_000): Promise<string> {
      const deadline = Date.now() + timeoutMs;
      while (!predicate(text)) {
        if (Date.now() > deadline) throw new Error(`SSE timeout; got: ${text}`);
        const { value, done } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
      }
      return text;
    },
  };
}

describe.skipIf(!hasTestDb)("live updates (SSE)", () => {
  let t: TestDb;
  let app: FastifyInstance;
  let base: string;
  let needId: string;

  beforeAll(async () => {
    t = createTestDb();
    await migrateTestDb(t);
    await truncateAll(t);
    const org = await seedOrg(t);
    needId = (await seedNeed(t, org.id, { title: "Diapers, size 4", targetCents: 3000 })).id;
    setOrdersGateway(new FakePayPalOrders());
    app = await buildApp({ logger: false, ssePingMs: 200 });
    base = await app.listen({ host: "127.0.0.1", port: 0 });
  });

  afterAll(async () => {
    setOrdersGateway(realOrdersGateway);
    await app?.close(); // also proves open streams don't block shutdown
    await t?.pool.end();
    await closeDb();
  });

  it("streams need.updated when a donor starts checkout, with CORS and heartbeats", async () => {
    const ctrl = new AbortController();
    const res = await fetch(`${base}/api/orgs/harbor-food-bank/stream`, {
      headers: { origin: "http://localhost:5173" },
      signal: ctrl.signal,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");

    const sse = sseReader(res);
    const opening = await sse.until((s) => s.includes(": ping"));
    expect(opening).toContain("retry: 3000");

    const donate = await fetch(`${base}/api/donations/orders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ needId, amountCents: 1000 }),
    });
    expect(donate.status).toBe(201);

    const text = await sse.until((s) => s.includes("event: need.updated"));
    const data = text.split("event: need.updated\ndata: ")[1]!.split("\n")[0]!;
    expect(NeedCard.parse(JSON.parse(data))).toMatchObject({ id: needId, heldCents: 1000, remainingCents: 2000 });
    ctrl.abort();
  });

  it("unknown charity → 404 JSON, not a stream", async () => {
    const res = await fetch(`${base}/api/orgs/nope/stream`);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
  });

  it("other charities' updates are not sent", async () => {
    const ctrl = new AbortController();
    const other = await seedOrg(t, "second-chance-paws", "paws-demo-2026");
    const res = await fetch(`${base}/api/orgs/second-chance-paws/stream`, { signal: ctrl.signal });
    const sse = sseReader(res);
    await sse.until((s) => s.includes("retry:"));
    await fetch(`${base}/api/donations/orders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ needId, amountCents: 500 }),
    });
    const text = await sse.until((s) => (s.match(/: ping/g) ?? []).length >= 3);
    expect(text).not.toContain("need.updated");
    expect(other.slug).toBe("second-chance-paws");
    ctrl.abort();
  });
});
