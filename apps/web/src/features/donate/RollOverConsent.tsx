import { useId } from "react";
import { Checkbox } from "@/components/ui/checkbox";

/** Brief §9.4.2. Covers both overflow and roll-over (sent as `rollOverConsent`). */
const ROLL_OVER_COPY =
  "If this item gets fully funded before my payment completes, send my gift to the charity's next most urgent need.";

type RollOverConsentProps = {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
};

/** The consent checkbox, ticked by default. The label is part of the tap target. */
export function RollOverConsent({ checked, onCheckedChange, disabled = false }: RollOverConsentProps) {
  const id = useId();
  return (
    <div className="flex min-h-11 items-start gap-2.5">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(value) => onCheckedChange(value === true)}
        disabled={disabled}
        className="mt-0.5 size-5"
      />
      <label htmlFor={id} className="text-[13px] leading-normal text-soft">
        {ROLL_OVER_COPY}
      </label>
    </div>
  );
}
