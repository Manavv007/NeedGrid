import { useId, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useIntake } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { applyLinkResult, productLink, type DraftRow } from "./draftRows";
import { intakeErrorMessage } from "./intakeErrors";

type ProductLinkLookupProps = {
  row: DraftRow;
  onFound: (row: DraftRow) => void;
};

/**
 * "We couldn't find a match. Paste a product link instead." Re-runs intake with the link as `text`
 * (the API looks the product up) and swaps in its first option. Nothing is saved by this either.
 */
export function ProductLinkLookup({ row, onFound }: ProductLinkLookupProps) {
  const id = useId();
  const intake = useIntake();
  const busy = useRef(false);
  const [link, setLink] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  async function lookUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const url = productLink(link);
    if (url === null) {
      setProblem("Paste a full product link that starts with https://");
      return;
    }
    if (busy.current) return;
    busy.current = true;
    setProblem(null);
    try {
      const outcome = applyLinkResult(row, await intake.mutateAsync({ req: { text: url } }));
      if (outcome.ok) {
        onFound(outcome.row);
        toast.success(`Product added to ${row.title}. Check the quantity.`);
      } else {
        setProblem(outcome.problem);
        toast.error(outcome.problem);
      }
    } catch (error) {
      const message = intakeErrorMessage(error);
      setProblem(message);
      toast.error(message);
    } finally {
      busy.current = false;
    }
  }

  return (
    <form onSubmit={(event) => void lookUp(event)} noValidate className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold">
        We couldn't find a match. Paste a product link instead.
      </label>
      <div className="flex flex-wrap gap-2">
        <input
          id={id}
          type="url"
          inputMode="url"
          autoComplete="off"
          placeholder="https://www.walmart.com/ip/…"
          value={link}
          onChange={(event) => {
            setLink(event.target.value);
            if (problem) setProblem(null);
          }}
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem ? `${id}-error` : undefined}
          className={cn(
            "h-11 min-w-0 flex-1 basis-56 rounded-md bg-surface px-3 text-base outline-none placeholder:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring",
            problem ? "border-2 border-danger" : "border border-border-strong focus-visible:border-ring",
          )}
        />
        <Button type="submit" disabled={intake.isPending}>
          {intake.isPending ? "Looking it up…" : "Use this link"}
        </Button>
      </div>
      {problem ? (
        <p id={`${id}-error`} role="alert" className="text-[13px] font-semibold text-danger">
          {problem}
        </p>
      ) : null}
    </form>
  );
}
