import type { AgentStreamEvent } from "@needgrid/shared";
import { HttpResponse } from "msw";

/**
 * An assistant reply the test drives line by line: `send` events (or raw lines), then `close`.
 * `response()` is what an MSW handler returns for `POST /api/staff/agent/chat`.
 */
export function controlledNdjson() {
  const encoder = new TextEncoder();
  const state: { controller: ReadableStreamDefaultController<Uint8Array> | null; closed: boolean } = {
    controller: null,
    closed: false,
  };
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      state.controller = controller;
    },
    cancel() {
      state.closed = true;
    },
  });
  return {
    response: () => new HttpResponse(body, { headers: { "content-type": "application/x-ndjson" } }),
    send(...lines: Array<AgentStreamEvent | string>) {
      if (state.closed) return;
      for (const line of lines) {
        state.controller?.enqueue(encoder.encode(`${typeof line === "string" ? line : JSON.stringify(line)}\n`));
      }
    },
    close() {
      if (state.closed) return;
      state.closed = true;
      state.controller?.close();
    },
  };
}
