import { ApiError } from "@needgrid/shared";
import { MockLanguageModelV4 } from "ai/test";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { nextIp } from "../test/fixtures";
import { DAILY_CAPS, resetDailyCaps } from "./dailyCap";
import { DASHBOARD_GUARD, RelayRes, toGeminiSchema, toModelMessages, toToolSet } from "./dashboardRelay";
import { setAiModels } from "./models";

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

describe("toGeminiSchema", () => {
  it("inlines $ref, maps const/oneOf, drops undefined sentinels and unsupported keywords", () => {
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
        e: { enum: [1, 2] },
      },
      required: ["m", "k", "gone"],
      $defs: { measure: { type: "object", properties: { f: { type: "string" } }, required: ["f"] } },
    });
    expect(out).toEqual({
      type: "object",
      properties: {
        m: { type: "object", properties: { f: { type: "string" } }, required: ["f"], description: "a measure" },
        g: { type: "string" },
        k: { enum: ["aggregate"] },
        n: { type: "number" },
        o: { anyOf: [{ type: "string" }, { type: "number" }] },
        e: {},
      },
      required: ["m", "k"],
    });
  });

  it("cuts off recursive $refs instead of looping", () => {
    const out = toGeminiSchema({
      $ref: "#/$defs/node",
      $defs: { node: { type: "object", properties: { child: { $ref: "#/$defs/node" } } } },
    });
    expect(JSON.stringify(out)).toContain("nested too deeply");
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
