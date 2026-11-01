import { z } from "zod";

/**
 * The assistant chat's text, kept in this tab's sessionStorage so it survives leaving the page or a
 * reload. Text only (staff and assistant messages): never actions, tool results or anything with
 * amounts. Tied to the charity it was written for, and cleared with the rest of the staff data on
 * sign-in, sign-out and a 401 (lib/queries.ts → clearStaffQueries).
 */
export const CHAT_TRANSCRIPT_STORAGE = "needgrid.assistantChat";

/** The newest messages kept; the API only ever receives the last 30 anyway. */
const MAX_STORED_MESSAGES = 60;

export type TranscriptMessage = { role: "user" | "assistant"; text: string };

const Stored = z.object({
  orgId: z.string(),
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string() })),
});

export function loadChatTranscript(orgId: string): TranscriptMessage[] {
  try {
    const raw = sessionStorage.getItem(CHAT_TRANSCRIPT_STORAGE);
    if (raw === null) return [];
    const parsed = Stored.safeParse(JSON.parse(raw));
    return parsed.success && parsed.data.orgId === orgId ? parsed.data.messages : [];
  } catch {
    return [];
  }
}

export function saveChatTranscript(orgId: string, messages: readonly TranscriptMessage[]): void {
  try {
    if (messages.length === 0) {
      sessionStorage.removeItem(CHAT_TRANSCRIPT_STORAGE);
      return;
    }
    const stored: z.infer<typeof Stored> = { orgId, messages: messages.slice(-MAX_STORED_MESSAGES) };
    sessionStorage.setItem(CHAT_TRANSCRIPT_STORAGE, JSON.stringify(stored));
  } catch {
    // Storage full or disabled: the chat still works, it just won't survive a reload.
  }
}

export function clearChatTranscript(): void {
  try {
    sessionStorage.removeItem(CHAT_TRANSCRIPT_STORAGE);
  } catch {
    // Nothing stored, nothing to clear.
  }
}
