import type { NeedCard } from "@needgrid/shared";
import { Link } from "react-router";
import { NextNeedCard } from "@/features/donate/NextNeedCard";
import { applyFilters, DEFAULT_FILTERS } from "@/features/tiles/filterNeeds";
import { orgPath } from "@/lib/links";
import { useOrg } from "@/lib/queries";

type FundNextNeedProps = { need: NeedCard; orgName: string };

/**
 * "Still want to help? This one's most urgent:" under a need that takes no more money. The API has
 * no public "next need" endpoint, so this is the first still-needed tile of the charity's wall,
 * most urgent first (the tile wall's default sort).
 */
export function FundNextNeed({ need, orgName }: FundNextNeedProps) {
  const org = useOrg(need.orgSlug);
  const next = org.data
    ? (applyFilters(org.data.needs, DEFAULT_FILTERS).find((n) => n.id !== need.id && n.remainingCents > 0) ?? null)
    : null;
  const allNeeds = (
    <Link to={orgPath(need.orgSlug)} className="inline-flex min-h-11 items-center text-[15px] font-semibold">
      See everything still needed
    </Link>
  );

  if (org.isPending) {
    return (
      <div role="status" className="flex flex-col gap-2.5 border-t pt-3.5">
        <span className="sr-only">Finding the next most urgent item…</span>
        <div aria-hidden="true" className="h-19 rounded-xl bg-track motion-safe:animate-pulse" />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2.5 border-t pt-3.5">
      {next ? (
        <>
          <p className="text-sm font-bold">Still want to help? This one's most urgent:</p>
          <NextNeedCard need={next} variant="link" />
        </>
      ) : org.isError ? null : (
        <p className="text-sm leading-normal text-soft">
          Everything else at {orgName} is covered right now. Thank you for wanting to help!
        </p>
      )}
      {allNeeds}
    </div>
  );
}
