import { Check } from "lucide-react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";

/** Landing hero: the hook line, one-line explainer, two calls to action (Landing.dc.html). */
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
      </div>
      <HeroArt />
    </section>
  );
}

/** Decorative sample tiles. Hidden from screen readers: the real tiles are one click away. */
function HeroArt() {
  return (
    <div aria-hidden="true" className="grid min-w-0 flex-[1_1_380px] grid-cols-2 gap-3.5">
      <div className="flex flex-col gap-2.5 rounded-xl border bg-surface p-3.5">
        <div className="aspect-4/3 rounded-md bg-placeholder" />
        <p className="text-sm font-bold">Diapers, size 4</p>
        <div className="h-2 overflow-hidden rounded-full bg-track">
          <div className="h-full w-[83%] bg-primary" />
        </div>
        <p className="text-[13px] font-bold text-left-text">$14 left</p>
      </div>
      <div className="mt-9 flex flex-col gap-2.5 rounded-xl border bg-surface p-3.5">
        <div className="aspect-4/3 rounded-md bg-placeholder-strong" />
        <p className="text-sm font-bold">Kids' winter coats</p>
        <p className="flex items-center gap-1.25 text-[13px] font-bold text-success">
          <Check className="size-3.25" strokeWidth={3} />
          Delivered · photo posted
        </p>
      </div>
    </div>
  );
}
