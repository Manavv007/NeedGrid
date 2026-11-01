import { ApiError } from "@needgrid/shared";
import { MockLanguageModelV4 } from "ai/test";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { nextIp } from "../test/fixtures";
import { DAILY_CAPS, resetDailyCaps } from "./dailyCap";
import {
  compactSchema,
  DASHBOARD_GUARD,
  MAX_NATIVE_SCHEMA_CHARS,
  RelayRes,
  repairArgs,
  repairStudioQuery,
  repairToolArgs,
  simplifyLargeSchema,
  toGeminiSchema,
  toModelMessages,
  toToolSet,
} from "./dashboardRelay";
import { setAiModels } from "./models";

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

describe("toGeminiSchema", () => {
  it("keeps $ref/$defs, maps const/oneOf, drops undefined sentinels and unsupported keywords", () => {
    const out = toGeminiSchema({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      additionalProperties: false,
      properties: {
        m: { $ref: "#/$defs/measure", description: "a measure" },
        g: { anyOf: [{ type: "string" }, { not: {} }] },
        k: { const: "aggregate" },
        n: { const: 3 },
        o: { oneOf: [{ type: "string" }, { type: "number" }] },
        x: { type: "string", examples: ["a"], deprecated: true },
      },
      required: ["m", "k", "gone"],
      $defs: { measure: { type: "object", properties: { f: { const: "id" } }, required: ["f"] } },
    });
    expect(out).toEqual({
      type: "object",
      additionalProperties: false,
      properties: {
        m: { $ref: "#/$defs/measure", description: "a measure" },
        g: { type: "string" },
        k: { enum: ["aggregate"], type: "string" },
        n: { enum: [3], type: "number" },
        o: { anyOf: [{ type: "string" }, { type: "number" }] },
        x: { type: "string" },
      },
      required: ["m", "k"],
      $defs: { measure: { type: "object", properties: { f: { enum: ["id"], type: "string" } }, required: ["f"] } },
    });
  });

  it("leaves recursive $refs alone (no inlining, so no loop)", () => {
    const schema = {
      $ref: "#/$defs/node",
      $defs: { node: { type: "object", properties: { child: { $ref: "#/$defs/node" } } } },
    };
    expect(toGeminiSchema(schema)).toEqual(schema);
  });
});

describe("large schemas → JSON-text arguments", () => {
  const big = {
    type: "object",
    properties: {
      query: {
        description: "The query.",
        anyOf: [{ $ref: "#/$defs/agg" }, { type: "object", properties: { variant: { enum: ["projection"] } } }],
      },
    },
    required: ["query"],
    $defs: {
      agg: {
        type: "object",
        properties: {
          variant: { enum: ["aggregation"] },
          measures: { type: "array", items: { $ref: "#/$defs/measure" } },
          pad: { type: "string", description: "x".repeat(MAX_NATIVE_SCHEMA_CHARS) },
        },
        required: ["variant"],
      },
      measure: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      unused: { type: "string" },
    },
  };

  it("compactSchema renders a one-line grammar", () => {
    expect(compactSchema(big.$defs.agg.properties.measures)).toBe("<measure>[]");
    expect(compactSchema(big.$defs.measure)).toBe("{ id: string }");
    expect(compactSchema({ type: "object", properties: { d: { enum: ["asc", "desc"] } } })).toBe(
      '{ d?: "asc"|"desc" }',
    );
  });

  it("small schemas pass through; large ones become string properties carrying the grammar of the defs they use", () => {
    const small = { type: "object", properties: { a: { type: "number" } } };
    expect(simplifyLargeSchema(small)).toBe(small);

    const out = simplifyLargeSchema(big);
    expect(Object.keys(out)).toEqual(["type", "properties", "required"]);
    expect(out.required).toEqual(["query"]);
    const query = (out.properties as Record<string, { type: string; description: string }>).query!;
    expect(query.type).toBe("string");
    expect(query.description).toMatch(/^The query\.\nWrite this argument as JSON text/);
    expect(query.description).toContain('<agg> = { variant: "aggregation", measures?: <measure>[]');
    expect(query.description).toContain("<measure> = { id: string }");
    expect(query.description).not.toContain("<unused>");
  });
});

describe("repairArgs / repairToolArgs", () => {
  it("parses a top-level argument sent as JSON text; leaves other strings alone", () => {
    expect(repairArgs({ query: '{"a":1}', list: "[1,2]", word: "hello", broken: "{nope" })).toEqual({
      query: { a: 1 },
      list: [1, 2],
      word: "hello",
      broken: "{nope",
    });
    expect(repairArgs("x")).toBe("x");
  });

  it("only repairs the query of execute_query", () => {
    expect(repairToolArgs("add_widget", { query: { dimensions: [] } })).toEqual({ query: { dimensions: [] } });
    expect(repairToolArgs("execute_query", { query: "{}" })).toEqual({
      query: { kind: "apiQuery", variant: "aggregation" },
    });
  });
});

describe("repairStudioQuery (slips Gemini made live, each checked against Studio's real execute_query)", () => {
  const good = {
    kind: "apiQuery",
    variant: "aggregation",
    axes: [{ dimensions: [{ field: { id: "needs.orgName" }, as: "charity" }] }],
    measures: [{ field: { id: "needs.deliveredCount", aggregation: "sum" }, as: "delivered" }],
    sort: [{ by: "delivered", direction: "desc" }],
    limit: { count: 1 },
  };

  it("leaves a correct query as it is", () => {
    expect(repairStudioQuery(good)).toEqual(good);
  });

  it("dimensions at the top level, with an aggregation → axes[0], aggregation dropped", () => {
    expect(
      repairStudioQuery({
        variant: "aggregation",
        dimensions: [{ field: { id: "needs.orgName", aggregation: "first" }, as: "charity" }],
        measures: good.measures,
        sort: good.sort,
        limit: { count: 1 },
      }),
    ).toEqual(good);
  });

  it("axes as one object, fields as bare strings, aggregation beside field", () => {
    expect(
      repairStudioQuery({
        axes: { dimensions: [{ field: "needs.orgName", as: "charity" }] },
        measures: [{ field: "needs.deliveredCount", aggregation: "sum", as: "delivered" }],
        sort: [{ by: "delivered", order: "DESC" }],
        limit: 1,
      }),
    ).toEqual(good);
  });

  it("measures put inside an axis move to the top level", () => {
    expect(
      repairStudioQuery({
        variant: "aggregation",
        axes: { dimensions: good.axes[0]!.dimensions, measures: good.measures },
        sort: good.sort,
        limit: { count: 1 },
      }),
    ).toEqual({ ...good, measures: good.measures });
  });

  it("filter fields as bare strings, including nested conditions", () => {
    const out = repairStudioQuery({
      ...good,
      filter: {
        operator: "and",
        conditions: [{ field: "allocations.month", operator: "equals", value: "2026-10" }],
      },
    }) as { filter: unknown };
    expect(out.filter).toEqual({
      operator: "and",
      conditions: [{ field: { id: "allocations.month" }, operator: "equals", value: "2026-10" }],
    });
  });

  it("projection fields as bare strings; non-objects pass through", () => {
    expect(repairStudioQuery({ projection: [{ field: "needs.title" }] })).toEqual({
      kind: "apiQuery",
      variant: "projection",
      projection: [{ field: { id: "needs.title" } }],
    });
    expect(repairStudioQuery("nope")).toBe("nope");
  });
});

describe("toModelMessages", () => {
  const user = (text: string) => ({
    type: "message" as const,
    kind: "input" as const,
    role: "user" as const,
    content: [{ type: "text", text }],
  });

  it("maps user text, assistant tool calls and their results; system messages go to instructions", () => {
    const { messages, system } = toModelMessages([
      { type: "message", kind: "input", role: "system", content: [{ type: "text", text: "Page: Impact" }] },
      user("What did November buy?"),
      { type: "function_call", callId: "c1", name: "run_query", arguments: '{"a":1}' },
      { type: "function_call_output", callId: "c1", output: '{"rows":[]}' },
      { type: "message", kind: "output", role: "assistant", content: [{ type: "text", text: "Nothing yet." }] },
      { type: "reasoning" },
    ]);
    expect(system).toEqual(["Page: Impact"]);
    expect(messages).toEqual([
      { role: "user", content: "What did November buy?" },
      { role: "assistant", content: [{ type: "tool-call", toolCallId: "c1", toolName: "run_query", input: { a: 1 } }] },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "c1",
            toolName: "run_query",
            output: { type: "text", value: '{"rows":[]}' },
          },
        ],
      },
      { role: "assistant", content: [{ type: "text", text: "Nothing yet." }] },
    ]);
  });

  it("uses a stored call result, and answers calls that never got one (Gemini requires a response per call)", () => {
    const { messages } = toModelMessages([
      user("hi"),
      { type: "function_call", callId: "a", name: "t", arguments: "not json", result: "stored" },
      { type: "function_call", callId: "b", name: "t", arguments: "{}" },
    ]);
    expect(messages[1]).toMatchObject({
      role: "assistant",
      content: [{ toolCallId: "a", input: {} }, { toolCallId: "b" }],
    });
    expect(messages[2]).toMatchObject({
      role: "tool",
      content: [
        { toolCallId: "a", output: { value: "stored" } },
        { toolCallId: "b", output: { value: "No result was recorded for this call." } },
      ],
    });
  });
});

it("toToolSet drops provider-hosted tools", () => {
  const set = toToolSet([
    { name: "run_query", description: "q", parameters: { type: "object", properties: {} } },
    { name: "web_search", description: "s", parameters: { type: "object" }, kind: "provided" },
    { name: "server_thing", description: "s", parameters: { type: "object" }, kind: "server" },
  ]);
  expect(Object.keys(set)).toEqual(["run_query"]);
});

describe("POST /api/ai/dashboard-complete", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildApp({ logger: false });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
  });
  afterEach(() => {
    setAiModels(null);
    resetDailyCaps();
  });

  const turn = {
    instructions: "Studio context",
    input: [
      { type: "message", kind: "input", role: "user", content: [{ type: "text", text: "Chart donations by month" }] },
    ],
    tools: [
      {
        name: "add_widget",
        description: "Add a widget",
        parameters: { type: "object", properties: { kind: { type: "string" } } },
      },
    ],
    toolChoice: "auto",
    responseFormat: { type: "text" },
  };
  const post = (payload: unknown) =>
    app.inject({
      method: "POST",
      url: "/api/ai/dashboard-complete",
      headers: { "x-forwarded-for": nextIp(), "content-type": "application/json" },
      payload: JSON.stringify(payload),
    });

  it("GET reports whether the AI is enabled (off in tests: no key)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/ai/dashboard-complete" });
    expect(res.json()).toEqual({ enabled: false, dailyLimit: DAILY_CAPS.dashboard });
  });

  it("503 UPSTREAM when the AI isn't configured", async () => {
    const res = await post(turn);
    expect(res.statusCode).toBe(503);
    expect(ApiError.parse(res.json()).error).toMatchObject({ code: "UPSTREAM", message: "AI is not configured" });
  });

  it("returns the turn's tool calls; our guard instructions come first and Studio's tools are passed through", async () => {
    let seen = "";
    setAiModels({
      language: new MockLanguageModelV4({
        modelId: "mock-gemini",
        doGenerate: async (opts) => {
          seen = JSON.stringify({ prompt: opts.prompt, tools: opts.tools });
          return {
            content: [{ type: "tool-call", toolCallId: "call-1", toolName: "add_widget", input: '{"kind":"column"}' }],
            finishReason: { unified: "tool-calls", raw: undefined },
            usage,
            warnings: [],
          };
        },
      }),
    });
    const res = await post(turn);
    expect(res.statusCode).toBe(200);
    const body = RelayRes.parse(res.json());
    expect(body.toolCalls).toEqual([{ callId: "call-1", name: "add_widget", arguments: '{"kind":"column"}' }]);
    expect(body.finishReason).toBe("tool-calls");
    expect(seen.indexOf(DASHBOARD_GUARD.slice(0, 40))).toBeLessThan(seen.indexOf("Studio context"));
    expect(seen).toContain('"add_widget"');
  });

  it("drops calls to tools that weren't offered and returns execute_query arguments repaired", async () => {
    const generate = (content: unknown[]) =>
      new MockLanguageModelV4({
        doGenerate: async () => ({
          content: content as never,
          finishReason: { unified: "tool-calls", raw: undefined },
          usage,
          warnings: [],
        }),
      });
    const withQuery = {
      ...turn,
      tools: [{ name: "execute_query", description: "q", parameters: { type: "object", properties: {} } }],
    };

    setAiModels({
      language: generate([
        { type: "tool-call", toolCallId: "a", toolName: "ExecuteQueryQuery0Measures0Field1", input: "{}" },
        {
          type: "tool-call",
          toolCallId: "b",
          toolName: "execute_query",
          input: JSON.stringify({ query: JSON.stringify({ dimensions: [{ field: "needs.orgName" }] }) }),
        },
      ]),
    });
    const body = RelayRes.parse((await post(withQuery)).json());
    expect(body.toolCalls).toEqual([
      {
        callId: "b",
        name: "execute_query",
        arguments: JSON.stringify({
          query: {
            kind: "apiQuery",
            variant: "aggregation",
            axes: [{ dimensions: [{ field: { id: "needs.orgName" } }] }],
          },
        }),
      },
    ]);

    setAiModels({
      language: generate([{ type: "tool-call", toolCallId: "a", toolName: "not_a_tool", input: "{}" }]),
    });
    const only = RelayRes.parse((await post(withQuery)).json());
    expect(only.toolCalls).toEqual([]);
    expect(only.text).toBe("I couldn't form that request. Could you rephrase it?");
  });

  it("400 for a malformed turn; 413 over 200 KB", async () => {
    setAiModels({ language: new MockLanguageModelV4() });
    expect((await post({ input: [] })).statusCode).toBe(400);
    expect((await post({ ...turn, instructions: "x".repeat(210 * 1024) })).statusCode).toBe(413);
  });

  it("503 'resting' once the daily cap is used up", async () => {
    setAiModels({
      language: new MockLanguageModelV4({
        doGenerate: async () => ({
          content: [{ type: "text", text: "ok" }],
          finishReason: { unified: "stop", raw: undefined },
          usage,
          warnings: [],
        }),
      }),
    });
    const { takeDailyBudget } = await import("./dailyCap");
    for (let i = 0; i < DAILY_CAPS.dashboard; i++) takeDailyBudget("dashboard");
    const res = await post(turn);
    expect(res.statusCode).toBe(503);
    expect(ApiError.parse(res.json()).error.message).toBe("The AI is resting, try again tomorrow");
  });
});
