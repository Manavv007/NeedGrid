import { Copy, Share } from "lucide-react";
import { useId } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { impactPath } from "@/lib/links";
import { cn } from "@/lib/utils";

type SaveImpactLinkProps = {
  token: string;
  /**
   * `prominent` right under the thank-you headline: there are no accounts and no emails, so this is
   * the donor's only way back (teal border, ThankYouPhone.dc.html). `quiet` on the impact page
   * itself, where the donor already came back once (ImpactPhone.dc.html, dashed border).
   */
  variant?: "prominent" | "quiet";
};

const TEXT = {
  prominent: {
    title: "Save this link to see your item arrive",
    body: "There's no account and no email, so this link is the only way back to your gift.",
    copy: "Copy link",
  },
  quiet: {
    title: "Save your impact link",
    body: "No account needed. This link is the only way back here, so keep it.",
    copy: "Copy",
  },
} as const;

/** The donor's impact link in a read-only field, with Copy and (where the browser can) Share. */
export function SaveImpactLink({ token, variant = "prominent" }: SaveImpactLinkProps) {
  const titleId = useId();
  const inputId = useId();
  const url = new URL(impactPath(token), window.location.origin).toString();
  const text = TEXT[variant];
  const prominent = variant === "prominent";
  // Phones have the system share sheet; most desktop browsers don't.
  const canShare = prominent && "share" in navigator;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Impact link copied");
    } catch {
      toast.error("We couldn't copy the link", { description: "Select the link and copy it yourself." });
    }
  }

  async function share() {
    try {
      await navigator.share({ title: "My NeedGrid impact link", url });
    } catch (error) {
      // Closing the share sheet is not an error.
      if (error instanceof DOMException && error.name === "AbortError") return;
      toast.error("We couldn't open sharing", { description: "Copy the link instead." });
    }
  }

  const field = (
    <>
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
        className={cn(
          "h-11 w-full min-w-0 rounded-md border border-border-strong bg-background px-2.5 text-base text-soft sm:text-[13px]",
          prominent ? "sm:flex-1" : "flex-1",
        )}
      />
    </>
  );

  return (
    <section
      aria-labelledby={titleId}
      className={cn(
        "flex flex-col gap-2.5 rounded-xl bg-surface p-4",
        prominent ? "border-2 border-primary" : "border border-dashed border-held",
      )}
    >
      <h2 id={titleId} className={prominent ? "text-[17px] font-extrabold" : "text-[15px] font-bold"}>
        {text.title}
      </h2>
      <p className="text-[13px] leading-normal text-soft">{text.body}</p>
      {prominent ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          {field}
          <div className="flex gap-2">
            <Button className="flex-1 sm:flex-none" onClick={() => void copy()}>
              <Copy aria-hidden="true" />
              {text.copy}
            </Button>
            {canShare ? (
              <Button variant="outline" className="flex-1 sm:flex-none" onClick={() => void share()}>
                <Share aria-hidden="true" />
                Share
              </Button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          {field}
          <Button onClick={() => void copy()}>{text.copy}</Button>
        </div>
      )}
    </section>
  );
}
