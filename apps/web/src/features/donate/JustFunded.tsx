import type { NeedCard } from "@needgrid/shared";
import { Check } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { needPath, orgPath } from "@/lib/links";
import { NextNeedCard } from "./NextNeedCard";

type JustFundedProps = {
  /** From `409 FULLY_FUNDED` details (FullyFundedDetails); null when nothing else is open. */
  nextNeed: NeedCard | null;
  orgSlug: string;
};

/** Replaces the donate panel when someone else covered the item first (JustFundedPhone.dc.html). */
export function JustFunded({ nextNeed, orgSlug }: JustFundedProps) {
  const titleId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);

  // The button the donor pressed is gone; keep focus (and the screen reader) on what happened.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-badge-success-bg text-success"
        >
          <Check className="size-5.5" strokeWidth={3} />
        </span>
        <div>
          <h2
            id={titleId}
            ref={headingRef}
            tabIndex={-1}
            className="text-xl font-extrabold tracking-[-0.02em] outline-none"
          >
            This item was just fully funded!
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">Someone beat you to it. Nothing was charged.</p>
        </div>
      </div>

      {nextNeed ? (
        <>
          <p className="text-sm font-bold">Want to fund the next most urgent item?</p>
          <NextNeedCard need={nextNeed} />
          <Button asChild size="lg">
            <Link to={needPath(nextNeed.orgSlug, nextNeed.id, { donate: true })}>Fund {nextNeed.title}</Link>
          </Button>
        </>
      ) : (
        <p className="text-sm leading-normal text-soft">
          Everything else on this list is covered right now too. Thank you for wanting to help!
        </p>
      )}
      <Link
        to={orgPath(orgSlug)}
        className="inline-flex min-h-11 items-center justify-center text-[15px] font-semibold"
      >
        See everything still needed
      </Link>
    </section>
  );
}
