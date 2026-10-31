import { MockLanguageModelV4 } from "ai/test";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { buildApp } from "../../app";
import { nextIp } from "../../test/fixtures";
import { resetDailyCaps } from "../dailyCap";
import { setAiModels } from "../models";

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp({ logger: false });
  await app.listen({ port: 0, host: "127.0.0.1" });
});
afterAll(async () => {
  await app.close();
});
afterEach(() => {
  setAiModels(null);
  resetDailyCaps();
});

// Regression (Oct 31): the route aborted on the REQUEST's "close", which Node 24 emits as soon as the body is read,
// so every real turn was cancelled at once and answered 502 "busy". app.inject doesn't reproduce it; real HTTP does.
it("a slow turn over real HTTP is not cancelled by the request finishing", async () => {
  setAiModels({
    language: new MockLanguageModelV4({
      doGenerate: async ({ abortSignal }) => {
        await new Promise((r) => setTimeout(r, 300));
        if (abortSignal?.aborted) throw new Error("aborted");
        return {
          content: [{ type: "text", text: "Here is your chart." }],
          finishReason: { unified: "stop", raw: undefined },
          usage: {
            inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
            outputTokens: { total: 1, text: 1, reasoning: undefined },
          },
          warnings: [],
        };
      },
    }),
  });
  const address = app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const res = await fetch(`http://127.0.0.1:${port}/api/ai/dashboard-complete`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": nextIp() },
    body: JSON.stringify({
      input: [{ type: "message", kind: "input", role: "user", content: [{ type: "text", text: "Chart it" }] }],
    }),
  });
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ text: "Here is your chart.", toolCalls: [] });
});
