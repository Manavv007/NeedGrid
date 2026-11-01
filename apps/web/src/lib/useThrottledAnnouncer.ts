import { useCallback, useEffect, useRef, useState } from "react";

/** Live regions speak at most this often; a burst of updates is read as its latest message. */
export const ANNOUNCE_INTERVAL_MS = 5_000;

type AnnouncerOptions = {
  /**
   * How a new message joins one that is still waiting. Without it the newest replaces the waiting
   * one (live tile updates: only the latest matters). The assistant joins its sentences instead, so
   * a reply is read in full, a few sentences at a time.
   */
  combine?: (waiting: string, next: string) => string;
};

/**
 * Text for one `aria-live="polite"` region, throttled: the first message shows at once, anything
 * announced within `intervalMs` of the last one waits, and when the interval is up the waiting text
 * is shown (the newest message, or all of them joined with `combine`).
 */
export function useThrottledAnnouncer(intervalMs: number = ANNOUNCE_INTERVAL_MS, { combine }: AnnouncerOptions = {}) {
  const [message, setMessage] = useState("");
  const lastShownAt = useRef<number | null>(null);
  const waiting = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const combineRef = useRef(combine);
  useEffect(() => {
    combineRef.current = combine;
  });

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  const announce = useCallback(
    (text: string) => {
      const join = combineRef.current;
      waiting.current = waiting.current !== null && join ? join(waiting.current, text) : text;
      if (timer.current !== null) return; // already scheduled: it will pick up the waiting text
      const show = () => {
        timer.current = null;
        lastShownAt.current = Date.now();
        setMessage(waiting.current ?? "");
        waiting.current = null;
      };
      const wait = lastShownAt.current === null ? 0 : lastShownAt.current + intervalMs - Date.now();
      if (wait <= 0) show();
      else timer.current = setTimeout(show, wait);
    },
    [intervalMs],
  );

  return { message, announce };
}
