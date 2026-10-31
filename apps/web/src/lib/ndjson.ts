/**
 * The staff assistant's stream (brief §3, §7.3): `POST /api/staff/agent/chat` answers NDJSON, one
 * shared `AgentStreamEvent` JSON object per line. Only the shared schema decides what an event is:
 *
 * - Lines may arrive split across chunks, several per chunk, with empty lines (skipped) or `\r\n`.
 * - A line that isn't JSON, or isn't a known event, becomes a local `{ type: "error" }` with a generic
 *   message. Nothing throws and the raw text is never shown.
 * - Abort (the Stop button) stops reading quietly: no error.
 * - A stream that ends (or drops) without `done` gets a local `done`, and the result says it ended early.
 */
import { AgentStreamEvent, paths, type AgentChatReq } from "@needgrid/shared";
import { apiUrl, ApiClientError, NETWORK_MESSAGE, responseError, staffHeaders } from "./api";

/** How a stream finished: its own `done`, the end of the body without one, or the caller's abort. */
export type NdjsonOutcome = "done" | "ended_early" | "aborted";

export const BAD_LINE_MESSAGE = "Part of the reply couldn't be read, so it stopped there.";
export const RATE_LIMITED_MESSAGE = "You're sending messages too fast, wait a minute";

const DONE: AgentStreamEvent = { type: "done" };

/** One line → its event, a local error event, or null for a blank line. */
function parseLine(line: string): AgentStreamEvent | null {
  const text = line.endsWith("\r") ? line.slice(0, -1) : line;
  if (text.trim() === "") return null;
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    if (import.meta.env.DEV) console.error("[assistant] a stream line isn't JSON");
    return { type: "error", message: BAD_LINE_MESSAGE };
  }
  const parsed = AgentStreamEvent.safeParse(json);
  if (parsed.success) return parsed.data;
  // A contract bug for the stream's owner (B): log the problem, never the line itself.
  if (import.meta.env.DEV) console.error("[assistant] a stream line isn't an AgentStreamEvent", parsed.error.issues);
  return { type: "error", message: BAD_LINE_MESSAGE };
}

type TextReader = { read: () => Promise<string | null>; cancel: () => void };

/** A response body's bytes, as the DOM types `Response.body`. */
type Body = ReadableStream<Uint8Array<ArrayBuffer>>;

/** The body as text: TextDecoderStream where it exists, else the byte reader with a streaming TextDecoder. */
function textReader(body: Body): TextReader {
  const quietly = (promise: Promise<void>) => void promise.catch(() => undefined);
  if (typeof TextDecoderStream !== "undefined") {
    // TextDecoderStream accepts any BufferSource; widening the body's type lets it pipe through.
    const bytes: ReadableStream<BufferSource> = body;
    const reader = bytes.pipeThrough(new TextDecoderStream()).getReader();
    return {
      read: async () => {
        const { value, done } = await reader.read();
        return done ? null : value;
      },
      cancel: () => quietly(reader.cancel()),
    };
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let ended = false;
  return {
    read: async () => {
      if (ended) return null;
      const { value, done } = await reader.read();
      if (!done) return decoder.decode(value, { stream: true });
      ended = true;
      return decoder.decode();
    },
    cancel: () => quietly(reader.cancel()),
  };
}

/**
 * The body's text chunks until it ends. An abort cancels the reader at once, so a stream that has
 * gone quiet can't keep the caller waiting.
 */
async function* textChunks(body: Body, signal?: AbortSignal): AsyncGenerator<string> {
  const reader = textReader(body);
  signal?.addEventListener("abort", reader.cancel, { once: true });
  try {
    for (;;) {
      const text = await reader.read();
      if (text === null) return;
      if (text !== "") yield text;
    }
  } finally {
    signal?.removeEventListener("abort", reader.cancel);
    reader.cancel();
  }
}

/**
 * Reads an NDJSON response and calls `onEvent` once per event, in order, until `done`. Never throws.
 * Anything after `done` is ignored.
 */
export async function readNdjson(
  response: Response,
  onEvent: (event: AgentStreamEvent) => void,
  signal?: AbortSignal,
): Promise<NdjsonOutcome> {
  if (signal?.aborted) return "aborted";
  if (!response.body) {
    onEvent(DONE);
    return "ended_early";
  }
  let buffer = "";
  const deliver = (line: string): boolean => {
    const event = parseLine(line);
    if (!event) return false;
    onEvent(event);
    return event.type === "done";
  };

  try {
    for await (const chunk of textChunks(response.body, signal)) {
      if (signal?.aborted) return "aborted";
      buffer += chunk;
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (deliver(line)) return "done";
        if (signal?.aborted) return "aborted";
        newline = buffer.indexOf("\n");
      }
    }
  } catch {
    // Aborted mid-read, or the connection dropped: the reply simply ends here.
    if (signal?.aborted) return "aborted";
  }
  if (signal?.aborted) return "aborted";
  // A last line without its newline still counts.
  if (deliver(buffer)) return "done";
  onEvent(DONE);
  return "ended_early";
}

type ChatOptions = { signal: AbortSignal; onEvent: (event: AgentStreamEvent) => void };

/**
 * `POST /api/staff/agent/chat` with the staff passcode, then `readNdjson`. A refused request throws
 * an ApiClientError before any event: 401 also signs staff out (as every staff request does), 429
 * gets a plain "too fast" message, a network failure the usual one. An abort before the answer
 * resolves "aborted".
 */
export async function streamAgentChat(req: AgentChatReq, { signal, onEvent }: ChatOptions): Promise<NdjsonOutcome> {
  let res: Response;
  try {
    res = await fetch(apiUrl(paths.staff.agentChat), {
      method: "POST",
      headers: { accept: "application/x-ndjson", "content-type": "application/json", ...staffHeaders() },
      body: JSON.stringify(req),
      signal,
    });
  } catch {
    if (signal.aborted) return "aborted";
    throw new ApiClientError(0, "NETWORK", NETWORK_MESSAGE);
  }
  if (!res.ok) {
    const error = await responseError(res, { staff: true });
    if (error.code === "RATE_LIMITED") throw new ApiClientError(error.status, error.code, RATE_LIMITED_MESSAGE);
    throw error;
  }
  return readNdjson(res, onEvent, signal);
}
