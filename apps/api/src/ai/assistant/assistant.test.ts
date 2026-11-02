import { AgentStreamEvent, ApiError, type AgentAction, type NeedCard } from "@needgrid/shared";
import { MockLanguageModelV4 } from "ai/test";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../../app";
import * as core from "../../core";
import { hashStaffKey } from "../../lib/crypto";
import { HttpError } from "../../lib/http";
import type { StaffOrg } from "../../plugins/staffAuth";
import { demoProduct, nextIp } from "../../test/fixtures";
import { AI_RESTING, setAiModels } from "../models";
import { EMPTY_REPLY, GENERIC_ERROR, MAX_STEPS, runAssistantChat, TOO_MANY_STEPS } from "./chat";
import { matchesQuery, queryTokens, type ToolDeps } from "./tools";

// proposeAction is A's (stub until Tue Nov 3). The assistant may call it and nothing else that writes.
vi.mock("../../core", async (importOriginal) => ({
  ...(await importOriginal<typeof core>()),
  getNeedCards: vi.fn(),
  proposeAction: vi.fn(),
}));

const ORG = { id: "6f1c1d1e-2b3c-4d5e-8f90-0000000000aa", name: "Room 12 Readers" };
const OTHER_ORG = "6f1c1d1e-2b3c-4d5e-8f90-0000000000bb";
const id = (n: number) => `6f1c1d1e-2b3c-4d5e-8f90-${String(n).padStart(12, "0")}`;

const card = (n: number, title: string, over: Partial<NeedCard> = {}): NeedCard => ({
  id: id(n),
  orgId: ORG.id,
  orgSlug: "room-12-readers",
  title,
  description: "",
  category: "clothing",
  urgency: 3,
  quantity: 2,
  unit: "coat",
  status: "open",
  targetCents: 9000,
  fundedCents: 0,
  heldCents: 0,
  remainingCents: 9000,
  donorCount: 0,
  product: demoProduct(4000),
  deadlineAt: null,
  createdAt: "2026-10-20T00:00:00.000Z",
  updatedAt: "2026-10-20T00:00:00.000Z",
  ...over,
});
const NEEDS = [
  card(1, "Winter coats, kids' size 6"),
  card(2, "Winter coats, kids' size 8"),
  card(3, "Crayons, 24 pack", { category: "school" }),
  card(4, "Winter coats, kids' size 10", { orgId: OTHER_ORG }), // a bug elsewhere must not leak it
];
const deps: ToolDeps = {
  needIds: async () => NEEDS.map((n) => n.id),
  invoices: async () => [],
  propose: (input) => core.proposeAction(input),
};

const action = (args: Record<string, unknown>): AgentAction => ({
  id: id(900),
  tool: "create_invoice",
  args,
  computed: { totalCents: 18000 },
  preview: {
    title: "Invoice Acme Hardware for 2 items",
    lines: [{ label: "Total", value: "$180.00" }],
    totalCents: 18000,
  },
  status: "proposed",
  origin: "assistant",
  result: null,
  error: null,
  createdAt: "2026-11-04T00:00:00.000Z",
  decidedAt: null,
  executedAt: null,
});

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};
type Step = { text?: string; calls?: Array<{ name: string; input: unknown }> } | Error;

/** A model that plays `steps` in order (the last one repeats) and records every prompt. */
function stepModel(steps: Step[]) {
  const prompts: string[] = [];
  const model = new MockLanguageModelV4({
    doGenerate: async (opts) => {
      prompts.push(JSON.stringify(opts.prompt));
      const s = steps[Math.min(prompts.length - 1, steps.length - 1)]!;
      if (s instanceof Error) throw s;
      return {
        content: [
          ...(s.text ? [{ type: "text" as const, text: s.text }] : []),
          ...(s.calls ?? []).map((c, i) => ({
            type: "tool-call" as const,
            toolCallId: `call-${prompts.length}-${i}`,
            toolName: c.name,
            input: JSON.stringify(c.input),
          })),
        ],
        finishReason: { unified: s.calls?.length ? "tool-calls" : "stop", raw: undefined },
        usage,
        warnings: [],
      };
    },
  });
  return Object.assign(model, { prompts });
}

async function chat(steps: Step[], text = "Invoice Acme Hardware (sponsor@acme.example) for the winter coats") {
  const model = stepModel(steps);
  setAiModels({ language: model });
  const events: AgentStreamEvent[] = [];
  await runAssistantChat({ org: ORG, messages: [{ role: "user", content: text }], write: (e) => events.push(e), deps });
  return { events, prompts: model.prompts };
}

const INVOICE = { needIds: [id(1), id(2)], recipientEmail: "sponsor@acme.example", recipientName: "Acme Hardware" };

beforeEach(() => {
  vi.mocked(core.getNeedCards).mockImplementation(async (ids) => NEEDS.filter((n) => ids.includes(n.id)));
  vi.mocked(core.proposeAction).mockImplementation(async (input) => action(input.args as Record<string, unknown>));
});
afterEach(() => {
  vi.clearAllMocks();
  setAiModels(null);
});

describe("query matching", () => {
  it("tokens: 3+ letters, no stop words, plural s dropped", () => {
    expect(queryTokens("the whole Winter-Coats list")).toEqual(["winter", "coat"]);
    expect(queryTokens("")).toEqual([]);
  });
  it("every token must appear in the title, description or category", () => {
    expect(
      matchesQuery({ title: "Winter coats, size 8", description: "", category: "clothing" }, ["winter", "coat"]),
    ).toBe(true);
    expect(matchesQuery({ title: "Crayons", description: "", category: "school" }, ["coat"])).toBe(false);
    expect(matchesQuery({ title: "Crayons", description: "", category: "school" }, [])).toBe(true);
  });
});

describe("runAssistantChat", () => {
  it("'invoice Acme for the winter coats' → list_needs, propose_invoice, an action_proposed event, then done", async () => {
    const { events, prompts } = await chat([
      { text: "Let me find those needs.", calls: [{ name: "list_needs", input: { query: "winter coats" } }] },
      { calls: [{ name: "propose_invoice", input: INVOICE }] },
      { text: "I've prepared it, please review the approval card." },
    ]);

    expect(events.map((e) => e.type)).toEqual([
      "text",
      "tool_call",
      "tool_result",
      "tool_call",
      "tool_result",
      "action_proposed",
      "text",
      "done",
    ]);
    expect(events[1]).toEqual({ type: "tool_call", tool: "list_needs", summary: "Looking up your needs…" });
    expect(events[2]).toEqual({
      type: "tool_result",
      tool: "list_needs",
      summary: "Looked up your needs · found 2 items",
    });
    expect(events[6]).toEqual({ type: "text", delta: "\n\nI've prepared it, please review the approval card." });
    for (const e of events) AgentStreamEvent.parse(e);

    // The org comes from the passcode; the args are the validated contract args (send defaults to true).
    expect(core.proposeAction).toHaveBeenCalledTimes(1);
    expect(core.proposeAction).toHaveBeenCalledWith({
      orgId: ORG.id,
      tool: "create_invoice",
      args: { ...INVOICE, send: true },
      origin: "assistant",
    });
    // The staff message and the tool results reach the model wrapped as untrusted data; the other org's need doesn't.
    expect(prompts[0]).toContain("<untrusted_staff_message>");
    expect(prompts[1]).toContain("<untrusted_tool_result>");
    expect(prompts[1]).not.toContain(id(4));
    expect(prompts[2]).toContain("awaiting_human_approval");
  });

  it("an amount or org id sent by the model never reaches proposeAction", async () => {
    await chat([
      { calls: [{ name: "propose_invoice", input: { ...INVOICE, amountCents: 1, orgId: OTHER_ORG } }] },
      { text: "Done." },
    ]);
    const call = vi.mocked(core.proposeAction).mock.calls[0]![0];
    expect(call.orgId).toBe(ORG.id);
    expect(call.args).toEqual({ ...INVOICE, send: true });
  });

  it("one money proposal per message: a second one is refused to the model, not proposed", async () => {
    const { events, prompts } = await chat([
      {
        calls: [
          { name: "propose_invoice", input: INVOICE },
          { name: "propose_invoice", input: { ...INVOICE, needIds: [id(3)] } },
        ],
      },
      { text: "The first one is waiting on its approval card." },
    ]);
    expect(core.proposeAction).toHaveBeenCalledTimes(1);
    expect(events.filter((e) => e.type === "action_proposed")).toHaveLength(1);
    expect(events).toContainEqual({
      type: "tool_result",
      tool: "propose_invoice",
      summary: "Skipped: one approval card at a time",
    });
    expect(prompts[1]).toContain("Only one money action can be proposed per message");
  });

  it("invalid details or a refused proposal go back to the model as an error, with no card", async () => {
    vi.mocked(core.proposeAction).mockRejectedValueOnce(new HttpError(409, "INVALID_STATE", "Need is already funded"));
    const { events, prompts } = await chat([
      { calls: [{ name: "propose_invoice", input: { ...INVOICE, recipientEmail: "not an email" } }] },
      { calls: [{ name: "propose_invoice", input: INVOICE }] },
      { text: "That need is already funded." },
    ]);
    expect(prompts[1]).toContain("Invalid invoice details: recipientEmail");
    expect(prompts[2]).toContain("Need is already funded");
    expect(events.filter((e) => e.type === "action_proposed")).toEqual([]);
    expect(events.filter((e) => e.type === "tool_result").map((e) => (e as { summary: string }).summary)).toEqual([
      "Couldn't prepare the invoice",
      "Couldn't prepare an invoice",
    ]);
  });

  it("an unknown tool gets an error result and no events", async () => {
    const { events, prompts } = await chat([
      { calls: [{ name: "send_money", input: { to: "me" } }] },
      { text: "I can't do that." },
    ]);
    expect(events.map((e) => e.type)).toEqual(["text", "done"]);
    expect(core.proposeAction).not.toHaveBeenCalled();
    expect(prompts).toHaveLength(2);
  });

  it("an empty reply after a tool result is nudged once; a second empty one ends with a plain sentence", async () => {
    const first = await chat([
      { calls: [{ name: "list_needs", input: { query: "winter coats" } }] },
      {},
      { calls: [{ name: "propose_invoice", input: INVOICE }] },
      { text: "I've prepared it, please review the approval card." },
    ]);
    expect(first.prompts[2]).toContain("your last reply was empty");
    expect(first.events.filter((e) => e.type === "action_proposed")).toHaveLength(1);

    const { events } = await chat([{ calls: [{ name: "list_needs", input: {} }] }, {}]);
    expect(events.slice(-2)).toEqual([{ type: "text", delta: EMPTY_REPLY }, { type: "done" }]);
  });

  it(`stops after ${MAX_STEPS} model calls and says so`, async () => {
    const { events, prompts } = await chat([{ calls: [{ name: "list_needs", input: {} }] }]);
    expect(prompts).toHaveLength(MAX_STEPS);
    expect(events.at(-2)).toEqual({ type: "text", delta: TOO_MANY_STEPS });
    expect(events.at(-1)).toEqual({ type: "done" });
  });

  it("a model failure → a generic error event, then done; quota messages are shown as they are", async () => {
    let { events } = await chat([new Error("model exploded")]);
    expect(events).toEqual([{ type: "error", message: GENERIC_ERROR }, { type: "done" }]);

    const resting = new HttpError(503, "UPSTREAM", AI_RESTING); // what callModel throws when every model is out
    ({ events } = await chat([resting]));
    expect(events).toEqual([{ type: "error", message: AI_RESTING }, { type: "done" }]);
  });
});

describe("POST /api/staff/agent/chat", () => {
  const KEY = "room12-demo-2026";
  const org: StaffOrg = {
    id: ORG.id,
    slug: "room-12-readers",
    name: ORG.name,
    city: "Columbus, OH",
    description: "",
    causeTags: [],
    logoUrl: null,
  };
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildApp({
      logger: false,
      deps: { findOrgByStaffKeyHash: async (h) => (h === hashStaffKey(KEY) ? org : null) },
    });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
  });
  const post = (body: unknown, headers: Record<string, string> = { "x-staff-key": KEY }) =>
    app.inject({
      method: "POST",
      url: "/api/staff/agent/chat",
      headers: { ...headers, "x-forwarded-for": nextIp(), "content-type": "application/json" },
      payload: JSON.stringify(body),
    });
  const hello = { messages: [{ role: "user", content: "What can you do?" }] };

  it("streams NDJSON events ending with done", async () => {
    setAiModels({ language: stepModel([{ text: "I can prepare sponsor invoices." }]) });
    const res = await post(hello);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/x-ndjson");
    const events = res.body
      .trim()
      .split("\n")
      .map((l) => AgentStreamEvent.parse(JSON.parse(l)));
    expect(events).toEqual([{ type: "text", delta: "I can prepare sponsor invoices." }, { type: "done" }]);
  });

  it("JSON errors before the stream: 401, 400 (bad body / last message not from staff), 503 without a key", async () => {
    expect((await post(hello, {})).statusCode).toBe(401);
    expect((await post({ messages: [] })).statusCode).toBe(400);
    const last = await post({ messages: [...hello.messages, { role: "assistant", content: "hi" }] });
    expect([last.statusCode, ApiError.parse(last.json()).error.code]).toEqual([400, "VALIDATION"]);
    const off = await post(hello); // no Gemini key in tests
    expect([off.statusCode, ApiError.parse(off.json()).error.message]).toEqual([503, "AI is not configured"]);
  });
});
