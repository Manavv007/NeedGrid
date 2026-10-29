import { useEffect, useState } from "react";

export const WAKING_UP_DELAY_MS = 3_000;

/**
 * Render while a query is loading. Shows nothing for the first 3 s, then explains that the free
 * server is waking up (Render's free tier sleeps; the first request can take up to a minute).
 */
export function WakingUp() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(true), WAKING_UP_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div aria-live="polite">
      {visible ? (
        <section
          aria-label="Waking up the server"
          className="mx-auto flex max-w-sm flex-col items-center gap-3.5 rounded-2xl border bg-surface p-6 text-center"
        >
          <span
            aria-hidden="true"
            className="size-12 rounded-full border-[5px] border-held border-t-primary motion-safe:animate-spin"
          />
          <h2 className="text-xl font-extrabold">Waking up the server…</h2>
          <p className="max-w-70 text-sm leading-normal text-soft">
            Our free server naps when it's quiet. The first visit can take up to a minute. Thanks for waiting.
          </p>
        </section>
      ) : null}
    </div>
  );
}
