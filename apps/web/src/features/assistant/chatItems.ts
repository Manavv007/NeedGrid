import { AgentChatReq, ReconcileReport, type AgentAction, type AgentStreamEvent } from "@needgrid/shared";
import type { TranscriptMessage } from "@/lib/chatTranscript";

/** `AgentChatReq` limits: the newest 30 messages, each at most 4000 characters. */
export const MAX_HISTORY_MESSAGES = 30;
export const MAX_MESSAGE_LENGTH = 4_000;

/**
 * One thing in the conversation. `turn` groups everything that answered one staff message. Text
 * is always shown as plain text; tool lines, cards and notes are never sent back to the API.
 */
export type ChatItem =
  | { kind: "user"; id: string; turn: number; text: string }
  | { kind: "assistant"; id: string; turn: number; text: string }
  | {
      kind: "tool";
      id: string;
      turn: number;
      tool: string;
      summary: string;
      state: "running" | "done" | "stopped";
      /** The server's reconcile report when `tool` is "reconcile" and `data` parsed as one. */
      report: ReconcileReport | null;
    }
  /** An approval card. `requestText` is the staff message it answered ("Ask again" fills it back in). */
  | { kind: "action"; id: string; turn: number; action: AgentAction; requestText: string }
  | { kind: "error"; id: string; turn: number; message: string; fromStream: boolean }
  | { kind: "note"; id: string; turn: number; text: string };

let nextId = 0;
const newId = () => `chat-${(nextId += 1)}`;

/** The chat as it was saved (text only): every staff message starts a turn. */
export function itemsFromTranscript(messages: readonly TranscriptMessage[]): ChatItem[] {
  let turn = 0;
  return messages.map((message) => {
    if (message.role === "user") turn += 1;
    return { kind: message.role, id: newId(), turn, text: message.text };
  });
}

/** What may be saved: the staff and assistant text, nothing else. */
export function transcriptOf(items: readonly ChatItem[]): TranscriptMessage[] {
  return items.flatMap((item) =>
    item.kind === "user" || item.kind === "assistant" ? [{ role: item.kind, text: item.text }] : [],
  );
}

export const lastTurn = (items: readonly ChatItem[]) => items.reduce((max, item) => Math.max(max, item.turn), 0);

export function userItem(turn: number, text: string): ChatItem {
  return { kind: "user", id: newId(), turn, text };
}

export function errorItem(turn: number, message: string, fromStream = false): ChatItem {
  return { kind: "error", id: newId(), turn, message, fromStream };
}

export function noteItem(turn: number, text: string): ChatItem {
  return { kind: "note", id: newId(), turn, text };
}

function reportOf(tool: string, data: unknown): ReconcileReport | null {
  if (tool !== "reconcile") return null;
  const parsed = ReconcileReport.safeParse(data);
  return parsed.success ? parsed.data : null;
}

/**
 * The conversation after one stream event of `turn`:
 * - `text` grows the turn's current assistant bubble (a new bubble after a tool line or card);
 * - `tool_call` adds a running status line; `tool_result` finishes the newest running line for that
 *   tool (or adds a finished one), with the reconcile report when it parses;
 * - `action_proposed` adds the approval card once per action id;
 * - `error` adds an error bubble; `done` changes nothing.
 */
export function applyEvent(
  items: readonly ChatItem[],
  event: AgentStreamEvent,
  turn: number,
  requestText: string,
): ChatItem[] {
  switch (event.type) {
    case "text": {
      const last = items.at(-1);
      if (last?.kind === "assistant" && last.turn === turn) {
        return [...items.slice(0, -1), { ...last, text: last.text + event.delta }];
      }
      return [...items, { kind: "assistant", id: newId(), turn, text: event.delta }];
    }
    case "tool_call":
      return [
        ...items,
        { kind: "tool", id: newId(), turn, tool: event.tool, summary: event.summary, state: "running", report: null },
      ];
    case "tool_result": {
      const report = reportOf(event.tool, event.data);
      const index = items.findLastIndex(
        (item) => item.kind === "tool" && item.turn === turn && item.tool === event.tool && item.state === "running",
      );
      const found = items[index];
      if (found?.kind === "tool") {
        const done: ChatItem = { ...found, summary: event.summary, state: "done", report };
        return [...items.slice(0, index), done, ...items.slice(index + 1)];
      }
      return [
        ...items,
        { kind: "tool", id: newId(), turn, tool: event.tool, summary: event.summary, state: "done", report },
      ];
    }
    case "action_proposed":
      if (items.some((item) => item.kind === "action" && item.action.id === event.action.id)) return [...items];
      return [...items, { kind: "action", id: newId(), turn, action: event.action, requestText }];
    case "error":
      return [...items, errorItem(turn, event.message, true)];
    case "done":
      return [...items];
  }
}

/** The turn is over: status lines still spinning stop spinning. */
export function endTurn(items: readonly ChatItem[], turn: number): ChatItem[] {
  return items.map((item) =>
    item.kind === "tool" && item.turn === turn && item.state === "running" ? { ...item, state: "stopped" } : item,
  );
}

/**
 * The request for a new staff message: the text history only (staff messages and the assistant's
 * replies, one assistant message per turn), the newest 30, validated with the shared schema. Null
 * when it can't be valid (an empty or too long message).
 */
export function chatRequest(items: readonly ChatItem[], text: string): AgentChatReq | null {
  const messages: AgentChatReq["messages"] = [];
  let assistantTurn: number | null = null;
  for (const item of items) {
    if (item.kind === "user") {
      messages.push({ role: "user", content: item.text });
      assistantTurn = null;
    } else if (item.kind === "assistant" && item.text.trim() !== "") {
      const previous = messages.at(-1);
      if (previous?.role === "assistant" && assistantTurn === item.turn) {
        previous.content = `${previous.content}\n\n${item.text}`.slice(0, MAX_MESSAGE_LENGTH);
      } else {
        messages.push({ role: "assistant", content: item.text.slice(0, MAX_MESSAGE_LENGTH) });
        assistantTurn = item.turn;
      }
    }
  }
  messages.push({ role: "user", content: text });
  const parsed = AgentChatReq.safeParse({ messages: messages.slice(-MAX_HISTORY_MESSAGES) });
  return parsed.success ? parsed.data : null;
}

/**
 * Where the last complete sentence of `text` ends, looking only after `from` (so a reply is read out
 * a sentence at a time while it streams). A sentence ends at . ! ? or … followed by a space or a new
 * line, so "$14." in the middle of "$14.00" never counts. -1 when there is none yet.
 */
export function sentenceEnd(text: string, from: number): number {
  let end = -1;
  const pattern = /[.!?…]["')\]]*(?=\s)/g;
  pattern.lastIndex = from;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) end = match.index + match[0].length;
  return end;
}
