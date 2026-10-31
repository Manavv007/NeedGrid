import {
  AgentActionListRes,
  AgentActionRes,
  ApiError,
  NeedCard,
  paths,
  ReconcileReport,
  SponsorInvoiceListRes,
  SponsorInvoiceView,
  STAFF_KEY_HEADER,
  type AgentAction,
  type AgentStreamEvent,
} from "@needgrid/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BAD_LINE_MESSAGE, readNdjson } from "@/lib/ndjson";
import { mockReconcileReport } from "@/mocks/assistant";
import { ORG_IDS } from "@/mocks/fixtures";
import { AMOUNTS_CHANGED_ERROR, CHAT_REQUESTS_PER_MINUTE, mockDb, SPONSOR_HOLD_DAYS } from "@/mocks/mockDb";

const API = "http://api.test";
const ROOM12 = ORG_IDS.room12;
const ROOM12_KEY = "room12-demo-2026";
const WINTER = {
  size67: "4c1f7a2e-9b3d-4e5f-8a6b-000000000301", // $30 of $152 raised
  size8: "4c1f7a2e-9b3d-4e5f-8a6b-000000000302", // nothing yet
  size1012: "4c1f7a2e-9b3d-4e5f-8a6b-000000000303", // $10 raised, $15 on hold
} as const;
const WINTER_IDS = Object.values(WINTER);
const DIAPERS_4 = "4c1f7a2e-9b3d-4e5f-8a6b-000000000101"; // Harbor

afterEach(() => {
  expect(mockDb.moneyProblems()).toEqual([]);
  vi.restoreAllMocks();
});

const card = (id: string) => {
  const found = mockDb.listStaffNeeds(ROOM12).find((need) => need.id === id);
  if (!found) throw new Error(`no need ${id}`);
  return found;
};

function propose(args: Record<string, unknown> = {}): AgentAction {
  const result = mockDb.proposeInvoice(ROOM12, {
    needIds: WINTER_IDS,
    recipientEmail: "sponsor@example.com",
    recipientName: "Acme Hardware",
    send: true,
    ...args,
  });
  if (result.kind !== "ok") throw new Error(`expected a proposal, got ${JSON.stringify(result)}`);
  return AgentActionRes.parse({ action: result.action }).action;
}

/** A $5 donation to `needId` (create order + capture), like a donor paying between proposal and approval. */
function donate(needId: string, cents = 500) {
  const order = mockDb.createOrder({ needId, amountCents: cents, rollOverConsent: true });
  if (order.kind !== "ok") throw new Error("expected an order");
  expect(mockDb.capture(order.order.orderId).kind).toBe("ok");
}

function liveUpdates(run: () => void): NeedCard[] {
  const cards: NeedCard[] = [];
  const stop = mockDb.subscribeNeedUpdates("room-12-readers", (data) => cards.push(NeedCard.parse(JSON.parse(data))));
  try {
    run();
  } finally {
    stop();
  }
  return cards;
}

async function call(method: "GET" | "POST", path: string, body?: unknown, key: string | null = ROOM12_KEY) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (key) headers[STAFF_KEY_HEADER] = key;
  return fetch(`${API}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

async function chat(text: string, key: string | null = ROOM12_KEY) {
  const res = await call("POST", paths.staff.agentChat, { messages: [{ role: "user", content: text }] }, key);
  const events: AgentStreamEvent[] = [];
  if (res.ok) await readNdjson(res, (event) => events.push(event));
  return { res, events };
}

describe("mock propose (A's proposeAction for create_invoice)", () => {
  it("computes every amount from the needs' remaining now and lists each in the preview", () => {
    const action = propose();
    const remaining = WINTER_IDS.map((id) => card(id).remainingCents);
    expect(action).toMatchObject({
      tool: "create_invoice",
      status: "proposed",
      origin: "assistant",
      result: null,
      error: null,
      computed: {
        planned: WINTER_IDS.map((needId, i) => ({ needId, amountCents: remaining[i] })),
        totalCents: remaining.reduce((sum, cents) => sum + cents, 0),
      },
    });
    expect(action.preview.title).toBe("Invoice Acme Hardware for 3 items");
    expect(action.preview.totalCents).toBe(remaining.reduce((sum, cents) => sum + cents, 0));
    expect(action.preview.lines.map((l) => l.label)).toEqual([
      "Send to",
      "Winter coats, kids' size 6–7 · 4 × coat",
      "Winter coats, kids' size 8 · 4 × coat",
      "Winter coats, kids' size 10–12 · 3 × coat",
      "After approval",
    ]);
    expect(action.preview.lines[0]?.value).toBe("Acme Hardware · sponsor@example.com");
    expect(action.preview.lines.at(-1)?.value).toBe("Create, send, and make a QR code");
  });

  it("refuses another charity's needs, needs not taking donations, and bad args", () => {
    expect(mockDb.proposeInvoice(ROOM12, { needIds: [DIAPERS_4], recipientEmail: "a@b.co" })).toMatchObject({
      kind: "refused",
      status: 400,
    });
    expect(mockDb.proposeInvoice(ROOM12, { needIds: WINTER_IDS, recipientEmail: "not an email" })).toMatchObject({
      kind: "refused",
      code: "VALIDATION",
    });
  });
});

describe("mock approve and reject (A §8.6, §8.7)", () => {
  it("approve executes the invoice: sent, payer link, PNG QR code, and a 14-day sponsor hold per need", () => {
    const action = propose();
    const before = WINTER_IDS.map((id) => card(id));
    let approved: AgentAction | null = null;
    const updates = liveUpdates(() => {
      const result = mockDb.approveAgentAction(ROOM12, action.id);
      if (result.kind !== "ok") throw new Error("expected ok");
      approved = AgentActionRes.parse({ action: result.action }).action;
    });
    expect(approved).toMatchObject({ status: "executed", error: null, decidedAt: expect.any(String) });
    const invoice = SponsorInvoiceView.parse(approved && (approved as AgentAction).result);
    expect(invoice).toMatchObject({
      recipientEmail: "sponsor@example.com",
      recipientName: "Acme Hardware",
      needIds: WINTER_IDS,
      amountCents: action.preview.totalCents,
      status: "sent",
    });
    expect(invoice.payerViewUrl).toMatch(/^https:\/\/www\.sandbox\.paypal\.com\/invoice\/p\/#INV2-/);
    expect(invoice.qrImageDataUrl).toMatch(/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/);
    const png = atob((invoice.qrImageDataUrl ?? "").split(",")[1] ?? "");
    expect(png.slice(1, 4)).toBe("PNG");

    // Every planned need is now fully held for the sponsor, live on every open screen.
    WINTER_IDS.forEach((id, i) => {
      const was = before[i];
      expect(card(id)).toMatchObject({
        remainingCents: 0,
        heldCents: (was?.heldCents ?? 0) + (was?.remainingCents ?? 0),
      });
    });
    expect(new Set(updates.map((c) => c.id))).toEqual(new Set(WINTER_IDS));
    expect(mockDb.listSponsorInvoices(ROOM12)).toEqual([invoice]);
    expect(mockDb.listSponsorInvoices(ORG_IDS.harbor)).toEqual([]);

    // Donors can't double-fund a held tile.
    expect(mockDb.createOrder({ needId: WINTER.size8, amountCents: 1000, rollOverConsent: true }).kind).toBe(
      "fullyFunded",
    );
    // The holds outlast a normal checkout hold: still there 13 days on.
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + (SPONSOR_HOLD_DAYS - 1) * 86_400_000);
    expect(card(WINTER.size8).remainingCents).toBe(0);
  });

  it("amounts changed since the proposal → failed with A's exact message; nothing is held or invoiced", () => {
    const action = propose();
    donate(WINTER.size8);
    const before = WINTER_IDS.map((id) => card(id).heldCents);
    const result = mockDb.approveAgentAction(ROOM12, action.id);
    expect(result).toMatchObject({
      kind: "ok",
      action: { status: "failed", error: AMOUNTS_CHANGED_ERROR, result: null },
    });
    expect(WINTER_IDS.map((id) => card(id).heldCents)).toEqual(before);
    expect(mockDb.listSponsorInvoices(ROOM12)).toEqual([]);
  });

  it("?mock=amountsChanged makes the next approval fail the same way", () => {
    const action = propose();
    mockDb.armScenario("amountsChanged");
    expect(mockDb.approveAgentAction(ROOM12, action.id)).toMatchObject({
      action: { status: "failed", error: AMOUNTS_CHANGED_ERROR },
    });
    // Used up: the next proposal approves normally.
    expect(mockDb.approveAgentAction(ROOM12, propose().id)).toMatchObject({ action: { status: "executed" } });
  });

  it("reject runs nothing", () => {
    const action = propose();
    const before = mockDb.listStaffNeeds(ROOM12);
    const updates = liveUpdates(() => {
      expect(mockDb.rejectAgentAction(ROOM12, action.id)).toMatchObject({
        kind: "ok",
        action: { status: "rejected", result: null, executedAt: null },
      });
    });
    expect(updates).toEqual([]);
    expect(mockDb.listStaffNeeds(ROOM12)).toEqual(before);
    expect(mockDb.listSponsorInvoices(ROOM12)).toEqual([]);
  });

  it("only a proposed action can be decided (409), and only by its own charity (404)", () => {
    const action = propose();
    expect(mockDb.approveAgentAction(ORG_IDS.harbor, action.id).kind).toBe("notFound");
    expect(mockDb.approveAgentAction(ROOM12, action.id)).toMatchObject({ action: { status: "executed" } });
    expect(mockDb.approveAgentAction(ROOM12, action.id)).toMatchObject({
      kind: "refused",
      status: 409,
      code: "INVALID_STATE",
    });
    expect(mockDb.rejectAgentAction(ROOM12, action.id)).toMatchObject({ kind: "refused", status: 409 });
    expect(mockDb.listSponsorInvoices(ROOM12)).toHaveLength(1);
  });
});

describe("mock agent action handlers", () => {
  it("lists by status, approves over HTTP, and 409s a second decision", async () => {
    const action = propose();
    const pending = AgentActionListRes.parse(
      await (await call("GET", `${paths.staff.actions}?status=proposed`)).json(),
    );
    expect(pending.actions.map((a) => a.id)).toEqual([action.id]);

    const approved = await call("POST", paths.staff.approveAction(action.id), {});
    expect(approved.status).toBe(200);
    expect(AgentActionRes.parse(await approved.json()).action.status).toBe("executed");

    const again = await call("POST", paths.staff.rejectAction(action.id), {});
    expect(again.status).toBe(409);
    expect(ApiError.parse(await again.json()).error.code).toBe("INVALID_STATE");

    const invoices = SponsorInvoiceListRes.parse(await (await call("GET", paths.staff.invoices)).json());
    expect(invoices.invoices).toHaveLength(1);
    expect((await call("GET", `${paths.staff.actions}?status=nope`)).status).toBe(400);
    expect((await call("GET", paths.staff.actions, undefined, null)).status).toBe(401);
    expect((await call("POST", paths.staff.approveAction("not-a-uuid"), {})).status).toBe(404);
  });
});

describe("mock assistant chat (B §9.6)", () => {
  it("401 without a staff key, 400 for a bad body, 429 after 20 chats a minute", async () => {
    expect((await chat("hello", null)).res.status).toBe(401);
    // Like the API's rate limit, every request with a valid key counts, refused bodies too.
    expect((await call("POST", paths.staff.agentChat, { messages: [] })).status).toBe(400);
    for (let i = 0; i < CHAT_REQUESTS_PER_MINUTE - 2; i += 1) mockDb.takeChatRequest(ROOM12_KEY);
    expect((await chat("hello")).res.status).toBe(200);
    const limited = await chat("hello");
    expect(limited.res.status).toBe(429);
    expect(ApiError.parse(await limited.res.json()).error.code).toBe("RATE_LIMITED");
  });

  it("an invoice request: text, list_needs, propose_invoice, action_proposed, then 'please review', done", async () => {
    const { res, events } = await chat("Invoice Acme Hardware (sponsor@example.com) for the whole winter-coats list");
    expect(res.headers.get("content-type")).toBe("application/x-ndjson");
    const kinds = events.map((e) =>
      e.type === "tool_call" || e.type === "tool_result" ? `${e.type}:${e.tool}` : e.type,
    );
    expect(kinds.filter((k) => k !== "text")).toEqual([
      "tool_call:list_needs",
      "tool_result:list_needs",
      "tool_call:propose_invoice",
      "tool_result:propose_invoice",
      "action_proposed",
      "done",
    ]);
    expect(kinds[0]).toBe("text");
    expect(events.find((e) => e.type === "tool_call")).toMatchObject({ summary: "Looking up your needs…" });
    expect(events.filter((e) => e.type === "tool_call")[1]).toMatchObject({
      summary: "Preparing an invoice for approval…",
    });
    const proposed = events.find((e) => e.type === "action_proposed");
    expect(proposed?.type === "action_proposed" && proposed.action.computed).toMatchObject({
      planned: WINTER_IDS.map((needId) => ({ needId })),
    });
    const text = events.flatMap((e) => (e.type === "text" ? [e.delta] : [])).join("");
    expect(text).toContain("I've prepared it, please review the approval card.");
    // The model never states amounts.
    expect(text).not.toMatch(/\$\d/);
    expect(mockDb.listAgentActions(ROOM12, "proposed")).toHaveLength(1);
  });

  it("asks for an email instead of guessing one", async () => {
    const { events } = await chat("Invoice Acme Hardware for the winter coats");
    expect(events.some((e) => e.type === "action_proposed")).toBe(false);
    expect(events.flatMap((e) => (e.type === "text" ? [e.delta] : [])).join("")).toContain("email address");
    expect(mockDb.listAgentActions(ROOM12)).toEqual([]);
  });

  it("a money check answers with a ReconcileReport; 'mismatch' gives one missing and one different amount", async () => {
    const ok = await chat("Check this week's money matches our records");
    const okResult = ok.events.find((e) => e.type === "tool_result");
    expect(ok.events.find((e) => e.type === "tool_call")).toMatchObject({
      tool: "reconcile",
      summary: "Checking PayPal transactions…",
    });
    expect(okResult?.type === "tool_result" && ReconcileReport.parse(okResult.data).ok).toBe(true);

    const bad = await chat("Show me a mismatch");
    const badResult = bad.events.find((e) => e.type === "tool_result");
    const report = ReconcileReport.parse(badResult?.type === "tool_result" ? badResult.data : null);
    expect(report.ok).toBe(false);
    expect(report.mismatches.map((m) => m.kind)).toEqual(["missing_in_records", "amount_mismatch"]);
  });

  it("the report's totals follow the ledger: gifts from the last 3 hours are pending, not mismatches", () => {
    const { report, pending } = mockReconcileReport(ROOM12, false);
    expect(report).toMatchObject({ ok: true, mismatches: [] });
    expect(report.paypalTotalCents).toBe(report.recordedTotalCents);
    expect(report.matchedCount).toBeGreaterThan(0);
    donate(WINTER.size8);
    const after = mockReconcileReport(ROOM12, false);
    expect(after.pending).toBe(pending + 1);
    expect(after.report.recordedTotalCents).toBe(report.recordedTotalCents);
  });

  it("refuses 'refund everyone' without a tool, and lists open needs by title only", async () => {
    const refund = await chat("Refund everyone who gave this week");
    expect(refund.events.map((e) => e.type).filter((t) => t !== "text")).toEqual(["done"]);
    expect(refund.events.flatMap((e) => (e.type === "text" ? [e.delta] : [])).join("")).toContain(
      "one donation at a time",
    );

    const open = await chat("What's still unfunded and urgent?");
    const text = open.events.flatMap((e) => (e.type === "text" ? [e.delta] : [])).join("");
    expect(text).toContain("Winter coats, kids' size 8 (urgent)");
    expect(text).not.toMatch(/\$\d/);
  });

  it("?mock=assistantError ends with an error event and done; assistantBadLine sends unreadable lines", async () => {
    mockDb.armScenario("assistantError");
    const failing = await chat("anything");
    expect(failing.events.slice(-2)).toEqual([
      { type: "error", message: "Sorry, the assistant hit a problem and stopped." },
      { type: "done" },
    ]);

    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockDb.armScenario("assistantBadLine");
    const bad = await chat("anything");
    expect(bad.events.filter((e) => e.type === "error")).toEqual([
      { type: "error", message: BAD_LINE_MESSAGE },
      { type: "error", message: BAD_LINE_MESSAGE },
    ]);
    expect(bad.events.at(-1)).toEqual({ type: "done" });
  });
});
