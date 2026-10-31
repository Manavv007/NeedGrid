/**
 * AG Studio LLM adapter for NeedGrid (AGENT_B_AI_DATA.md §10.3, option B). Runs in the browser and posts each turn
 * to OUR relay (POST /api/ai/dashboard-complete), which calls Gemini with the server's key. No key here.
 *
 * The relay answers one JSON object per turn (text + tool calls), not a stream, so the server can fall back to
 * another Gemini model when one is out of free quota. This adapter replays that answer as Studio's events.
 * Error handling follows the AG Studio docs adapter: a failed turn rejects `complete` once, and the rejection is
 * marked observed so a consumer that stops reading the stream never sees an unhandled rejection.
 */
import { ApiError, paths } from "@needgrid/shared";
import type {
  AgAiEvent,
  AgAiOutputItem,
  AgLlmAdapter,
  AgLlmExecuteTurnOptions,
  AgLlmRequest,
  AgLlmResponse,
  AgLlmResponseHandler,
} from "ag-studio";
import { z } from "zod";
import { apiUrl } from "@/lib/api";

/** Must match apps/api/src/ai/dashboardRelay.ts → RelayRes. */
const RelayRes = z.object({
  text: z.string(),
  toolCalls: z.array(z.object({ callId: z.string(), name: z.string(), arguments: z.string() })),
  finishReason: z.string(),
  usage: z.object({ inputTokens: z.number(), outputTokens: z.number() }).nullable(),
  model: z.string(),
});
export type RelayRes = z.infer<typeof RelayRes>;

let seq = 0;
const newId = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${(seq++).toString(36)}`;

/** What we send: Studio's request minus `model` (the server always picks its own Gemini model). */
export function toRelayBody(request: AgLlmRequest) {
  return {
    instructions: request.instructions,
    input: request.input,
    tools: (request.tools ?? []).map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
      ...(t.kind ? { kind: t.kind } : {}),
    })),
    toolChoice: request.toolChoice,
    responseFormat: request.responseFormat,
  };
}

/** The relay's answer → Studio's events (one text message, then each tool call) and final response. */
export function toTurn(res: RelayRes): { events: AgAiEvent[]; response: AgLlmResponse } {
  const events: AgAiEvent[] = [];
  const output: AgAiOutputItem[] = [];
  if (res.text) {
    const messageId = newId("msg");
    events.push(
      { type: "TEXT_MESSAGE_START", messageId, role: "assistant" },
      { type: "TEXT_MESSAGE_CONTENT", messageId, delta: res.text },
      { type: "TEXT_MESSAGE_END", messageId },
    );
    output.push({
      id: messageId,
      kind: "output",
      type: "message",
      role: "assistant",
      status: "completed",
      content: [{ type: "text", text: res.text, annotations: [] }],
    });
  }
  for (const call of res.toolCalls) {
    events.push(
      { type: "TOOL_CALL_START", toolCallId: call.callId, toolCallName: call.name },
      { type: "TOOL_CALL_ARGS", toolCallId: call.callId, delta: call.arguments },
      { type: "TOOL_CALL_END", toolCallId: call.callId },
    );
    output.push({
      id: newId("fc"),
      kind: "output",
      type: "function_call",
      callId: call.callId,
      name: call.name,
      arguments: call.arguments,
      status: "completed",
    });
  }
  return {
    events,
    response: {
      id: newId("resp"),
      createdAt: Date.now(),
      output,
      status: "completed",
      model: res.model,
      ...(res.usage
        ? {
            usage: {
              inputTokens: res.usage.inputTokens,
              outputTokens: res.usage.outputTokens,
              totalTokens: res.usage.inputTokens + res.usage.outputTokens,
            },
          }
        : {}),
    },
  };
}

/** A readable message for a failed turn (the API's own wording when it sent one). */
async function errorFrom(res: Response): Promise<Error> {
  const body = ApiError.safeParse(await res.json().catch(() => null));
  if (body.success) return new Error(body.data.error.message);
  if (res.status === 429) return new Error("Too many questions at once. Try again in a minute.");
  return new Error(`The AI didn't answer (HTTP ${res.status}). Try again.`);
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export function geminiAdapter(opts: { endpoint?: string; fetch?: FetchLike } = {}): AgLlmAdapter {
  const endpoint = opts.endpoint ?? apiUrl(paths.dashboardComplete);
  const doFetch: FetchLike = opts.fetch ?? ((input, init) => fetch(input, init));

  return {
    executeTurn(request: AgLlmRequest, options?: AgLlmExecuteTurnOptions): AgLlmResponseHandler {
      // The request starts now, not when the stream is first read, so `complete` settles either way.
      const turn = (async () => {
        const res = await doFetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify(toRelayBody(request)),
          signal: options?.signal,
        });
        if (!res.ok) throw await errorFrom(res);
        return toTurn(RelayRes.parse(await res.json()));
      })();
      const complete = turn.then((t) => t.response);
      // A failed turn is reported once, through `complete`; mark it observed for a reader that only
      // consumes the stream (Studio ends the run on the rejection when it awaits `complete`).
      void complete.catch(() => {});

      async function* run(): AsyncGenerator<AgAiEvent> {
        let events: AgAiEvent[];
        try {
          events = (await turn).events;
        } catch {
          return; // surfaced through `complete`
        }
        yield* events;
      }

      const iterator = run();
      return { stream: { [Symbol.asyncIterator]: () => iterator }, complete };
    },
  };
}

/** GET /api/ai/dashboard-complete → whether to show the AI chat at all (§10.4). Never throws. */
export async function isDashboardAiEnabled(opts: { fetch?: FetchLike; signal?: AbortSignal } = {}): Promise<boolean> {
  const doFetch: FetchLike = opts.fetch ?? ((input, init) => fetch(input, init));
  try {
    const res = await doFetch(apiUrl(paths.dashboardComplete), { method: "GET", signal: opts.signal });
    if (!res.ok) return false;
    const body = z.object({ enabled: z.boolean() }).safeParse(await res.json());
    return body.success && body.data.enabled;
  } catch {
    return false;
  }
}
