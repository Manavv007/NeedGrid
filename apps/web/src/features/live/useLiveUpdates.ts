import { isOwnChange } from "@/lib/ownChanges";
import { useOrgStream, type NeedUpdate, type StreamStatus } from "@/lib/sse";
import { useThrottledAnnouncer } from "@/lib/useThrottledAnnouncer";
import { liveMessage } from "./liveMessage";

type LiveUpdatesOptions = {
  /** Only announce this need (the need page). */
  needId?: string;
  /** Don't announce anything: the person is paying, so the changes are theirs. */
  quiet?: boolean;
  /** Runs for every update, announced or not (highlights, the big-screen ticker). */
  onUpdate?: (update: NeedUpdate) => void;
};

export type LiveUpdates = { status: StreamStatus; announcement: string };

/**
 * A page's live updates: the shared stream (cache patching), plus the text for the page's one
 * polite live region, throttled to one message per 5 s. Changes this tab made itself are skipped.
 */
export function useLiveUpdates(
  slug: string,
  { needId, quiet = false, onUpdate }: LiveUpdatesOptions = {},
): LiveUpdates {
  const { message, announce } = useThrottledAnnouncer();
  const status = useOrgStream(slug, (update) => {
    onUpdate?.(update);
    if (quiet || (needId !== undefined && update.card.id !== needId) || isOwnChange(update.card.id)) return;
    const text = liveMessage(update);
    if (text) announce(text);
  });
  return { status, announcement: message };
}
