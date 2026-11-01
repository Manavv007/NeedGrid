import type { NeedCard, OrgPageRes } from "@needgrid/shared";
import { useParams } from "react-router";
import { ProductPhoto } from "@/components/ProductPhoto";
import { FlyerLayout } from "@/features/flyers/FlyerLayout";
import { flyerHeadline, flyerNeeds } from "@/features/flyers/flyerNeeds";
import { FlyerError, FlyerLoading, FlyerMessage, FlyerOrgLine, FlyerQr } from "@/features/flyers/FlyerParts";
import { ApiClientError } from "@/lib/api";
import { formatLeft } from "@/lib/format";
import { absoluteUrl, orgPath } from "@/lib/links";
import { useOrg } from "@/lib/queries";
import { useDocumentTitle } from "@/lib/useDocumentTitle";

const isNotFound = (error: unknown) => error instanceof ApiClientError && error.code === "NOT_FOUND";

/**
 * `/o/:slug/flyer` (brief §9.12, Flyer.dc.html): a one-page flyer for food drives and events. Up to 6
 * items that still need money, most urgent first, and a big QR code to the tile wall.
 */
export function OrgFlyerPage() {
  const { slug = "" } = useParams();
  const org = useOrg(slug);
  const notFound = !org.data && isNotFound(org.error);
  useDocumentTitle(org.data ? `Flyer · ${org.data.org.name} · NeedGrid` : notFound ? "Flyer · NeedGrid" : null);

  if (org.data) return <OrgFlyer page={org.data} />;
  if (notFound) {
    return (
      <FlyerMessage
        title="We couldn't find that charity"
        message="The link may be old or mistyped. Every charity on NeedGrid is listed on the home page."
        links={[{ to: "/", label: "See all charities" }]}
      />
    );
  }
  if (org.isError) return <FlyerError onRetry={() => void org.refetch()} />;
  return <FlyerLoading />;
}

function OrgFlyer({ page }: { page: OrgPageRes }) {
  const { org, needs } = page;
  const tiles = flyerNeeds(needs);
  const wall = orgPath(org.slug);

  if (tiles.length === 0) {
    return (
      <FlyerMessage
        goodNews
        title="Everything here is funded, thank you"
        message={`${org.name} has nothing left to raise right now, so there's no flyer to print. New items show up on their page.`}
        links={[{ to: wall, label: `Back to ${org.name}` }]}
      />
    );
  }

  const url = absoluteUrl(wall);
  return (
    <FlyerLayout backTo={wall}>
      <div>
        <FlyerOrgLine className="mb-2">{[org.name, org.city].filter(Boolean).join(" · ")}</FlyerOrgLine>
        <h1 className="text-[32px] leading-[1.05] font-extrabold tracking-[-0.03em] sm:text-[40pt]">
          {flyerHeadline(tiles.length)}
        </h1>
      </div>
      <p className="text-[15px] leading-[1.45] sm:text-[14pt]">
        Scan the code, pick an item, and pay what you like with PayPal. You'll get a photo when it arrives.
      </p>
      <ul aria-label="Items" className="m-0 grid list-none grid-cols-1 gap-3.5 p-0 sm:grid-cols-2">
        {tiles.map((need) => (
          <li key={need.id}>
            <FlyerTile need={need} />
          </li>
        ))}
      </ul>
      <FlyerQr
        url={url}
        label={`QR code: scan to see what ${org.name} needs and fund an item`}
        caption="Scan to fund an item"
      />
    </FlyerLayout>
  );
}

/** One item: small photo, title, what's left (whole dollars, like the tiles). */
function FlyerTile({ need }: { need: NeedCard }) {
  return (
    <div className="flex items-center gap-3 rounded-[10px] border-2 border-foreground px-3.5 py-3 break-inside-avoid">
      <ProductPhoto
        product={need.product}
        className="size-12 rounded-md"
        placeholderClassName="rounded-md"
        iconClassName="size-5"
      />
      <span className="min-w-0 flex-1 text-[15px] leading-snug font-bold sm:text-[13pt]">{need.title}</span>
      <span className="text-[15px] font-extrabold whitespace-nowrap text-left-text sm:text-[13pt]">
        {formatLeft(need.status, need.remainingCents)}
      </span>
    </div>
  );
}
