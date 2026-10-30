import type { NeedCard } from "@needgrid/shared";
import { Camera } from "lucide-react";

type DeliverySlotProps = { need: NeedCard };

/**
 * Where the delivery panel goes for an `ordered` need (task C-8: arrival photo upload, AI check,
 * confirm). Until then a neutral note, with no actions that would pretend to work.
 */
export function DeliverySlot({ need }: DeliverySlotProps) {
  return (
    <section
      aria-labelledby="delivery-slot-heading"
      className="flex gap-3 rounded-xl border border-dashed border-border-strong bg-surface p-4 sm:p-5.5"
    >
      <Camera aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
      <div className="flex flex-col gap-1">
        <h2 id="delivery-slot-heading" className="text-lg font-extrabold">
          Record the delivery
        </h2>
        <p className="text-[15px] text-soft">
          Recording the delivery comes in the next update. Then you&apos;ll add a photo when {need.title} arrives, and
          donors see it on their impact page.
        </p>
      </div>
    </section>
  );
}
