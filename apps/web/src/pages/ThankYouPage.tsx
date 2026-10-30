import type { ImpactRes } from "@needgrid/shared";
import { Check, Info } from "lucide-react";
import { Link, useLocation, useParams } from "react-router";
import { ErrorState } from "@/components/ErrorState";
import { Button } from "@/components/ui/button";
import { WakingUp } from "@/components/WakingUp";
import { ThanksState } from "@/features/donate/thanksState";
import { GiftSplit, SentOnExplainer, UnassignedNote } from "@/features/impact/GiftSplit";
import { SaveImpactLink } from "@/features/impact/SaveImpactLink";
import { ApiClientError } from "@/lib/api";
import { formatUsd } from "@/lib/format";
import { impactPath, orgPath } from "@/lib/links";
import { useImpact } from "@/lib/queries";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import { NotFoundPage } from "./NotFoundPage";

const PAGE = "mx-auto w-full max-w-xl px-4";

const isNotFound = (error: unknown) => error instanceof ApiClientError && error.code === "NOT_FOUND";

/** `/thanks/:token`: right after a payment, what the gift paid for (brief §9.5, ThankYouPhone.dc.html). */
export function ThankYouPage() {
  const { token = "" } = useParams();
  const impact = useImpact(token);
  const notFound = !impact.data && isNotFound(impact.error);

  useDocumentTitle(impact.data ? "Thank you · NeedGrid" : notFound ? "Gift not found · NeedGrid" : null);

  if (impact.data) return <ThankYou token={token} impact={impact.data} />;
  if (notFound) {
    return (
      <NotFoundPage
        title="We couldn't find that gift"
        message="Check that the link was copied in full. Your gift is safe either way."
        linkLabel="Go to NeedGrid"
      />
    );
  }
  if (impact.isError) {
    return (
      <div className={`${PAGE} py-12`}>
        <ErrorState onRetry={() => void impact.refetch()} />
      </div>
    );
  }
  return (
    <div role="status" className={`${PAGE} flex flex-col gap-4 py-9`}>
      <span className="sr-only">Loading your gift…</span>
      <div aria-hidden="true" className="flex flex-col items-center gap-3 motion-safe:animate-pulse">
        <div className="size-16 rounded-full bg-track" />
        <div className="h-8 w-48 rounded-md bg-track" />
        <div className="h-4 w-64 rounded-md bg-placeholder" />
        <div className="mt-4 h-36 w-full rounded-xl bg-track" />
      </div>
      <WakingUp />
    </div>
  );
}

function ThankYou({ token, impact }: { token: string; impact: ImpactRes }) {
  const location = useLocation();
  const clamped = ThanksState.safeParse(location.state);
  const orgSlug = impact.items[0]?.need.orgSlug ?? null;

  return (
    <div className={`${PAGE} flex flex-col gap-3.5 pt-9 pb-14`}>
      <header className="mb-2 flex flex-col items-center gap-3 text-center">
        <span
          aria-hidden="true"
          className="flex size-16 items-center justify-center rounded-full bg-badge-success-bg text-success"
        >
          <Check className="size-8" strokeWidth={3} />
        </span>
        <h1 className="text-[32px] font-extrabold tracking-[-0.03em]">Thank you!</h1>
        <p className="text-[15px] leading-normal text-soft">
          Your {formatUsd(impact.totalCents)} gift went through. Here's exactly what it paid for.
        </p>
      </header>

      {clamped.success ? (
        <p className="flex gap-2.5 rounded-[10px] bg-badge-warning-bg px-3.5 py-3 text-sm leading-normal text-badge-warning-text">
          <Info aria-hidden="true" className="mt-0.5 size-4.5 shrink-0" strokeWidth={2.5} />
          <span>
            Only <strong>{formatUsd(clamped.data.clampedAmountCents)}</strong> was left, so your gift was{" "}
            <strong>{formatUsd(clamped.data.clampedAmountCents)}</strong>.
          </span>
        </p>
      ) : null}

      {impact.items.length > 0 ? <GiftSplit items={impact.items} /> : null}
      <SentOnExplainer items={impact.items} />
      <UnassignedNote totalCents={impact.totalCents} items={impact.items} />
      <SaveImpactLink token={token} />

      <Button asChild size="lg">
        <Link to={impactPath(token)}>Open my impact page</Link>
      </Button>
      <Button asChild size="lg" variant="outline">
        <Link to={orgSlug ? orgPath(orgSlug) : { pathname: "/", hash: "#orgs" }}>Fund another item</Link>
      </Button>
      <p className="mt-1 text-center text-xs leading-normal text-muted-foreground">
        This page is not a tax receipt. PayPal sandbox demo.
      </p>
    </div>
  );
}
