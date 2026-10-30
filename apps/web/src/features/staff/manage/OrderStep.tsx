import { MarkOrderedReq, type NeedCard, type PurchaseView } from "@needgrid/shared";
import { ExternalLink } from "lucide-react";
import { useId, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { useMarkOrdered } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { errorMessage } from "../errorMessage";
import { OfferLink } from "./OfferLink";
import { StepCard } from "./StepCard";

type OrderStepProps = {
  need: NeedCard;
  /** The approved purchase, or null while nothing is approved. */
  purchase: PurchaseView | null;
};

const MAX_ORDER_REF = 100;

/** Same rule as `MarkOrderedReq` (the server re-checks): 1 to 100 characters after trimming. */
function orderRefProblem(text: string): string | null {
  if (MarkOrderedReq.safeParse({ orderRef: text }).success) return null;
  return text.trim() === ""
    ? "Enter the order number from the retailer's confirmation."
    : `Keep the order number under ${MAX_ORDER_REF} characters.`;
}

/**
 * Step 2 · Buy it and mark as ordered. Locked (inputs disabled) until a purchase is approved and the
 * need is funded, which is exactly when the server accepts "mark ordered".
 */
export function OrderStep({ need, purchase }: OrderStepProps) {
  const unlocked = purchase !== null && need.status === "funded";
  const lockNote = purchase === null ? "Unlocks after approval" : "Unlocks when it's fully funded again";
  return (
    <StepCard title="Step 2 · Buy it and mark as ordered" note={unlocked ? null : lockNote} locked={!unlocked}>
      <div className="p-4 sm:p-5.5">
        {unlocked ? (
          <OrderForm need={need} purchase={purchase} />
        ) : (
          <LockedForm retailer={purchase?.offer.retailer ?? need.product?.retailer ?? null} />
        )}
      </div>
    </StepCard>
  );
}

const buyLink = cn(buttonVariants({ variant: "secondary" }), "self-start sm:self-end");

function OrderForm({ need, purchase }: { need: NeedCard; purchase: PurchaseView }) {
  const markOrdered = useMarkOrdered();
  const busy = useRef(false);
  const [orderRef, setOrderRef] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [serverProblem, setServerProblem] = useState<string | null>(null);
  const id = useId();
  const problem = submitted ? orderRefProblem(orderRef) : null;
  const shown = problem ?? serverProblem;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
    if (busy.current || orderRefProblem(orderRef) !== null) return;
    busy.current = true;
    setServerProblem(null);
    try {
      await markOrdered.mutateAsync({ purchaseId: purchase.id, needId: need.id, orderRef: orderRef.trim() });
      toast.success("Marked as ordered");
    } catch (error) {
      busy.current = false;
      const message = errorMessage(error, "We couldn't save the order. Please try again.");
      setServerProblem(message);
      toast.error(message);
    }
  }

  return (
    <form noValidate onSubmit={(event) => void submit(event)} className="flex flex-wrap items-end gap-3">
      <OfferLink url={purchase.offer.url} className={buyLink}>
        Buy it at {purchase.offer.retailer}
        <ExternalLink aria-hidden="true" />
      </OfferLink>
      <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-1.5">
        <label htmlFor={id} className="text-xs font-semibold text-soft">
          Retailer order number
        </label>
        <input
          id={id}
          type="text"
          autoComplete="off"
          placeholder="e.g. 2000123-45678"
          value={orderRef}
          onChange={(event) => {
            setOrderRef(event.target.value);
            setServerProblem(null);
          }}
          aria-invalid={shown ? true : undefined}
          aria-describedby={shown ? `${id}-error` : undefined}
          className={cn(
            "h-11 w-full min-w-0 rounded-md bg-surface px-3 text-base outline-none focus-visible:ring-3 focus-visible:ring-ring",
            shown ? "border-2 border-danger" : "border border-border-strong",
          )}
        />
      </div>
      <Button type="submit" disabled={markOrdered.isPending || markOrdered.isSuccess}>
        {markOrdered.isPending ? "Saving…" : "Mark as ordered"}
      </Button>
      {shown ? (
        <p id={`${id}-error`} className="w-full text-[13px] font-semibold text-danger">
          {shown}
        </p>
      ) : null}
    </form>
  );
}

/** The same controls, visibly unavailable. No link: there's no approved offer to buy yet. */
function LockedForm({ retailer }: { retailer: string | null }) {
  const id = useId();
  return (
    <div className="flex flex-wrap items-end gap-3">
      <span className={cn(buttonVariants({ variant: "outline" }), "self-start opacity-50")}>
        {retailer ? `Buy it at ${retailer}` : "Buy it"}
        <ExternalLink aria-hidden="true" />
      </span>
      <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-1.5">
        <label htmlFor={id} className="text-xs font-semibold text-soft">
          Retailer order number
        </label>
        <input
          id={id}
          type="text"
          disabled
          placeholder="e.g. 2000123-45678"
          className="h-11 w-full min-w-0 rounded-md border border-border-strong bg-background px-3 text-base"
        />
      </div>
      <Button disabled>Mark as ordered</Button>
    </div>
  );
}
