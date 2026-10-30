import { HOLD_MINUTES, type NeedCard } from "@needgrid/shared";
import { Check, Clock, Truck, X, type LucideIcon } from "lucide-react";
import { useId, type ReactNode } from "react";
import { ProgressBar } from "@/components/ProgressBar";
import { formatDonorCount, formatUsdShort } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Shown instead of the donate panel when the item takes no more money (NeedFundedPhone.dc.html). */
export function NeedStatusBox({ need }: { need: NeedCard }) {
  const raised = `${formatDonorCount(need.donorCount)} raised ${formatUsdShort(need.fundedCents)}.`;
  switch (need.status) {
    case "funded":
      return (
        <StatusBox tone="success" Icon={Check} title="Fully funded, thank you!">
          {raised} We're buying it now and will post a photo when it arrives.
        </StatusBox>
      );
    case "ordered":
      return (
        <StatusBox tone="success" Icon={Truck} title="On its way…">
          {raised} It's ordered, and we'll post a photo when it arrives.
        </StatusBox>
      );
    case "delivered":
      return (
        <StatusBox tone="success" Icon={Check} title="Delivered, thank you!">
          {raised} It has arrived, and we'll add the photo here soon.
        </StatusBox>
      );
    case "closed":
      return (
        <StatusBox tone="neutral" Icon={X} title="No longer needed">
          The charity closed this item, so it doesn't take donations any more.
        </StatusBox>
      );
    default:
      // open / topping_up with nothing left: other donors' payments hold the rest.
      return (
        <StatusBox tone="neutral" Icon={Clock} title="Donors are paying for the rest right now">
          <ProgressBar
            fundedCents={need.fundedCents}
            heldCents={need.heldCents}
            targetCents={need.targetCents}
            label={`${need.title} funding`}
            className="my-1"
          />
          If a payment doesn't go through, the rest opens up again within {HOLD_MINUTES} minutes.
        </StatusBox>
      );
  }
}

type StatusBoxProps = { tone: "success" | "neutral"; Icon: LucideIcon; title: string; children: ReactNode };

function StatusBox({ tone, Icon, title, children }: StatusBoxProps) {
  const titleId = useId();
  const success = tone === "success";
  return (
    <section
      aria-labelledby={titleId}
      className={cn(
        "flex flex-col gap-2.5 rounded-xl border p-4",
        success ? "border-success-border bg-success-soft" : "bg-surface",
      )}
    >
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden="true"
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-full",
            success ? "bg-badge-success-bg text-success" : "bg-placeholder text-soft",
          )}
        >
          <Icon className="size-4.5" strokeWidth={3} />
        </span>
        <h2 id={titleId} className={cn("text-lg font-extrabold", success ? "text-success-strong" : "text-foreground")}>
          {title}
        </h2>
      </div>
      <div className={cn("text-sm leading-normal", success ? "text-badge-success-text" : "text-soft")}>{children}</div>
    </section>
  );
}
