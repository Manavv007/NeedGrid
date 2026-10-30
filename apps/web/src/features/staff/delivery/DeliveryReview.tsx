import type { DeliveryView, NeedCard } from "@needgrid/shared";
import { Camera, Info, Sparkles, TriangleAlert } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { ProductPhoto } from "@/components/ProductPhoto";
import { Button } from "@/components/ui/button";
import { useConfirmDelivery } from "@/lib/queries";
import { errorMessage } from "../errorMessage";
import { checkDidNotRun, editedMessage, MAX_NOTE_LENGTH } from "./delivery";
import { DeliveryPhoto } from "./DeliveryPhoto";
import { MatchMeter } from "./MatchMeter";
import { NoteField } from "./NoteField";

type DeliveryReviewProps = {
  need: NeedCard;
  /** The latest delivery: `needsReview` and not confirmed yet. */
  delivery: DeliveryView;
  onRetake: () => void;
  /** Move focus to the heading (right after a check in this tab, not on a page reload). */
  focusHeading: boolean;
};

/**
 * "Needs your review before donors see it" (Delivery.dc.html): what was ordered next to what
 * arrived, the server's match score and AI notes, and the donor message to edit. Nothing is public
 * until staff press Confirm delivery.
 */
export function DeliveryReview({ need, delivery, onRetake, focusHeading }: DeliveryReviewProps) {
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const didNotRun = checkDidNotRun(delivery);

  useEffect(() => {
    if (focusHeading) headingRef.current?.focus();
  }, [focusHeading]);

  return (
    <section aria-labelledby={headingId} className="overflow-hidden rounded-xl border bg-surface">
      <div className="flex flex-wrap items-center gap-2.5 bg-badge-warning-bg px-4 py-3.5 sm:px-5.5">
        <TriangleAlert aria-hidden="true" className="size-4.5 text-badge-warning-text" strokeWidth={2.5} />
        <h2
          id={headingId}
          ref={headingRef}
          tabIndex={-1}
          className="text-base font-extrabold text-badge-warning-text outline-none"
        >
          Needs your review before donors see it
        </h2>
      </div>

      <div className="flex flex-wrap gap-7 p-4 sm:p-5.5">
        <div className="flex min-w-0 flex-[1_1_480px] flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <figure className="m-0 flex min-w-0 flex-col gap-1.5">
              <ProductPhoto
                product={need.product}
                className="aspect-square w-full rounded-lg border"
                placeholderClassName="rounded-lg"
                iconClassName="size-10"
              />
              <figcaption className="text-[13px] text-muted-foreground">What we ordered</figcaption>
            </figure>
            <figure className="m-0 flex min-w-0 flex-col gap-1.5">
              <DeliveryPhoto
                url={delivery.photoUrl}
                alt={`${need.title} after it arrived`}
                className="aspect-square w-full rounded-lg border"
              />
              <figcaption className="text-[13px] text-muted-foreground">What arrived</figcaption>
            </figure>
          </div>

          {didNotRun ? (
            <p className="flex gap-2.5 rounded-lg border border-warning bg-warning-soft p-3.5 text-sm leading-normal text-badge-warning-text">
              <Info aria-hidden="true" className="mt-0.5 size-4.5 shrink-0" />
              <span>The automatic check didn&apos;t run. Please look at the photo and confirm.</span>
            </p>
          ) : (
            <>
              <MatchMeter score={delivery.matchScore} />
              <div className="flex gap-2.5 rounded-lg bg-staff-bg p-3.5">
                <Sparkles aria-hidden="true" className="mt-0.5 size-4.5 shrink-0 text-primary" />
                <p className="text-sm leading-[1.55]">
                  <strong>AI check:</strong> {delivery.aiNotes}
                </p>
              </div>
            </>
          )}
        </div>

        <ConfirmForm need={need} delivery={delivery} onRetake={onRetake} />
      </div>
    </section>
  );
}

type ConfirmFormProps = { need: NeedCard; delivery: DeliveryView; onRetake: () => void };

/** The donor message (prefilled with the server's), Confirm delivery exactly once, and Retake photo. */
function ConfirmForm({ need, delivery, onRetake }: ConfirmFormProps) {
  const confirm = useConfirmDelivery();
  const busy = useRef(false);
  const [message, setMessage] = useState(delivery.message ?? "");
  const [problem, setProblem] = useState<string | null>(null);
  const tooLong = message.length > MAX_NOTE_LENGTH;
  const locked = confirm.isPending || confirm.isSuccess;

  async function run() {
    if (busy.current || tooLong) return;
    busy.current = true;
    setProblem(null);
    try {
      await confirm.mutateAsync({
        deliveryId: delivery.id,
        needId: need.id,
        message: editedMessage(delivery.message, message),
      });
      toast.success("Delivery confirmed. Donors can see the photo now.");
    } catch (error) {
      busy.current = false;
      const text = errorMessage(error, "We couldn't confirm the delivery. Please try again.");
      setProblem(text);
      toast.error(text);
    }
  }

  return (
    <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-3.5">
      <NoteField
        label="Message for donors"
        value={message}
        onChange={(text) => {
          setMessage(text);
          setProblem(null);
        }}
        rows={5}
        disabled={locked}
        help={
          delivery.message
            ? "Written by AI from your note. Edit it before you confirm."
            : "No message yet. Write a short thank-you for donors, or leave it empty."
        }
        placeholder="e.g. They arrived this morning and were on the shelf by lunch. Thank you!"
      />
      <Button
        size="lg"
        onClick={() => void run()}
        disabled={locked || tooLong}
        className="h-12.5 w-full font-extrabold"
      >
        {confirm.isPending ? "Confirming…" : "Confirm delivery"}
      </Button>
      <Button variant="outline" onClick={onRetake} disabled={locked} className="w-full">
        <Camera aria-hidden="true" />
        Retake photo
      </Button>
      {problem ? (
        <p role="alert" className="text-sm font-semibold text-danger">
          {problem}
        </p>
      ) : null}
    </div>
  );
}
