import { Check } from "lucide-react";
import { Link } from "react-router";
import { ProductPhoto } from "@/components/ProductPhoto";
import { Button } from "@/components/ui/button";
import { formatUsdWhole } from "@/lib/format";
import { useOrgs } from "@/lib/queries";

/** Landing hero: the hook line, one-line explainer, two calls to action, live totals (Landing.dc.html). */
export function Hero() {
  return (
    <section className="mx-auto flex w-full max-w-300 flex-wrap items-center gap-12 px-4 pt-10 pb-12 sm:px-6 sm:pt-14">
      <div className="min-w-0 flex-[1_1_480px]">
        <h1 className="mb-4.5 text-[36px] leading-[1.05] font-extrabold tracking-[-0.035em] sm:text-[52px]">
          Shelters get 400 cans of beans and zero diapers.
        </h1>
        <p className="mb-7 max-w-130 text-[17px] leading-[1.55] text-soft sm:text-[19px]">
          Charities post the exact items they need. You fund one with PayPal. When it arrives, you get a photo.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button asChild size="lg">
            <a href="#orgs">See what's needed</a>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link to="/dashboard">See the impact</Link>
          </Button>
        </div>
        <HeroStats />
      </div>
      <HeroArt />
    </section>
  );
}

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

/**
 * "$X raised · N items delivered · 3 charities", from the charity list the page loads anyway (same
 * query as the list below, so no extra request). Display only: shown once that list has loaded.
 */
function HeroStats() {
  const orgs = useOrgs();
  if (!orgs.isSuccess || orgs.data.orgs.length === 0) return null;
  const list = orgs.data.orgs;
  const raisedCents = list.reduce((sum, org) => sum + org.stats.raisedCents, 0);
  const delivered = list.reduce((sum, org) => sum + org.stats.itemsDelivered, 0);
  return (
    <p className="mt-6 text-[15px] leading-relaxed text-soft">
      <span className="whitespace-nowrap">
        <strong className="text-foreground">{formatUsdWhole(raisedCents)}</strong> raised
      </span>{" "}
      <span aria-hidden="true">·</span>{" "}
      <span className="whitespace-nowrap">
        <strong className="text-foreground">{delivered.toLocaleString("en-US")}</strong>{" "}
        {plural(delivered, "item", "items")} delivered
      </span>{" "}
      <span aria-hidden="true">·</span>{" "}
      <span className="whitespace-nowrap">
        <strong className="text-foreground">{list.length.toLocaleString("en-US")}</strong>{" "}
        {plural(list.length, "charity", "charities")}
      </span>
    </p>
  );
}

/**
 * Real product photos for the two sample tiles: the seeded demo needs' Channel3 images (Harbor's size 4 diapers,
 * Room 12's kids' coats), hotlinked like every tile. If one fails to load, ProductPhoto shows the category
 * placeholder instead.
 */
const HERO_DIAPERS = {
  title: "Pampers Cruisers 360 Diapers Size 4",
  imageUrl: "https://cdn.trychannel3.com/a6c34137-30f7-40c0-8bd4-082328b33b61?aid=01M66CH4E4BZ61VXQYKW635GKV&mid=1Evq",
};
const HERO_COAT = {
  title: "Kids' Puffer Jacket",
  imageUrl:
    "https://cdn.trychannel3.com/cleaned/v1/86f025d5-ddb3-497f-85c3-28fa231acb70?aid=01M66CNG98WNKJQ2YDQ1VX7V9A&mid=ZO25",
};

/** Decorative sample tiles. Hidden from screen readers: the real tiles are one click away. */
function HeroArt() {
  return (
    <div aria-hidden="true" className="grid min-w-0 flex-[1_1_380px] grid-cols-2 gap-3.5">
      <div className="flex flex-col gap-2.5 rounded-xl border bg-surface p-3.5">
        <ProductPhoto
          product={HERO_DIAPERS}
          category="baby"
          className="aspect-4/3 rounded-md"
          iconClassName="size-10"
          loading="eager"
        />
        <p className="text-sm font-bold">Diapers, size 4</p>
        <div className="h-2 overflow-hidden rounded-full bg-track">
          <div className="h-full w-[83%] bg-primary" />
        </div>
        <p className="text-[13px] font-bold text-left-text">$14 left</p>
      </div>
      <div className="mt-9 flex flex-col gap-2.5 rounded-xl border bg-surface p-3.5">
        <ProductPhoto
          product={HERO_COAT}
          category="clothing"
          className="aspect-4/3 rounded-md"
          iconClassName="size-10"
          loading="eager"
        />
        <p className="text-sm font-bold">Kids' winter coats</p>
        <p className="flex items-center gap-1.25 text-[13px] font-bold text-success">
          <Check className="size-3.25" strokeWidth={3} />
          Delivered · photo posted
        </p>
      </div>
    </div>
  );
}
