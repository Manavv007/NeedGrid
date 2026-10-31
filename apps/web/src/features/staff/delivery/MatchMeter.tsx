import { DELIVERY_MATCH_THRESHOLD } from "@needgrid/shared";
import { Check, TriangleAlert } from "lucide-react";
import { percentOf } from "@/lib/format";
import { cn } from "@/lib/utils";

type MatchMeterProps = {
  /** `DeliveryView.matchScore`, 0 to 1, exactly as the server sent it. */
  score: number;
  /** Staff confirmed the delivery after review, so a low score no longer asks them to check. */
  confirmedByStaff?: boolean;
};

/**
 * The server's photo match score as a meter: "94% match" in success colours at or above
 * DELIVERY_MATCH_THRESHOLD (the server's own "no review needed" line), "58% match · check it" in
 * warning colours below. Text and icon, never colour alone (Delivery.dc.html).
 */
export function MatchMeter({ score, confirmedByStaff = false }: MatchMeterProps) {
  const percent = percentOf(score, 1);
  const good = score >= DELIVERY_MATCH_THRESHOLD;
  const warn = !good && !confirmedByStaff;
  const Icon = warn ? TriangleAlert : Check;
  const text = good
    ? `${percent}% match`
    : `${percent}% match · ${confirmedByStaff ? "confirmed by staff" : "check it"}`;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm">
        <strong>Photo match</strong>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 font-bold",
            good ? "text-badge-success-text" : warn ? "text-badge-warning-text" : "text-foreground",
          )}
        >
          <Icon aria-hidden="true" className="size-4" strokeWidth={2.5} />
          {text}
        </span>
      </div>
      <div
        role="meter"
        aria-label="Photo match score"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={`${percent}% match`}
        className="h-2.5 overflow-hidden rounded-full bg-track"
      >
        <div className={cn("h-full", good ? "bg-success" : "bg-warning")} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
