import { ChevronLeft, Printer } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Paper sizes the toolbar offers. `page` is the CSS `@page { size }` value. */
export const PAPER_SIZES = {
  letter: { label: "Letter", page: "letter", aspect: "aspect-[8.5/11]" },
  a4: { label: "A4", page: "A4", aspect: "aspect-[210/297]" },
} as const;
export type PaperSize = keyof typeof PAPER_SIZES;
const PAPER_ORDER: readonly PaperSize[] = ["a4", "letter"];

/** Print margins; globals.css sizes the sheet to the page minus these, so it always fits one page. */
const PRINT_MARGIN = "12mm";

type FlyerLayoutProps = {
  /** Where "Back" goes: the tile wall or the need page the flyer is for. */
  backTo: string;
  children: ReactNode;
};

/**
 * A standalone print page (Flyer.dc.html): a screen-only toolbar (Back, paper size, Print) over a
 * sheet shaped like the paper. Printing hides the toolbar and puts the sheet on one page, black on
 * white (`@media print` in globals.css); the paper toggle sets the `@page` size.
 */
export function FlyerLayout({ backTo, children }: FlyerLayoutProps) {
  const [paper, setPaper] = useState<PaperSize>("letter");
  const size = PAPER_SIZES[paper];

  return (
    <div className="min-h-svh bg-placeholder print:min-h-0 print:bg-transparent">
      {/* Only fixed values from PAPER_SIZES ever go into this rule. */}
      <style>{`@page { size: ${size.page}; margin: ${PRINT_MARGIN}; }`}</style>
      <header className="sticky top-0 z-10 border-b bg-surface print:hidden">
        <div className="mx-auto flex max-w-[8.5in] flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2.5">
          <Link
            to={backTo}
            className="-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-[15px] font-semibold text-foreground no-underline hover:text-foreground"
          >
            <ChevronLeft aria-hidden="true" className="size-4.5" />
            Back
          </Link>
          <div className="flex flex-wrap items-center gap-2.5">
            <PaperToggle value={paper} onChange={setPaper} />
            <Button onClick={() => window.print()}>
              <Printer aria-hidden="true" />
              Print
            </Button>
          </div>
        </div>
      </header>
      <main className="px-4 py-6 sm:py-8 print:p-0">
        <div
          data-flyer-sheet={paper}
          className={cn(
            "mx-auto flex w-full max-w-[8.5in] flex-col gap-5 bg-surface p-5 text-foreground shadow-md sm:gap-7 sm:p-14",
            size.aspect,
            "print:max-w-none print:p-0 print:shadow-none",
          )}
        >
          {children}
        </div>
      </main>
    </div>
  );
}

function PaperToggle({ value, onChange }: { value: PaperSize; onChange: (paper: PaperSize) => void }) {
  return (
    <div role="group" aria-label="Paper size" className="flex rounded-md border border-border-strong p-0.5">
      {PAPER_ORDER.map((paper) => (
        <button
          key={paper}
          type="button"
          aria-pressed={value === paper}
          onClick={() => onChange(paper)}
          className={cn(
            "min-h-11 min-w-14 cursor-pointer rounded-[6px] px-3 text-sm font-semibold",
            value === paper ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-placeholder",
          )}
        >
          {PAPER_SIZES[paper].label}
        </button>
      ))}
    </div>
  );
}
