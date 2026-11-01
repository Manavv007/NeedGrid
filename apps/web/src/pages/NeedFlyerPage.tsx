import { Id, type NeedDetailRes } from "@needgrid/shared";
import { Navigate, useParams } from "react-router";
import { ProductPhoto } from "@/components/ProductPhoto";
import { ProgressBar } from "@/components/ProgressBar";
import { FlyerLayout } from "@/features/flyers/FlyerLayout";
import { isFundable } from "@/features/flyers/flyerNeeds";
import { FlyerError, FlyerLoading, FlyerMessage, FlyerOrgLine, FlyerQr } from "@/features/flyers/FlyerParts";
import { ApiClientError } from "@/lib/api";
import { formatLeft, formatUsdShort } from "@/lib/format";
import { absoluteUrl, needFlyerPath, needPath, orgFlyerPath, orgPath } from "@/lib/links";
import { useNeed } from "@/lib/queries";
import { useDocumentTitle } from "@/lib/useDocumentTitle";

const isNotFound = (error: unknown) => error instanceof ApiClientError && error.code === "NOT_FOUND";

function NeedFlyerNotFound() {
  return (
    <FlyerMessage
      title="We couldn't find that item"
      message="It may have been removed, or the link was mistyped. Every charity's list is on the home page."
      links={[{ to: "/", label: "See all charities" }]}
    />
  );
}

/** `/o/:slug/n/:needId/flyer` (brief §9.12): one item, large, with a QR code to its page. */
export function NeedFlyerPage() {
  const { slug = "", needId = "" } = useParams();
  // A malformed id is simply "not found", like the need page; no request needed.
  if (!Id.safeParse(needId).success) return <NeedFlyerNotFound />;
  return <NeedFlyerContent slug={slug} needId={needId} />;
}

function NeedFlyerContent({ slug, needId }: { slug: string; needId: string }) {
  const need = useNeed(needId);
  const detail = need.data;
  const notFound = !detail && isNotFound(need.error);
  useDocumentTitle(detail ? `Flyer · ${detail.need.title} · NeedGrid` : notFound ? "Flyer · NeedGrid" : null);

  if (detail) {
    // Never print one charity's item under another charity's address.
    if (detail.need.orgSlug !== slug) {
      return <Navigate replace to={needFlyerPath(detail.need.orgSlug, detail.need.id)} />;
    }
    return <NeedFlyer detail={detail} />;
  }
  if (notFound) return <NeedFlyerNotFound />;
  if (need.isError) return <FlyerError onRetry={() => void need.refetch()} />;
  return <FlyerLoading />;
}

function NeedFlyer({ detail }: { detail: NeedDetailRes }) {
  const { need, org } = detail;
  const page = needPath(org.slug, need.id);

  if (!isFundable(need)) {
    return (
      <FlyerMessage
        goodNews
        title="This item is funded, thank you"
        message={`“${need.title}” doesn't need any more money, so there's no flyer to print for it.`}
        links={[
          { to: orgFlyerPath(org.slug), label: `Print a flyer for ${org.name}` },
          { to: orgPath(org.slug), label: `Back to ${org.name}` },
        ]}
      />
    );
  }

  const left = formatLeft(need.status, need.remainingCents);
  const target = formatUsdShort(need.targetCents);
  return (
    <FlyerLayout backTo={page}>
      <div>
        <FlyerOrgLine className="mb-2">{[org.name, org.city].filter(Boolean).join(" · ")}</FlyerOrgLine>
        <p className="text-[15px] font-semibold sm:text-[16pt]">Help us get this item</p>
        <h1 className="mt-1 text-[32px] leading-[1.05] font-extrabold tracking-[-0.03em] sm:text-[40pt]">
          {need.title}
        </h1>
      </div>
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:gap-8">
        <ProductPhoto
          product={need.product}
          loading="eager"
          className="aspect-square w-full max-w-64 self-center rounded-xl border-2 border-foreground p-4 sm:w-64 sm:self-auto"
          placeholderClassName="rounded-lg"
          iconClassName="size-12"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <p className="text-[15px] sm:text-[14pt]">
            {need.quantity} × {need.unit}
          </p>
          <p className="text-[28px] leading-tight font-extrabold text-left-text sm:text-[30pt]">{left}</p>
          <ProgressBar
            size="lg"
            fundedCents={need.fundedCents}
            heldCents={need.heldCents}
            targetCents={need.targetCents}
            label={`${need.title} funding`}
            valueText={`${formatUsdShort(need.fundedCents)} of ${target} raised, ${left}`}
          />
          <p className="text-[15px] sm:text-[13pt]">
            {formatUsdShort(need.fundedCents)} raised of {target}
          </p>
        </div>
      </div>
      {need.description ? <p className="text-[15px] leading-[1.45] sm:text-[14pt]">{need.description}</p> : null}
      <FlyerQr
        url={absoluteUrl(page)}
        label={`QR code: scan to fund ${need.title} for ${org.name}`}
        caption="Scan to fund this item"
      />
    </FlyerLayout>
  );
}
