import { Check, X } from "lucide-react";
import { Link } from "react-router";
import { Button, buttonVariants } from "@/components/ui/button";
import { orgPath } from "@/lib/links";
import { cn } from "@/lib/utils";
import { consoleTabPath } from "../console/consoleTabs";
import { IntakeSteps } from "./IntakeSteps";
import { useFocusHeading } from "./useFocusHeading";

export type PublishStatus = "waiting" | "saving" | "done" | "failed";

export type PublishItem = {
  /** The draft row's id. */
  id: string;
  title: string;
  status: PublishStatus;
  /** The server's error message when it failed. */
  message: string | null;
};

type IntakePublishProps = {
  items: readonly PublishItem[];
  /** True = published (open), false = saved as drafts. */
  publish: boolean;
  orgSlug: string;
  onRetry: (id: string) => void;
  onAddMore: () => void;
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Step 3 (IntakePublish.dc.html): one line per need as it is saved, then what to do next. */
export function IntakePublish({ items, publish, orgSlug, onRetry, onAddMore }: IntakePublishProps) {
  const headingRef = useFocusHeading(true);
  const done = items.filter((item) => item.status === "done").length;
  const failed = items.filter((item) => item.status === "failed").length;
  const running = items.some((item) => item.status === "waiting" || item.status === "saving");
  const finished = !running && failed === 0;
  const noun = publish ? plural(items.length, "need", "needs") : plural(items.length, "draft", "drafts");

  const heading = running
    ? publish
      ? `Publishing ${noun}…`
      : `Saving ${noun}…`
    : failed > 0
      ? `${done} of ${items.length} ${publish ? "published" : "saved"}`
      : publish
        ? `Published ${noun}`
        : `Saved ${noun}`;

  return (
    <div className="flex flex-col gap-5">
      <IntakeSteps current={3} />
      <section aria-labelledby="intake-publish-heading" className="rounded-2xl border bg-surface p-5 sm:p-6">
        <p className="text-[13px] font-bold tracking-wide text-muted-foreground uppercase">Step 3 of 3</p>
        <h1
          id="intake-publish-heading"
          ref={headingRef}
          tabIndex={-1}
          className="mt-1 text-2xl font-extrabold tracking-[-0.02em] outline-none"
        >
          {heading}
        </h1>
        <p aria-live="polite" className="sr-only">
          {running ? `${done} of ${items.length} done` : heading}
        </p>
        <ol className="mt-4 flex flex-col divide-y rounded-xl border">
          {items.map((item) => (
            <PublishRow key={item.id} item={item} publish={publish} canRetry={!running} onRetry={onRetry} />
          ))}
        </ol>
        {failed > 0 && !running ? (
          <p className="mt-3 text-sm text-soft">
            {failed === 1 ? "This item isn't" : "These items aren't"} saved yet. Retry, or leave the page to drop{" "}
            {failed === 1 ? "it" : "them"}.
          </p>
        ) : null}
      </section>

      {finished ? <DonePanel count={items.length} publish={publish} orgSlug={orgSlug} onAddMore={onAddMore} /> : null}
    </div>
  );
}

type PublishRowProps = { item: PublishItem; publish: boolean; canRetry: boolean; onRetry: (id: string) => void };

function PublishRow({ item, publish, canRetry, onRetry }: PublishRowProps) {
  const note = {
    waiting: "Waiting",
    saving: publish ? "Publishing…" : "Saving…",
    done: publish ? "Published" : "Saved as draft",
    failed: item.message ?? "Couldn't save. Please try again.",
  }[item.status];

  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <StatusIcon status={item.status} />
      <span className="flex min-w-0 flex-1 flex-col">
        <strong className="text-sm break-words">{item.title}</strong>
        <span
          className={cn(
            "text-[13px]",
            item.status === "failed"
              ? "font-semibold text-danger"
              : item.status === "done"
                ? "text-success"
                : "text-soft",
          )}
        >
          {note}
        </span>
      </span>
      {item.status === "failed" ? (
        <Button variant="outline" size="sm" disabled={!canRetry} onClick={() => onRetry(item.id)}>
          Retry <span className="sr-only">{item.title}</span>
        </Button>
      ) : null}
    </li>
  );
}

function StatusIcon({ status }: { status: PublishStatus }) {
  if (status === "done") {
    return (
      <span
        aria-hidden="true"
        className="flex size-6 items-center justify-center rounded-full bg-success text-primary-foreground"
      >
        <Check className="size-3.5" strokeWidth={3.5} />
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span
        aria-hidden="true"
        className="flex size-6 items-center justify-center rounded-full bg-danger text-primary-foreground"
      >
        <X className="size-3.5" strokeWidth={3.5} />
      </span>
    );
  }
  if (status === "saving") {
    return (
      <span
        aria-hidden="true"
        className="size-6 rounded-full border-[3px] border-held border-t-primary motion-safe:animate-spin"
      />
    );
  }
  return <span aria-hidden="true" className="size-6 rounded-full border-2 border-border-strong" />;
}

type DonePanelProps = { count: number; publish: boolean; orgSlug: string; onAddMore: () => void };

function DonePanel({ count, publish, orgSlug, onAddMore }: DonePanelProps) {
  return (
    <section
      aria-labelledby="intake-done-heading"
      className="flex flex-col items-center gap-3 rounded-2xl border bg-surface p-6 text-center"
    >
      <span
        aria-hidden="true"
        className="flex size-13 items-center justify-center rounded-full bg-badge-success-bg text-success"
      >
        <Check className="size-6.5" strokeWidth={3} />
      </span>
      <h2 id="intake-done-heading" className="text-2xl font-extrabold">
        {publish ? `${plural(count, "need is", "needs are")} live` : `${plural(count, "draft", "drafts")} saved`}
      </h2>
      <p className="max-w-md text-sm text-soft">
        {publish
          ? "Donors can fund them now. They'll show up on your public page right away."
          : "They're waiting in Drafts on your needs page. Publish them when you're ready."}
      </p>
      {publish ? (
        <Link to={orgPath(orgSlug)} className={buttonVariants({ size: "lg" })}>
          View your public page
        </Link>
      ) : null}
      <div className="flex flex-wrap justify-center gap-2">
        <Button variant="outline" onClick={onAddMore}>
          Add more needs
        </Button>
        <Link
          to={publish ? "/staff" : consoleTabPath("drafts")}
          className={buttonVariants({ variant: publish ? "ghost" : "default" })}
        >
          Back to needs
        </Link>
      </div>
    </section>
  );
}
