import { cn } from "@/lib/utils";

// Four tiles on the grid, inside a teal rounded square (Brand.dc.html).
const SIZES = {
  sm: { box: "size-7 rounded-[7px] gap-0.5 p-1.5", tile: "rounded-[2px]" },
  md: { box: "size-8 rounded-md gap-[3px] p-[7px]", tile: "rounded-[2px]" },
  xl: { box: "size-30 rounded-[28px] gap-2.5 p-6.5", tile: "rounded-md" },
} as const;

type LogoMarkProps = {
  size?: keyof typeof SIZES;
  /** Accessible name. Omit when the mark sits next to the visible "NeedGrid" wordmark. */
  label?: string;
  className?: string;
};

export function LogoMark({ size = "md", label, className }: LogoMarkProps) {
  const s = SIZES[size];
  const a11y = label ? { role: "img", "aria-label": label } : { "aria-hidden": true };
  return (
    <span className={cn("grid shrink-0 grid-cols-2 bg-primary", s.box, className)} {...a11y}>
      <span className={cn("bg-surface", s.tile)} />
      <span className={cn("bg-held", s.tile)} />
      <span className={cn("bg-held", s.tile)} />
      <span className={cn("bg-surface", s.tile)} />
    </span>
  );
}
