import { useId } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { impactPath } from "@/lib/links";
import { cn } from "@/lib/utils";

type SaveImpactLinkProps = {
  token: string;
  /**
   * `prominent` right after paying (ThankYouPhone.dc.html, teal border); `quiet` on the impact page
   * itself, where the donor already came back once (ImpactPhone.dc.html, dashed border).
   */
  variant?: "prominent" | "quiet";
};

const COPY = {
  prominent: "It's the only way back to see your items arrive. No account, no emails.",
  quiet: "No account needed. This link is the only way back here, so keep it.",
} as const;

/** "Save your impact link": there are no accounts, so this link is the donor's only way back. */
export function SaveImpactLink({ token, variant = "prominent" }: SaveImpactLinkProps) {
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
      className={cn(
        "flex flex-col gap-2.5 rounded-xl bg-surface p-4",
        variant === "prominent" ? "border-2 border-primary" : "border border-dashed border-held",
      )}
    >
      <h2 id={titleId} className={variant === "prominent" ? "text-[17px] font-extrabold" : "text-[15px] font-bold"}>
        Save your impact link
      </h2>
      <p className="text-[13px] leading-normal text-soft">{COPY[variant]}</p>
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
          // 16 px on phones: iOS zooms the page into any smaller field, read-only or not.
          className="h-11 min-w-0 flex-1 rounded-md border border-border-strong bg-background px-2.5 text-base text-soft sm:text-[13px]"
        />
        <Button onClick={() => void copy()}>Copy</Button>
      </div>
    </section>
  );
}
