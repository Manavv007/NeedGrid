import type { ProductOption } from "@needgrid/shared";
import { ProductPhoto } from "@/components/ProductPhoto";
import { formatPerItem, formatUsd } from "@/lib/format";

type ProductOptionsProps = {
  /** Unique per row: the radio group's name. */
  name: string;
  options: readonly ProductOption[];
  selected: number;
  onSelect: (index: number) => void;
};

/** "Pick a product": up to 3 ranked options as one radio group, best first (Intake.dc.html). */
export function ProductOptions({ name, options, selected, onSelect }: ProductOptionsProps) {
  return (
    <fieldset className="m-0 min-w-0 border-0 p-0">
      <legend className="mb-2 text-sm font-bold">Pick a product</legend>
      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-3">
        {options.map((option, index) => (
          <label
            key={`${option.channel3Id}-${index}`}
            className="flex cursor-pointer items-start gap-3 rounded-[10px] border border-border-strong bg-surface p-3 has-checked:border-2 has-checked:border-primary has-checked:bg-quote-bg has-focus-visible:outline-3 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring"
          >
            <input
              type="radio"
              name={name}
              checked={selected === index}
              onChange={() => onSelect(index)}
              className="mt-1 size-5 shrink-0 accent-primary"
            />
            <ProductPhoto
              product={option}
              className="size-14 rounded-lg border"
              placeholderClassName="rounded-lg"
              iconClassName="size-5"
            />
            <span className="flex min-w-0 flex-col gap-1 text-[13px]">
              <strong className="text-sm leading-snug break-words">{option.title}</strong>
              <span className="text-soft">
                {option.retailer} <span aria-hidden="true">·</span>{" "}
                <strong className="text-foreground">{formatUsd(option.unitPriceCents)}</strong>
                {option.pricePerItemCents !== null ? (
                  <>
                    {" "}
                    <span aria-hidden="true">·</span> {formatPerItem(option.pricePerItemCents)}
                  </>
                ) : null}
              </span>
              <span className="text-muted-foreground">{option.fitReason}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
