import { Check, ImageIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { IntakeSteps } from "./IntakeSteps";
import { useFocusHeading } from "./useFocusHeading";

/**
 * What the AI is doing, timed to a cold intake (15 to 20 s, HANDOFF note from B). The server doesn't
 * report progress, so these are paced estimates; the last one stays until the answer arrives.
 */
export const ANALYSE_STAGES = [
  { label: "Reading your list…", done: "Read your list", startsAtMs: 0 },
  { label: "Finding real products…", done: "Found real products", startsAtMs: 6_000 },
  { label: "Comparing prices…", done: "Compared prices", startsAtMs: 12_000 },
] as const;

type IntakeAnalysingProps = {
  /** "uploading" while the photo goes to Cloudinary, then "reading" while the AI works. */
  phase: "uploading" | "reading";
  uploadPercent: number;
  previewUrl: string | null;
  onCancel: () => void;
};

export function IntakeAnalysing({ phase, uploadPercent, previewUrl, onCancel }: IntakeAnalysingProps) {
  const headingRef = useFocusHeading(true);

  return (
    <section aria-labelledby="intake-analysing-heading" className="flex flex-col gap-5">
      <IntakeSteps current={1} />
      <div className="flex flex-col gap-5 rounded-2xl border bg-surface p-5 sm:p-6">
        {previewUrl ? (
          <img
            src={previewUrl}
            alt="What you uploaded"
            className="max-h-64 w-full rounded-xl border bg-placeholder object-contain"
          />
        ) : null}
        {phase === "uploading" && !previewUrl ? (
          <div
            aria-hidden="true"
            className="flex h-40 items-center justify-center gap-2 rounded-xl bg-placeholder text-sm text-placeholder-icon"
          >
            <ImageIcon className="size-6" /> Your photo
          </div>
        ) : null}
        <h1
          id="intake-analysing-heading"
          ref={headingRef}
          tabIndex={-1}
          className="text-2xl font-extrabold tracking-[-0.02em] outline-none"
        >
          {phase === "uploading" ? "Uploading your photo…" : "Working on your list…"}
        </h1>
        {phase === "uploading" ? <UploadProgress percent={uploadPercent} /> : <StagedProgress />}
        <p className="text-sm text-soft">This takes 10 to 30 seconds. Nothing is published yet.</p>
        <div>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </section>
  );
}

function UploadProgress({ percent }: { percent: number }) {
  return (
    <div className="flex flex-col gap-2">
      <div
        role="progressbar"
        aria-label="Photo upload"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={`${percent}% uploaded`}
        className="h-2.5 overflow-hidden rounded-full bg-track"
      >
        <div
          className="h-full bg-primary transition-[width] duration-300 motion-reduce:transition-none"
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="text-sm text-soft">{percent}% uploaded</p>
    </div>
  );
}

/** The staged list from IntakeStart.dc.html: done stages get a check, the current one a spinner. */
function StagedProgress() {
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    const timers = ANALYSE_STAGES.slice(1).map((stage, index) =>
      window.setTimeout(() => setCurrent(index + 1), stage.startsAtMs),
    );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, []);

  const active = ANALYSE_STAGES[current] ?? ANALYSE_STAGES[0];

  return (
    <>
      <p aria-live="polite" className="sr-only">
        {active.label}
      </p>
      <ol className="flex flex-col gap-3 text-[15px]">
        {ANALYSE_STAGES.map((stage, index) => {
          const done = index < current;
          const now = index === current;
          return (
            <li
              key={stage.label}
              className={cn("flex items-center gap-3", done || now ? "text-foreground" : "text-muted-foreground")}
            >
              {done ? (
                <Check aria-hidden="true" className="size-4.5 text-success" strokeWidth={3} />
              ) : now ? (
                <span
                  aria-hidden="true"
                  className="size-4.5 rounded-full border-[3px] border-held border-t-primary motion-safe:animate-spin"
                />
              ) : (
                <span aria-hidden="true" className="size-4.5 rounded-full border-2 border-border-strong" />
              )}
              <span className={now ? "font-bold" : undefined}>
                {done ? stage.done : stage.label}
                {done ? <span className="sr-only"> (done)</span> : null}
              </span>
            </li>
          );
        })}
      </ol>
    </>
  );
}
