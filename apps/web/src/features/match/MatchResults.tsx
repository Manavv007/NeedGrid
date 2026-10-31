import type { MatchRes } from "@needgrid/shared";
import { Sparkles } from "lucide-react";
import { useId } from "react";
import { Link } from "react-router";
import { ProductPhoto } from "@/components/ProductPhoto";
import { ProgressBar } from "@/components/ProgressBar";
import { buttonVariants } from "@/components/ui/button";
import { formatLeft, formatUsdShort } from "@/lib/format";
import { needPath } from "@/lib/links";
import { cn } from "@/lib/utils";

type Match = MatchRes["matches"][number];

type MatchResultsProps = {
  matches: readonly Match[];
  /** The budget the donor asked with (display only: "Your $25 goes toward it"). */
  budgetCents: number;
};

/**
 * Up to 3 needs B picked, each with its one-line reason (MatchMe.dc.html). The reason is AI text,
 * shown as plain text under an "AI suggestion" label. Every amount is the server's.
 */
export function MatchResults({ matches, budgetCents }: MatchResultsProps) {
  if (matches.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border bg-surface p-6 text-center">
        <h3 className="text-lg font-extrabold">Nothing fits that right now</h3>
        <p className="max-w-90 text-sm leading-normal text-soft">
          Try other words or another budget, or look through every charity's list.
        </p>
        <a href="#orgs" className={buttonVariants({ variant: "outline" })}>
          See all needs
        </a>
      </div>
    );
  }
  return (
    <ul aria-label="Your matches" className="m-0 grid list-none grid-cols-1 gap-4.5 p-0 md:grid-cols-2 lg:grid-cols-3">
      {matches.map((match) => (
        <li key={match.need.id} className="flex flex-col">
          <MatchCard match={match} budgetCents={budgetCents} />
        </li>
      ))}
    </ul>
  );
}

/** Links never nest: the title link covers the card, the Fund button sits above it (like TileCard). */
function MatchCard({ match, budgetCents }: { match: Match; budgetCents: number }) {
  const { need, orgName, reason } = match;
  const titleId = useId();
  const left = formatLeft(need.status, need.remainingCents);
  const aboveBudget = need.remainingCents > budgetCents;

  return (
    <article
      aria-labelledby={titleId}
      className="relative flex flex-1 flex-col gap-3 rounded-xl border bg-surface p-4 transition-colors hover:border-border-strong"
    >
      <div className="flex items-center gap-3">
        <ProductPhoto
          product={need.product}
          className="size-16 rounded-[10px] border"
          placeholderClassName="rounded-[10px]"
          iconClassName="size-6"
        />
        <div className="min-w-0">
          <h3 id={titleId} className="text-base leading-snug font-bold">
            <Link
              to={needPath(need.orgSlug, need.id)}
              className="text-foreground no-underline after:absolute after:inset-0 after:rounded-xl hover:text-foreground hover:underline focus-visible:outline-none focus-visible:after:outline-3 focus-visible:after:outline-offset-2 focus-visible:after:outline-primary"
            >
              {need.title}
            </Link>
          </h3>
          <p className="mt-0.5 text-[13px] text-muted-foreground">{orgName}</p>
        </div>
      </div>

      <div className="rounded-md bg-quote-bg px-3 py-2.5 text-quote-text">
        <p className="flex items-center gap-1.5 text-[11px] font-bold tracking-[0.05em] uppercase">
          <Sparkles aria-hidden="true" className="size-3.5" />
          AI suggestion
        </p>
        <p className="mt-1 text-sm leading-normal">{reason}</p>
      </div>

      <ProgressBar
        size="sm"
        fundedCents={need.fundedCents}
        heldCents={need.heldCents}
        targetCents={need.targetCents}
        label={`${need.title} funding`}
        valueText={`${formatUsdShort(need.fundedCents)} of ${formatUsdShort(need.targetCents)} raised, ${left}`}
      />

      <div className="mt-auto flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[15px]">
            <strong className="font-extrabold text-left-text">{left}</strong>{" "}
            <span className="text-[13px] text-muted-foreground">of {formatUsdShort(need.targetCents)}</span>
          </p>
          {aboveBudget ? (
            <p className="text-[13px] text-soft">Your {formatUsdShort(budgetCents)} goes toward it</p>
          ) : null}
        </div>
        <Link to={needPath(need.orgSlug, need.id, { donate: true })} className={cn(buttonVariants(), "relative z-10")}>
          Fund it<span className="sr-only">: {need.title}</span>
        </Link>
      </div>
    </article>
  );
}
