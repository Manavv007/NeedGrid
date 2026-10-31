import { Copy, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { httpsUrl } from "@/lib/links";
import { cn } from "@/lib/utils";

type PayerLinkProps = {
  /** The invoice's `payerViewUrl`. Only an https URL becomes a link. */
  url: string | null;
  /**
   * Small buttons for a row in a list (Invoices.dc.html "Copy link"). `recipient` names the
   * invoice for screen readers, so every row's buttons can be told apart.
   */
  compact?: boolean;
  recipient?: string;
  className?: string;
};

/**
 * The sponsor's PayPal payment page: "Copy payment link" and "Open payment page" (a new tab, without
 * an opener or referrer). Without a usable https link it says so instead.
 */
export function PayerLink({ url, compact = false, recipient, className }: PayerLinkProps) {
  const href = httpsUrl(url);
  if (!href) {
    return <p className={cn("text-sm text-muted-foreground", className)}>No payment link yet.</p>;
  }

  async function copy(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      toast.success("Payment link copied");
    } catch {
      toast.error("We couldn't copy the link", { description: "Open the payment page and copy its address." });
    }
  }

  const size = compact ? "sm" : "default";
  // Compact buttons say "Copy link" / "Open"; their names start with those words and say whose invoice it is.
  const forWhom = recipient ? ` for ${recipient}` : "";

  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      <Button
        variant="outline"
        size={size}
        onClick={() => void copy(href)}
        aria-label={compact ? `Copy link${forWhom}` : undefined}
      >
        <Copy aria-hidden="true" />
        {compact ? "Copy link" : "Copy payment link"}
      </Button>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={compact ? `Open payment page${forWhom} (opens in a new tab)` : undefined}
        className={buttonVariants({ variant: "outline", size })}
      >
        <ExternalLink aria-hidden="true" />
        {compact ? (
          "Open"
        ) : (
          <>
            Open payment page <span className="sr-only">(opens in a new tab)</span>
          </>
        )}
      </a>
    </div>
  );
}
