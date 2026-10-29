import { cn } from "@/lib/utils";

/** One loading card shaped like a tile (States.dc.html "Loading"). */
function SkeletonCard() {
  return (
    <div
      aria-hidden="true"
      className="flex flex-col gap-3.5 rounded-2xl border bg-surface p-5.5 motion-safe:animate-pulse"
    >
      <div className="aspect-square rounded-[10px] bg-track" />
      <div className="h-4 w-[70%] rounded-md bg-track" />
      <div className="h-3 w-[45%] rounded-md bg-placeholder" />
      <div className="h-2.5 rounded-full bg-track" />
      <div className="h-11 rounded-md bg-track" />
    </div>
  );
}

type PageSkeletonProps = {
  /** Number of placeholder cards. */
  cards?: number;
  /** Screen-reader text while loading. */
  label?: string;
  className?: string;
};

/** Page-level loading state: a title bar and a grid of skeleton cards. */
export function PageSkeleton({ cards = 3, label = "Loading…", className }: PageSkeletonProps) {
  return (
    <div role="status" className={cn("mx-auto w-full max-w-300 px-4 py-8 sm:px-6", className)}>
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="mb-6 flex flex-col gap-3 motion-safe:animate-pulse">
        <div className="h-3 w-40 rounded-md bg-placeholder" />
        <div className="h-9 w-72 max-w-full rounded-md bg-track" />
      </div>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: cards }, (_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    </div>
  );
}
