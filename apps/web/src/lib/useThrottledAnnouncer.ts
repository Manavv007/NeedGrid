import { useCallback, useEffect, useRef, useState } from "react";

/** Live regions speak at most this often; a burst of updates is read as its latest message. */
export const ANNOUNCE_INTERVAL_MS = 5_000;

/**
 * Text for one `aria-live="polite"` region, throttled: the first message shows at once, anything
 * announced within `intervalMs` of the last one waits, and only the newest waiting message is shown
 * when the interval is up.
 */
export function useThrottledAnnouncer(intervalMs: number = ANNOUNCE_INTERVAL_MS) {
  const [message, setMessage] = useState("");
  const lastShownAt = useRef<number | null>(null);
  const waiting = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  const announce = useCallback(
    (text: string) => {
      waiting.current = text;
      if (timer.current !== null) return; // already scheduled: it will pick up the newest text
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
