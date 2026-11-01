import { paths, STAFF_KEY_STORAGE, type AgentStreamEvent } from "@needgrid/shared";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "@/lib/api";
import { BAD_LINE_MESSAGE, RATE_LIMITED_MESSAGE, readNdjson, streamAgentChat } from "@/lib/ndjson";
import { setUnauthorizedHandler } from "@/lib/unauthorized";
import { server } from "@/mocks/node";

const CHAT = `http://api.test${paths.staff.agentChat}`;

/** A response whose body sends these chunks (text or raw bytes), then closes unless `open`. */
function ndjson(chunks: ReadonlyArray<string | Uint8Array>, { open = false } = {}): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(typeof chunk === "string" ? encoder.encode(chunk) : chunk);
      if (!open) controller.close();
    },
  });
  return new Response(body, { headers: { "content-type": "application/x-ndjson" } });
}

async function collect(response: Response, signal?: AbortSignal) {
  const events: AgentStreamEvent[] = [];
  const outcome = await readNdjson(response, (event) => events.push(event), signal);
  return { events, outcome };
}

const line = (event: AgentStreamEvent) => `${JSON.stringify(event)}\n`;
const done = line({ type: "done" });

describe("readNdjson", () => {
  it("joins a line split across chunks", async () => {
    const { events, outcome } = await collect(
      ndjson(['{"type":"te', 'xt","delta":"Hel', 'lo"}\n{"type":"do', 'ne"}\n']),
    );
    expect(events).toEqual([{ type: "text", delta: "Hello" }, { type: "done" }]);
    expect(outcome).toBe("done");
  });

  it("reads several events from one chunk and skips empty lines and \\r\\n endings", async () => {
    const chunk = [
      '{"type":"text","delta":"a"}',
      "",
      "   ",
      '{"type":"tool_call","tool":"reconcile","summary":"Checking PayPal transactions…"}\r',
      '{"type":"done"}',
      "",
    ].join("\n");
    const { events } = await collect(ndjson([chunk]));
    expect(events).toEqual([
      { type: "text", delta: "a" },
      { type: "tool_call", tool: "reconcile", summary: "Checking PayPal transactions…" },
      { type: "done" },
    ]);
  });

  it("turns a line that isn't JSON, or isn't a known event, into a local error and keeps reading", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { events, outcome } = await collect(
      ndjson([
        "not json at all\n",
        '{"type":"surprise","html":"<b>raw</b>"}\n',
        '{"type":"text"}\n',
        line({ type: "text", delta: "still here" }),
        done,
      ]),
    );
    expect(events).toEqual([
      { type: "error", message: BAD_LINE_MESSAGE },
      { type: "error", message: BAD_LINE_MESSAGE },
      { type: "error", message: BAD_LINE_MESSAGE },
      { type: "text", delta: "still here" },
      { type: "done" },
    ]);
    expect(JSON.stringify(events)).not.toContain("raw");
    expect(outcome).toBe("done");
    // Dev builds log the contract problem (never the line itself).
    expect(log).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(log.mock.calls)).not.toContain("<b>raw</b>");
    log.mockRestore();
  });

  it("ignores anything after done", async () => {
    const { events } = await collect(ndjson([done, line({ type: "text", delta: "late" })]));
    expect(events).toEqual([{ type: "done" }]);
  });

  it("stops quietly on abort: no error, no done, even while the stream is silent", async () => {
    const controller = new AbortController();
    const events: AgentStreamEvent[] = [];
    const outcome = await readNdjson(
      ndjson([line({ type: "text", delta: "Working" })], { open: true }),
      (event) => {
        events.push(event);
        controller.abort();
      },
      controller.signal,
    );
    expect(outcome).toBe("aborted");
    expect(events).toEqual([{ type: "text", delta: "Working" }]);
  });

  it("a stream that ends without done is done, but ended early (a last line without its newline counts)", async () => {
    const { events, outcome } = await collect(ndjson(['{"type":"text","delta":"Hi"}']));
    expect(events).toEqual([{ type: "text", delta: "Hi" }, { type: "done" }]);
    expect(outcome).toBe("ended_early");
  });

  it("works without TextDecoderStream, keeping characters split across chunks whole", async () => {
    vi.stubGlobal("TextDecoderStream", undefined);
    const bytes = new TextEncoder().encode(`${line({ type: "text", delta: "Checking…" })}${done}`);
    const cut = bytes.indexOf(0xe2) + 1; // inside the 3 bytes of "…"
    const { events, outcome } = await collect(ndjson([bytes.slice(0, cut), bytes.slice(cut)]));
    expect(events).toEqual([{ type: "text", delta: "Checking…" }, { type: "done" }]);
    expect(outcome).toBe("done");
  });
});

describe("streamAgentChat", () => {
  const onUnauthorized = vi.fn();
  beforeEach(() => {
    sessionStorage.setItem(STAFF_KEY_STORAGE, "harbor-demo-2026");
    setUnauthorizedHandler(onUnauthorized);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    onUnauthorized.mockReset();
    setUnauthorizedHandler(() => undefined);
  });

  const req = { messages: [{ role: "user" as const, content: "What's still unfunded and urgent?" }] };

  it("posts the history with the staff key and streams the mock's reply to done", async () => {
    let sent: { key: string | null; body: unknown } | null = null;
    server.use(
      http.post(CHAT, async ({ request }) => {
        sent = { key: request.headers.get("x-staff-key"), body: await request.clone().json() };
      }),
    );
    const events: AgentStreamEvent[] = [];
    const outcome = await streamAgentChat(req, {
      signal: new AbortController().signal,
      onEvent: (e) => events.push(e),
    });
    expect(sent).toEqual({ key: "harbor-demo-2026", body: req });
    expect(outcome).toBe("done");
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(["tool_call", "tool_result", "text"]));
    expect(events.at(-1)).toEqual({ type: "done" });
  });

  it("401: signs staff out (key cleared, sent to sign in) and throws", async () => {
    sessionStorage.setItem(STAFF_KEY_STORAGE, "wrong-key");
    const error = await streamAgentChat(req, { signal: new AbortController().signal, onEvent: () => undefined }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).toMatchObject({ status: 401, code: "UNAUTHORIZED" });
    expect(sessionStorage.getItem(STAFF_KEY_STORAGE)).toBeNull();
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it("429: says to slow down", async () => {
    server.use(
      http.post(CHAT, () =>
        HttpResponse.json({ error: { code: "RATE_LIMITED", message: "Rate limit exceeded" } }, { status: 429 }),
      ),
    );
    const error = await streamAgentChat(req, { signal: new AbortController().signal, onEvent: () => undefined }).catch(
      (e: unknown) => e,
    );
    expect(error).toMatchObject({ status: 429, code: "RATE_LIMITED", message: RATE_LIMITED_MESSAGE });
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it("an abort before the answer is just aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    expect(await streamAgentChat(req, { signal: controller.signal, onEvent: () => undefined })).toBe("aborted");
  });
});
