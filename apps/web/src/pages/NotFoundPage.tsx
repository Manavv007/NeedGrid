import { Link } from "react-router";
import { Button } from "@/components/ui/button";

/** States.dc.html "Not found". */
export function NotFoundPage() {
  return (
    <div className="flex flex-1 items-center justify-center px-4 py-16">
      <section className="flex max-w-md flex-col items-center gap-3.5 rounded-2xl border bg-surface p-6 text-center">
        <p aria-hidden="true" className="text-[56px] leading-none font-extrabold tracking-[-0.04em] text-primary">
          404
        </p>
        <h1 className="text-xl font-extrabold">This page isn't here</h1>
        <p className="max-w-70 text-sm leading-normal text-soft">
          The link may be old. If it's your impact link, check it was copied in full.
        </p>
        <Button asChild>
          <Link to="/">Go to NeedGrid</Link>
        </Button>
      </section>
    </div>
  );
}
