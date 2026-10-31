import type { NeedCard } from "@needgrid/shared";
import { FilePen, Hourglass } from "lucide-react";
import { useRef } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatLeft, formatUsd } from "@/lib/format";
import { usePatchNeed } from "@/lib/queries";
import { errorMessage } from "../errorMessage";

/** Draft, open and topping up (before an approved purchase): nothing to buy yet. */
export function WaitingForDonations({ need }: { need: NeedCard }) {
  if (need.status === "draft") return <DraftInfo need={need} />;
  const left =
    need.remainingCents > 0
      ? `${formatLeft(need.status, need.remainingCents, formatUsd)} of ${formatUsd(need.targetCents)}`
      : "Donors are paying for the rest right now";
  return (
    <section aria-labelledby="waiting-heading" className="flex gap-3 rounded-xl border bg-surface p-4 sm:p-5.5">
      <Hourglass aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-primary" />
      <div className="flex flex-col gap-1">
        <h2 id="waiting-heading" className="text-lg font-extrabold">
          Waiting for donations
        </h2>
        <p className="text-[15px] text-soft">
          <strong className="text-foreground">{left}</strong>. When it&apos;s fully funded, you&apos;ll check the price
          and plan the purchase here.
        </p>
      </div>
    </section>
  );
}

/** A draft isn't public. Publish uses the same PATCH as the console. */
function DraftInfo({ need }: { need: NeedCard }) {
  const patch = usePatchNeed();
  const busy = useRef(false);

  async function publish() {
    if (busy.current) return;
    busy.current = true;
    try {
      await patch.mutateAsync({ id: need.id, patch: { status: "open" } });
      toast.success(`${need.title} is live on your public page.`);
    } catch (error) {
      toast.error(errorMessage(error, "We couldn't publish that. Please try again."));
    } finally {
      busy.current = false;
    }
  }

  return (
    <section
      aria-labelledby="draft-heading"
      className="flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-surface p-4 sm:p-5.5"
    >
      <div className="flex gap-3">
        <FilePen aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-primary" />
        <div className="flex flex-col gap-1">
          <h2 id="draft-heading" className="text-lg font-extrabold">
            This is a draft
          </h2>
          <p className="text-[15px] text-soft">
            Donors can&apos;t see it yet. Publish it to put it on your public page.
          </p>
        </div>
      </div>
      {need.product ? (
        <Button onClick={() => void publish()} disabled={patch.isPending}>
          {patch.isPending ? "Publishing…" : "Publish"}
        </Button>
      ) : (
        <span className="text-[13px] text-muted-foreground">Choose a product before publishing</span>
      )}
    </section>
  );
}
