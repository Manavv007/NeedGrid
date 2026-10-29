import { useId } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { impactPath } from "@/lib/links";

/** "Save your impact link": there are no accounts, so this link is the donor's only way back. */
export function SaveImpactLink({ token }: { token: string }) {
  const titleId = useId();
  const inputId = useId();
  const url = new URL(impactPath(token), window.location.origin).toString();

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Impact link copied");
    } catch {
      toast.error("We couldn't copy the link", { description: "Select the link and copy it yourself." });
    }
  }

  return (
    <section
      aria-labelledby={titleId}
      className="flex flex-col gap-2.5 rounded-xl border-2 border-primary bg-surface p-4"
    >
      <h2 id={titleId} className="text-[17px] font-extrabold">
        Save your impact link
      </h2>
      <p className="text-[13px] leading-normal text-soft">
        It's the only way back to see your items arrive. No account, no emails.
      </p>
      <div className="flex gap-2">
        <label htmlFor={inputId} className="sr-only">
          Your impact link
        </label>
        <input
          id={inputId}
          type="text"
          readOnly
          value={url}
          onFocus={(event) => event.currentTarget.select()}
          className="h-11 min-w-0 flex-1 rounded-md border border-border-strong bg-background px-2.5 text-[13px] text-soft"
        />
        <Button onClick={() => void copy()}>Copy</Button>
      </div>
    </section>
  );
}
