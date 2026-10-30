import { HOLD_MINUTES, type NeedCard } from "@needgrid/shared";
import { CircleAlert, Info } from "lucide-react";
import { useState } from "react";
import { ProgressBar } from "@/components/ProgressBar";
import { Button } from "@/components/ui/button";
import { formatDonorCount, formatLeft, formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AmountPicker } from "./AmountPicker";
import { checkoutKind } from "./checkout";
import { CheckoutButtons } from "./CheckoutButtons";
import { ConfirmingGift } from "./ConfirmingGift";
import { JustFunded } from "./JustFunded";
import { defaultChoice, isOffered, resolveGift, type GiftChoice } from "./money-input";
import { RollOverConsent } from "./RollOverConsent";
import { useCheckout, type ActiveOrder, type CheckoutPhase, type CheckoutPhaseName } from "./useCheckout";

type DonatePanelProps = {
  need: NeedCard;
  /** `column`: the sticky card on desktop (NeedDetail.dc.html). `sheet`: inside the phone bottom sheet. */
  variant?: "column" | "sheet";
  /** Focus the amount picker when the panel appears. */
  focusOnMount?: boolean;
  /** Lets the page keep the panel (and the sheet) open while a payment is in progress. */
  onPhaseChange?: (name: CheckoutPhaseName) => void;
};

/**
 * The money UI (brief §9.4): amount, roll-over consent, PayPal. The browser only sends the need id
 * and the requested amount; every amount shown after that is the server's.
 */
export function DonatePanel({
  need: liveNeed,
  variant = "column",
  focusOnMount = false,
  onPhaseChange,
}: DonatePanelProps) {
  // While a payment is under way the panel keeps showing the need as the donor chose from it, so a
  // refetch or live update can't swap the amount (and redraw the PayPal buttons) mid-checkout.
  const [lockedNeed, setLockedNeed] = useState<NeedCard | null>(null);
  const need = lockedNeed ?? liveNeed;
  const [choice, setChoice] = useState<GiftChoice>(() => defaultChoice(liveNeed.remainingCents));
  const [otherText, setOtherText] = useState("");
  const [rollOverConsent, setRollOverConsent] = useState(true);

  const offeredChoice = isOffered(choice, need.remainingCents) ? choice : defaultChoice(need.remainingCents);
  const gift = resolveGift(offeredChoice, otherText, need.remainingCents);
  const { phase, handlers, retry } = useCheckout({
    needId: need.id,
    gift,
    rollOverConsent,
    onPhaseChange: (name) => {
      setLockedNeed((locked) => (name === "idle" ? null : (locked ?? liveNeed)));
      onPhaseChange?.(name);
    },
  });

  const frame = variant === "column" ? "rounded-xl border bg-surface p-6 shadow-lg shadow-foreground/5" : "";
  const capturing = phase.name === "capturing";
  const inProgress = phase.name === "creating" || phase.name === "awaiting" || capturing;
  // After a failed confirmation the donor may already have paid: only "Try again" (same order) is offered.
  const confirmOnly = phase.name === "error" && phase.retry === "capture";
  const locked = inProgress || confirmOnly;
  const openOrder = phase.name === "awaiting" ? phase.order : null;

  return (
    <div className={cn("relative", frame)}>
      {phase.name === "fullyFunded" ? (
        <JustFunded nextNeed={phase.nextNeed} orgSlug={need.orgSlug} />
      ) : (
        <div inert={capturing} className={cn("flex flex-col gap-4.5", capturing && "invisible")}>
          <DonateSummary need={need} compact={variant === "sheet"} />
          <AmountPicker
            remainingCents={need.remainingCents}
            choice={offeredChoice}
            otherText={otherText}
            onChoiceChange={setChoice}
            onOtherTextChange={setOtherText}
            disabled={locked}
            focusOnMount={focusOnMount}
          />
          <RollOverConsent checked={rollOverConsent} onCheckedChange={setRollOverConsent} disabled={locked} />
          {openOrder?.clamped && openOrder.amountCents !== null ? (
            <ClampedNotice cents={openOrder.amountCents} />
          ) : null}
          {phase.name === "error" ? <CheckoutError message={phase.message} onRetry={retry} /> : null}
          <div className="flex flex-col gap-2.5">
            <CheckoutButtons
              kind={checkoutKind()}
              handlers={handlers}
              displayCents={gift?.displayCents ?? null}
              // Not disabled mid-payment: toggling the real buttons while PayPal's window is open isn't
              // needed (PayPal refocuses its window) and useCheckout rejects a second order anyway.
              disabled={gift === null || confirmOnly}
              renderKey={`${gift?.requestCents ?? "none"}:${rollOverConsent}`}
            />
            {openOrder ? <HoldNote order={openOrder} /> : null}
            <p className="text-center text-xs text-muted-foreground">
              PayPal sandbox: use the demo buyer login from the README.
            </p>
          </div>
        </div>
      )}
      {capturing ? (
        <ConfirmingGift
          clampedCents={phase.order.clamped ? phase.order.amountCents : null}
          className="absolute inset-0 z-10"
        />
      ) : null}
      {/* Always mounted, so changes are announced. Errors use role="alert" instead. */}
      <p className="sr-only" aria-live="polite">
        {announcement(phase)}
      </p>
    </div>
  );
}

/** What a screen reader hears as the payment moves along (errors use role="alert" instead). */
function announcement(phase: CheckoutPhase): string {
  switch (phase.name) {
    case "creating":
      return "Starting your payment…";
    case "awaiting":
      return phase.order.clamped && phase.order.amountCents !== null
        ? clampedCopy(phase.order.amountCents)
        : "PayPal window is open.";
    case "capturing":
      return phase.order.clamped && phase.order.amountCents !== null
        ? `Confirming your gift… ${clampedCopy(phase.order.amountCents)}`
        : "Confirming your gift…";
    case "fullyFunded":
      return "This item was just fully funded. Nothing was charged.";
    default:
      return "";
  }
}

const clampedCopy = (cents: number) =>
  `Only ${formatUsd(cents)} was left, so your gift is ${formatUsd(cents)}. PayPal will show the same amount.`;

/** "$14.00 left", raised of target, donors, and the progress bar with the held segment. */
function DonateSummary({ need, compact }: { need: NeedCard; compact: boolean }) {
  const left = formatLeft(need.status, need.remainingCents, formatUsd);
  const bar = (
    <ProgressBar
      size={compact ? "md" : "lg"}
      fundedCents={need.fundedCents}
      heldCents={need.heldCents}
      targetCents={need.targetCents}
      label={`${need.title} funding`}
    />
  );
  if (compact) {
    return (
      <div>
        <p className="mb-2 text-[15px]">
          <strong className="text-xl font-extrabold text-left-text">{left}</strong>{" "}
          <span className="text-muted-foreground">of {formatUsd(need.targetCents)}</span>
        </p>
        {bar}
      </div>
    );
  }
  return (
    <div>
      <p className="text-[28px] leading-tight font-extrabold tracking-[-0.02em] text-left-text">{left}</p>
      <p className="mt-1 mb-3 text-sm text-muted-foreground">
        {formatUsd(need.fundedCents)} raised of {formatUsd(need.targetCents)} · {formatDonorCount(need.donorCount)}
      </p>
      {bar}
    </div>
  );
}

/** Server clamped the gift (DonateVariants.dc.html "Someone gave first"). */
function ClampedNotice({ cents }: { cents: number }) {
  return (
    <div className="flex gap-2.5 rounded-[10px] bg-badge-warning-bg px-3.5 py-3 text-sm leading-normal text-badge-warning-text">
      <Info aria-hidden="true" className="mt-0.5 size-4.5 shrink-0" strokeWidth={2.5} />
      <p>
        Only <strong>{formatUsd(cents)}</strong> was left, so your gift is <strong>{formatUsd(cents)}</strong>. PayPal
        will show the same amount.
      </p>
    </div>
  );
}

function HoldNote({ order }: { order: ActiveOrder }) {
  return (
    <p className="text-center text-xs text-muted-foreground">
      PayPal window is open…
      {order.amountCents === null
        ? null
        : ` Your ${formatUsd(order.amountCents)} is held for you for ${HOLD_MINUTES} minutes.`}
    </p>
  );
}

function CheckoutError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-col gap-2.5 rounded-[10px] bg-badge-danger-bg px-3.5 py-3 text-sm leading-normal text-badge-danger-text"
    >
      <p className="flex gap-2.5">
        <CircleAlert aria-hidden="true" className="mt-0.5 size-4.5 shrink-0" strokeWidth={2.5} />
        {message}
      </p>
      <Button variant="outline" className="self-start" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}
