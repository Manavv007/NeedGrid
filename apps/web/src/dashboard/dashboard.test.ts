import type { DatasetAllocationRow, DatasetDonationRow, DatasetNeedRow } from "@needgrid/shared";
import type { AgAiEvent, AgLlmRequest } from "ag-studio";
import { afterEach, describe, expect, it } from "vitest";
import { buildStudioData, filterByOrg, type DashboardData } from "./data";
import { geminiAdapter, isDashboardAiEnabled, toRelayBody, toTurn, type FetchLike } from "./geminiAdapter";
import { clearSaved, defaultReport, loadSaved, REPORT_VERSION, save, STORAGE_KEY } from "./reportState";

const need = (over: Partial<DatasetNeedRow>): DatasetNeedRow => ({
  needId: "6f1c1d1e-2b3c-4d5e-8f90-000000000001",
  orgSlug: "harbor-food-bank",
  orgName: "Harbor Food Bank",
  title: "Diapers, size 4",
  category: "baby",
  urgency: 3,
  status: "open",
  quantity: 2,
  unit: "pack of 150",
  retailer: "walmart.com",
  targetUsd: 84,
  fundedUsd: 70,
  createdAt: "2026-10-01T00:00:00.000Z",
  fundedAt: null,
  orderedAt: null,
  deliveredAt: null,
  daysFundedToDelivered: null,
  photoUrl: null,
  ...over,
});
const donation = (over: Partial<DatasetDonationRow> = {}): DatasetDonationRow => ({
  donationKey: "a1b2c3d4e5f60718",
  orgSlug: "harbor-food-bank",
  amountUsd: 25,
  source: "seed",
  donatedAt: "2026-10-20T12:00:00.000Z",
  month: "2026-10",
  ...over,
});
const allocation = (over: Partial<DatasetAllocationRow> = {}): DatasetAllocationRow => ({
  allocationId: "6f1c1d1e-2b3c-4d5e-8f90-0000000000a1",
  donationKey: "a1b2c3d4e5f60718",
  needId: "6f1c1d1e-2b3c-4d5e-8f90-000000000001",
  orgSlug: "harbor-food-bank",
  category: "baby",
  amountUsd: 25,
  reason: "direct",
  allocatedAt: "2026-11-02T12:00:00.000Z",
  month: "2026-11",
  ...over,
});

const data: DashboardData = {
  needs: [
    need({}),
    need({
      needId: "6f1c1d1e-2b3c-4d5e-8f90-000000000002",
      orgSlug: "room-12-readers",
      orgName: "Room 12 Readers",
      title: "Crayons",
      category: "school",
      urgency: 2,
      status: "delivered",
      fundedUsd: 33,
      targetUsd: 33,
      fundedAt: "2026-10-10T00:00:00.000Z",
      deliveredAt: "2026-10-14T00:00:00.000Z",
      daysFundedToDelivered: 4,
    }),
  ],
  donations: [
    donation(),
    donation({ donationKey: "ffff", orgSlug: "room-12-readers", donatedAt: "2026-09-30T08:00:00.000Z" }),
  ],
  allocations: [
    allocation(),
    allocation({
      allocationId: "6f1c1d1e-2b3c-4d5e-8f90-0000000000a2",
      orgSlug: "room-12-readers",
      category: "school",
      donationKey: "ffff",
    }),
  ],
  generatedAt: "2026-11-09T20:00:00.000Z",
};

describe("buildStudioData", () => {
  const studio = buildStudioData(data);
  type Source = { id: string; data: Record<string, unknown>[]; fields?: Array<{ id: string }> };
  const sources = studio.sources as unknown as Source[];
  const rows = (id: string) => sources.find((s) => s.id === id)!.data;

  it("has the three sources, joined allocations → needs and allocations → donations, plus a calendar", () => {
    expect(studio.sources.map((s) => s.id)).toEqual(["needs", "donations", "allocations"]);
    expect(studio.relationships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "allocation-need",
          source: { tableId: "allocations", fieldId: "needId" },
          target: { tableId: "needs", fieldId: "needId" },
        }),
        expect.objectContaining({
          id: "allocation-donation",
          target: { tableId: "donations", fieldId: "donationKey" },
        }),
      ]),
    );
    // Calendar spans the earliest donation to the latest allocation.
    expect(studio.calendars?.[0]?.range).toEqual({
      from: { type: "date", value: "2026-09-30" },
      to: { type: "date", value: "2026-11-02" },
    });
  });

  it("derives flags, labels and 'still needed' from the server's numbers", () => {
    const [open, delivered] = rows("needs");
    expect(open).toMatchObject({
      stillNeededUsd: 14,
      fundedCount: 0,
      deliveredCount: 0,
      urgencyLabel: "Urgent",
      categoryLabel: "Baby",
      statusLabel: "Still needed",
    });
    expect(delivered).toMatchObject({
      stillNeededUsd: 0,
      fundedCount: 1,
      deliveredCount: 1,
      isDelivered: true,
      statusLabel: "Delivered",
    });
    expect(rows("donations")[1]).toMatchObject({ orgName: "Room 12 Readers" });
    expect(rows("allocations")[1]).toMatchObject({ orgName: "Room 12 Readers", categoryLabel: "School" });
  });

  it("every field the default report uses exists in the data sources", () => {
    const known = new Set(sources.flatMap((s) => (s.fields ?? []).map((f) => `${s.id}.${f.id}`)));
    const used = JSON.stringify(defaultReport()).match(/"id":"(needs|donations|allocations)\.[A-Za-z]+"/g) ?? [];
    const missing = [...new Set(used.map((u) => u.slice(6, -1)))].filter((id) => !known.has(id));
    expect(missing).toEqual([]);
  });
});

describe("filterByOrg", () => {
  it("keeps one charity's rows; an unknown slug shows everything", () => {
    const one = filterByOrg(data, "room-12-readers");
    expect([one.needs.length, one.donations.length, one.allocations.length]).toEqual([1, 1, 1]);
    expect(filterByOrg(data, "nope")).toBe(data);
    expect(filterByOrg(data, null)).toBe(data);
  });
});

describe("saved report", () => {
  afterEach(() => localStorage.clear());

  it("round-trips through localStorage under needgrid.dashboard.v1", () => {
    const state = defaultReport();
    save(state);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).version).toBe(REPORT_VERSION);
    expect(loadSaved()).toEqual(state);
    clearSaved();
    expect(loadSaved()).toBeNull();
  });

  it("ignores saves from another version and garbage", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: REPORT_VERSION + 1, state: defaultReport() }));
    expect(loadSaved()).toBeNull();
    localStorage.setItem(STORAGE_KEY, "{not json");
    expect(loadSaved()).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------

const request: AgLlmRequest = {
  instructions: "Studio context",
  input: [
    {
      id: "m1",
      kind: "input",
      type: "message",
      role: "user",
      status: "completed",
      content: [{ type: "text", text: "Chart it" }],
    },
  ],
  tools: [{ name: "add_widget", description: "Add a widget", parameters: { type: "object" } as never }],
  toolChoice: "auto",
  responseFormat: { type: "text" },
  model: { id: "gpt-5", effort: "high" } as never,
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function drain(stream: { [Symbol.asyncIterator](): AsyncIterator<AgAiEvent> }) {
  const out: AgAiEvent[] = [];
  for await (const e of stream) out.push(e);
  return out;
}

describe("geminiAdapter", () => {
  it("toRelayBody drops the model choice (the server picks Gemini)", () => {
    const body = toRelayBody(request);
    expect(body).not.toHaveProperty("model");
    expect(body.tools).toEqual([{ name: "add_widget", description: "Add a widget", parameters: { type: "object" } }]);
  });

  it("toTurn: text then tool calls, as Studio events and output items", () => {
    const { events, response } = toTurn({
      text: "Here you go",
      toolCalls: [{ callId: "c1", name: "add_widget", arguments: '{"kind":"column"}' }],
      finishReason: "tool-calls",
      usage: { inputTokens: 10, outputTokens: 4 },
      model: "gemini-2.5-flash-lite",
    });
    expect(events.map((e) => e.type)).toEqual([
      "TEXT_MESSAGE_START",
      "TEXT_MESSAGE_CONTENT",
      "TEXT_MESSAGE_END",
      "TOOL_CALL_START",
      "TOOL_CALL_ARGS",
      "TOOL_CALL_END",
    ]);
    expect(response).toMatchObject({
      status: "completed",
      model: "gemini-2.5-flash-lite",
      usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 },
      output: [
        { type: "message", role: "assistant", content: [{ type: "text", text: "Here you go", annotations: [] }] },
        { type: "function_call", callId: "c1", name: "add_widget", arguments: '{"kind":"column"}' },
      ],
    });
  });

  it("executeTurn posts to the relay and resolves complete after streaming the events", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const fetch: FetchLike = async (url, init) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return json(200, {
        text: "",
        toolCalls: [{ callId: "c9", name: "add_widget", arguments: "{}" }],
        finishReason: "tool-calls",
        usage: null,
        model: "m",
      });
    };
    const turn = geminiAdapter({ endpoint: "http://api.test/api/ai/dashboard-complete", fetch }).executeTurn(request);
    const events = await drain(turn.stream);
    expect(events.map((e) => e.type)).toEqual(["TOOL_CALL_START", "TOOL_CALL_ARGS", "TOOL_CALL_END"]);
    await expect(turn.complete).resolves.toMatchObject({ status: "completed", output: [{ callId: "c9" }] });
    expect(calls[0]!.url).toBe("http://api.test/api/ai/dashboard-complete");
    expect(calls[0]!.body).toMatchObject({ instructions: "Studio context", toolChoice: "auto" });
  });

  it("a failed turn rejects complete with the server's message and ends the stream quietly", async () => {
    const fetch: FetchLike = async () =>
      json(503, { error: { code: "UPSTREAM", message: "The AI is resting, try again tomorrow" } });
    const turn = geminiAdapter({ endpoint: "x", fetch }).executeTurn(request);
    expect(await drain(turn.stream)).toEqual([]);
    await expect(turn.complete).rejects.toThrow("The AI is resting, try again tomorrow");
  });

  it("isDashboardAiEnabled is false on errors and when the server says so", async () => {
    expect(await isDashboardAiEnabled({ fetch: async () => json(200, { enabled: true, dailyLimit: 300 }) })).toBe(true);
    expect(await isDashboardAiEnabled({ fetch: async () => json(200, { enabled: false }) })).toBe(false);
    expect(await isDashboardAiEnabled({ fetch: async () => json(500, {}) })).toBe(false);
    expect(
      await isDashboardAiEnabled({
        fetch: async () => {
          throw new Error("offline");
        },
      }),
    ).toBe(false);
  });
});

describe("analyst agent helpers", () => {
  it("configureToolName makes a Gemini-safe function name", async () => {
    const { configureToolName } = await import("./agents");
    expect(configureToolName("nov-by-category")).toBe("configure_nov-by-category");
    expect(configureToolName("chart 1/€")).toBe("configure_chart_1__");
    expect(configureToolName("x".repeat(100))).toHaveLength(64);
  });

  it("only widgets the AI or the reader added are configurable, most recent last, at most 4", async () => {
    const { configurableWidgets } = await import("./agents");
    const state = defaultReport();
    const impact = state.pages[0]!;
    const added = {
      a: { type: "column-chart-stacked" },
      b: { type: "pie-chart" },
      c: { type: "grid" },
      d: { type: "value" },
      e: { type: "line-chart" },
    };
    impact.widgets = { ...impact.widgets, ...(added as unknown as typeof impact.widgets) };
    const ids = configurableWidgets({ getState: () => state } as never).map((w) => w.id);
    expect(ids).toEqual(["b", "c", "d", "e"]);
    expect(configurableWidgets({ getState: () => defaultReport() } as never)).toEqual([]);
  });
});
