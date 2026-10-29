import { Link } from "react-router";
import { Button } from "@/components/ui/button";

type NotFoundPageProps = {
  title?: string;
  message?: string;
  /** The link always goes home (`/`). */
  linkLabel?: string;
};

/** States.dc.html "Not found". Pages reuse it for their own 404s (e.g. an unknown charity). */
export function NotFoundPage({
  title = "This page isn't here",
  message = "The link may be old. If it's your impact link, check it was copied in full.",
  linkLabel = "Go to NeedGrid",
}: NotFoundPageProps) {
  return (
    <div className="flex flex-1 items-center justify-center px-4 py-16">
      <section className="flex max-w-md flex-col items-center gap-3.5 rounded-2xl border bg-surface p-6 text-center">
        <p aria-hidden="true" className="text-[56px] leading-none font-extrabold tracking-[-0.04em] text-primary">
          404
        </p>
        <h1 className="text-xl font-extrabold">{title}</h1>
        <p className="max-w-70 text-sm leading-normal text-soft">{message}</p>
        <Button asChild>
          <Link to="/">{linkLabel}</Link>
        </Button>
      </section>
    </div>
  );
}
