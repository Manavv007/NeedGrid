import type { NeedCard, OrgPageRes } from "@needgrid/shared";
import { useEffect, useRef, useState } from "react";
import { QrCode } from "@/components/QrCode";
import { LiveStatus } from "@/features/live/LiveStatus";
import { becameFunded } from "@/features/live/liveMessage";
import { useLiveUpdates } from "@/features/live/useLiveUpdates";
import { useRecentIds } from "@/features/live/useRecentIds";
import { formatDonorCount, formatUsdWhole } from "@/lib/format";
import { orgPath } from "@/lib/links";
import { REDUCED_MOTION_QUERY, useMediaQuery } from "@/lib/useMediaQuery";
import { useWakeLock } from "@/lib/useWakeLock";
import { cn } from "@/lib/utils";
import { bigScreenNeeds } from "./bigScreenMode";
import { BigTile } from "./BigTile";
import { FundedTicker } from "./FundedTicker";
import { useAutoScroll } from "./useAutoScroll";

/** A tile that was just funded stays in its place (green, pulsing) this long, then joins the funded ones. */
const JUST_FUNDED_LINGER_MS = 8_000;

type Tick = { id: number; text: string };

function fundedThanks(card: NeedCard): string {
  const thanks = card.donorCount > 0 ? `Thank you, ${formatDonorCount(card.donorCount)}!` : "Thank you!";
  return `${card.title} is fully funded. ${thanks}`;
}

/** Every rem on the page scales with the screen while the wall is up (globals.css). */
function useWallScale(): void {
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.display = "wall";
    return () => {
      delete root.dataset.display;
    };
  }, []);
}

/**
 * `/o/:slug?display=1` (BigScreen.dc.html): the wall shown on a TV at the charity or in the demo.
 * No site header, filters or tabs: the charity, what it raised, a QR code to the tile wall, and big
 * tiles that fill live. Designed for 1920×1080; every size is in rem and scales down to 1280×720.
 */
export function BigScreen({ page }: { page: OrgPageRes }) {
  const { org, stats, needs } = page;
  const justFunded = useRecentIds(JUST_FUNDED_LINGER_MS);
  const [tick, setTick] = useState<Tick | null>(null);
  const live = useLiveUpdates(org.slug, {
    onUpdate: (update) => {
      if (!becameFunded(update)) return;
      justFunded.mark(update.card.id);
      setTick((current) => ({ id: (current?.id ?? 0) + 1, text: fundedThanks(update.card) }));
    },
  });
  useWakeLock();
  useWallScale();
  const reducedMotion = useMediaQuery(REDUCED_MOTION_QUERY, false);
  const wall = useRef<HTMLDivElement>(null);
  useAutoScroll(wall, !reducedMotion);

  const tiles = bigScreenNeeds(needs, justFunded.ids);
  // The plain tile wall (no display=1, no filters): what a donor's phone should open.
  const wallUrl = new URL(orgPath(org.slug), window.location.origin).href;

  return (
    <div className="flex h-svh flex-col gap-10 overflow-hidden px-6 py-6 sm:px-16 sm:py-14">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-x-10 gap-y-6">
        <div className="min-w-0">
          <p className="mb-2 text-2xl font-semibold text-muted-foreground">Help us fill these shelves</p>
          <h1 className="text-[4.5rem] leading-none font-extrabold tracking-[-0.035em]">{org.name}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-7">
          <div className="text-right">
            <p className="text-[1.375rem] text-muted-foreground">Raised so far</p>
            <p className="mt-1 text-[4rem] leading-none font-extrabold tracking-[-0.03em] text-primary">
              {formatUsdWhole(stats.raisedCents)}
            </p>
          </div>
          <div className="flex items-center gap-4 rounded-[1rem] border bg-surface p-4">
            <QrCode
              value={wallUrl}
              label={`QR code: scan to see what ${org.name} needs and fund an item`}
              className="size-[8.25rem] shrink-0 rounded-lg"
            />
            <p className="max-w-40 text-[1.625rem] leading-[1.2] font-extrabold">Scan to fund an item</p>
          </div>
        </div>
      </header>

      {/* Reduced motion: no auto-scroll, so the wall can be scrolled by hand instead. */}
      <div ref={wall} className={cn("-m-3 min-h-0 flex-1 p-3", reducedMotion ? "overflow-y-auto" : "overflow-hidden")}>
        {tiles.length > 0 ? (
          <ul className="grid grid-cols-1 gap-7 sm:grid-cols-2 lg:grid-cols-4">
            {tiles.map((need) => (
              <li key={need.id}>
                <BigTile need={need} highlight={justFunded.ids.has(need.id)} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="pt-10 text-center text-[2.5rem] font-extrabold text-success">
            Everything on our list is funded. Thank you!
          </p>
        )}
      </div>

      {tick ? <FundedTicker key={tick.id} text={tick.text} onDone={() => setTick(null)} /> : null}
      <LiveStatus {...live} />
    </div>
  );
}
