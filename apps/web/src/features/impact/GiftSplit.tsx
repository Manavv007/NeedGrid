import type { AllocationReason, ImpactItem } from "@needgrid/shared";
import { formatUsd } from "@/lib/format";

/** Money that went to another need than the one the donor picked (overflow, roll-over, price drop). */
const SENT_ON: ReadonlySet<AllocationReason> = new Set(["overflow", "rollover", "price_drop"]);

const isSentOn = (item: Pick<ImpactItem, "reason">) => SENT_ON.has(item.reason);

/** "Harbor Food Bank · fully funded now" / "… · sent to the next most urgent need". */
function itemNote(item: ImpactItem): string {
  if (isSentOn(item)) return `${item.orgName} · sent to the next most urgent need`;
  const funded = item.need.status === "funded" || item.need.status === "ordered" || item.need.status === "delivered";
  return funded ? `${item.orgName} · fully funded now` : item.orgName;
}

/** One row per item the gift paid for, with the server's amounts (ThankYouPhone.dc.html). */
export function GiftSplit({ items }: { items: readonly ImpactItem[] }) {
  return (
    <section aria-label="Where your money went" className="overflow-hidden rounded-xl border bg-surface">
      <ul className="m-0 list-none divide-y p-0">
        {items.map((item) => (
          <li key={`${item.need.id}:${item.reason}`} className="flex items-center justify-between gap-3 px-4 py-3.5">
            <div className="min-w-0">
              <p className="text-[15px] font-bold">{item.need.title}</p>
              <p className="mt-0.75 text-xs text-muted-foreground">{itemNote(item)}</p>
            </div>
            <p className="shrink-0 text-base font-extrabold">{formatUsd(item.amountCents)}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** "Diapers, size 4 only needed $14.00, so the rest went to …", when part of the gift was sent on. */
export function SentOnExplainer({ items }: { items: readonly ImpactItem[] }) {
  if (!items.some(isSentOn)) return null;
  const picked = items.find((item) => item.reason === "direct");
  return (
    <p className="rounded-[10px] bg-quote-bg px-3.5 py-3 text-[13px] leading-normal text-quote-text">
      {picked
        ? `“${picked.need.title}” only needed ${formatUsd(picked.amountCents)}, so the rest went to the next most urgent item, as you agreed at checkout.`
        : "The item you picked was already covered, so your gift went to the next most urgent item, as you agreed at checkout."}
    </p>
  );
}

/**
 * The donor unticked "send my gift to the next most urgent need" and the item was covered first:
 * the server keeps that part unassigned and proposes a refund. No amount is worked out here.
 */
export function UnassignedNote({ totalCents, items }: { totalCents: number; items: readonly ImpactItem[] }) {
  const assignedCents = items.reduce((sum, item) => sum + item.amountCents, 0);
  if (assignedCents >= totalCents) return null;
  return (
    <p className="rounded-[10px] bg-quote-bg px-3.5 py-3 text-[13px] leading-normal text-quote-text">
      {items.length === 0
        ? "The item was already covered when your payment went through"
        : "Part of your gift wasn't needed"}
      , and you asked us not to send it to another need, so the charity will refund it.
    </p>
  );
}
