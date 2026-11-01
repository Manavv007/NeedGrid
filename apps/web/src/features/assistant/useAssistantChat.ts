import type { AgentChatReq, AgentStreamEvent } from "@needgrid/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiClientError } from "@/lib/api";
import { clearChatTranscript, loadChatTranscript, saveChatTranscript } from "@/lib/chatTranscript";
import { streamAgentChat, type NdjsonOutcome } from "@/lib/ndjson";
import { addProposedAction } from "@/lib/queries";
import { useThrottledAnnouncer } from "@/lib/useThrottledAnnouncer";
import { errorMessage } from "../staff/errorMessage";
import {
  applyEvent,
  chatRequest,
  endTurn,
  errorItem,
  itemsFromTranscript,
  lastTurn,
  MAX_MESSAGE_LENGTH,
  noteItem,
  sentenceEnd,
  transcriptOf,
  userItem,
  type ChatItem,
} from "./chatItems";

/** Screen readers hear the reply a few sentences at a time, at most this often. */
export const CHAT_ANNOUNCE_MS = 2_000;
export const ENDED_EARLY_NOTE = "The reply ended early.";
export const STOPPED_NOTE = "Stopped.";
const NOT_SENT = "That message couldn't be sent. Please shorten it and try again.";
const NO_ANSWER = "The assistant didn't answer. Please try again.";

const joinSpoken = (waiting: string, next: string) => `${waiting} ${next}`;

/**
 * The assistant conversation for one charity: one reply streaming at a time, Stop, "New chat", and
 * the text kept in this tab (lib/chatTranscript.ts). Each reply's events are applied in order
 * (chatItems.ts → applyEvent); a proposed action also joins the pending list at once. An `error`
 * event ends the reply there (the input is usable again); afterwards the actions are refetched.
 */
export function useAssistantChat(orgId: string) {
  const queryClient = useQueryClient();
  const [items, setItemsState] = useState<ChatItem[]>(() => itemsFromTranscript(loadChatTranscript(orgId)));
  const itemsRef = useRef<readonly ChatItem[]>(items);
  const [streaming, setStreaming] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const stoppedByUser = useRef(false);
  /** The current reply's text, and how much of it has been read out. */
  const spoken = useRef({ text: "", upTo: 0 });
  const { message: announcement, announce } = useThrottledAnnouncer(CHAT_ANNOUNCE_MS, { combine: joinSpoken });

  const setItems = useCallback((next: (items: readonly ChatItem[]) => ChatItem[]) => {
    itemsRef.current = next(itemsRef.current);
    setItemsState([...itemsRef.current]);
  }, []);

  // Leaving the page stops the reply.
  useEffect(() => () => controller.current?.abort(), []);

  /** Read out the reply's completed sentences (or, at the end, everything not read yet). */
  function speak(all: boolean): void {
    const { text, upTo } = spoken.current;
    const end = all ? text.length : sentenceEnd(text, upTo);
    if (end <= upTo) return;
    spoken.current = { text, upTo: end };
    const sentences = text.slice(upTo, end).trim();
    if (sentences) announce(sentences);
  }

  function handleEvent(event: AgentStreamEvent, turn: number, requestText: string, abort: AbortController): void {
    switch (event.type) {
      case "text":
        spoken.current = { ...spoken.current, text: spoken.current.text + event.delta };
        speak(false);
        break;
      case "tool_call":
        speak(true);
        announce(event.summary);
        break;
      case "tool_result":
        announce(event.summary);
        break;
      case "action_proposed":
        addProposedAction(queryClient, event.action);
        speak(true);
        announce(`An approval card is waiting: ${event.action.preview.title}.`);
        break;
      case "error":
        // The error bubble is an alert of its own. The reply is over: stop reading.
        abort.abort();
        break;
      case "done":
        break;
    }
    setItems((current) => applyEvent(current, event, turn, requestText));
  }

  function finish(turn: number, outcome: NdjsonOutcome | null, failure: unknown): void {
    controller.current = null;
    if (failure instanceof ApiClientError && failure.status === 401) {
      // Signed out (lib/api.ts already sent staff to the login page): keep nothing.
      clearChatTranscript();
      setStreaming(false);
      return;
    }
    speak(true);
    setItems((current) => {
      const ended = endTurn(current, turn);
      if (failure !== null) return [...ended, errorItem(turn, errorMessage(failure, NO_ANSWER))];
      if (outcome === "ended_early") return [...ended, noteItem(turn, ENDED_EARLY_NOTE)];
      if (outcome === "aborted" && stoppedByUser.current) return [...ended, noteItem(turn, STOPPED_NOTE)];
      return ended;
    });
    setStreaming(false);
    saveChatTranscript(orgId, transcriptOf(itemsRef.current));
    // `done` (or any end): the server may have proposed or changed actions.
    void queryClient.invalidateQueries({ queryKey: ["actions"] });
  }

  /**
   * Sends one staff message and streams the reply. True when it started; false when nothing was sent
   * (empty, too long, or a reply is still streaming).
   */
  function send(raw: string): boolean {
    const text = raw.trim();
    if (text === "" || text.length > MAX_MESSAGE_LENGTH || controller.current) return false;
    const turn = lastTurn(itemsRef.current) + 1;
    const req = chatRequest(itemsRef.current, text);
    if (!req) {
      setItems((current) => [...current, errorItem(turn, NOT_SENT)]);
      return false;
    }
    const abort = new AbortController();
    controller.current = abort;
    stoppedByUser.current = false;
    spoken.current = { text: "", upTo: 0 };
    setItems((current) => [...current, userItem(turn, text)]);
    setStreaming(true);
    void stream(req, turn, text, abort);
    return true;
  }

  async function stream(req: AgentChatReq, turn: number, text: string, abort: AbortController): Promise<void> {
    let outcome: NdjsonOutcome | null = null;
    let failure: unknown = null;
    try {
      outcome = await streamAgentChat(req, {
        signal: abort.signal,
        onEvent: (event) => handleEvent(event, turn, text, abort),
      });
    } catch (error) {
      failure = error;
    }
    finish(turn, outcome, failure);
  }

  /** Stop: ends the reply where it is (no error). */
  function stop(): void {
    stoppedByUser.current = true;
    controller.current?.abort();
  }

  /** Clears the conversation (not while a reply is streaming). Pending actions stay pending. */
  function newChat(): void {
    if (controller.current) return;
    setItems(() => []);
    spoken.current = { text: "", upTo: 0 };
    clearChatTranscript();
  }

  return { items, streaming, announcement, send, stop, newChat };
}

export type AssistantChat = ReturnType<typeof useAssistantChat>;
