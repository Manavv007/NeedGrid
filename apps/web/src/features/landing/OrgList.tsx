import { Building2 } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { WakingUp } from "@/components/WakingUp";
import { useOrgs } from "@/lib/queries";
import { OrgCard, OrgCardSkeleton } from "./OrgCard";

const GRID = "grid grid-cols-1 gap-4.5 md:grid-cols-2 lg:grid-cols-3";

/** "Charities on NeedGrid" (Landing.dc.html), with loading, empty and error states. */
export function OrgList() {
  const orgs = useOrgs();

  return (
    <section
      id="orgs"
      aria-labelledby="orgs-title"
      className="mx-auto w-full max-w-300 scroll-mt-4 px-4 pt-11 pb-14 sm:px-6"
    >
      <h2 id="orgs-title" className="mb-5 text-2xl font-extrabold tracking-[-0.02em]">
        Charities on NeedGrid
      </h2>
      {orgs.isPending ? (
        <div role="status" className="flex flex-col gap-6">
          <span className="sr-only">Loading charities…</span>
          <div className={GRID}>
            {[0, 1, 2].map((i) => (
              <OrgCardSkeleton key={i} />
            ))}
          </div>
          <WakingUp />
        </div>
      ) : orgs.isError ? (
        <ErrorState onRetry={() => void orgs.refetch()} />
      ) : orgs.data.orgs.length === 0 ? (
        <EmptyState
          icon={<Building2 className="size-6.5" />}
          title="No charities yet"
          message="The first charities are setting up their lists. Check back soon."
        />
      ) : (
        <ul className={GRID}>
          {orgs.data.orgs.map((org) => (
            <li key={org.id} className="flex flex-col [&>a]:flex-1">
              <OrgCard org={org} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
