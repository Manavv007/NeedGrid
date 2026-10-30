import { useEffect, useEffectEvent, useState } from "react";
import { cn } from "@/lib/utils";

/** How long "Just now · … is fully funded" stays up before it fades out. */
export const TICKER_VISIBLE_MS = 15_000;
const FADE_MS = 700;

type FundedTickerProps = {
  /** e.g. "Diapers, size 4 is fully funded. Thank you, 6 donors!" */
  text: string;
  /** Called once it has faded out. Give each new message a new `key` to restart the timers. */
  onDone: () => void;
};

/**
 * The bottom strip from BigScreen.dc.html. Visual only: the page's live region already announces
 * "… is fully funded" to screen readers.
 */
export function FundedTicker({ text, onDone }: FundedTickerProps) {
  const [fading, setFading] = useState(false);
  const finish = useEffectEvent(onDone);

  useEffect(() => {
    const fade = setTimeout(() => setFading(true), TICKER_VISIBLE_MS);
    const done = setTimeout(() => finish(), TICKER_VISIBLE_MS + FADE_MS);
    return () => {
      clearTimeout(fade);
      clearTimeout(done);
    };
  }, []);

  return (
    <p
      className={cn(
        "flex shrink-0 items-center gap-4 rounded-[0.875rem] bg-staff-header px-6 py-4.5 text-2xl text-primary-foreground transition-opacity duration-700 motion-reduce:transition-none",
        fading && "opacity-0",
      )}
    >
      <span className="shrink-0 rounded-full bg-success px-3.5 py-1.5 font-extrabold">Just now</span>
      <span className="min-w-0">{text}</span>
    </p>
  );
}
