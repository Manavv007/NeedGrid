import { Copy, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { httpsUrl } from "@/lib/links";
import { cn } from "@/lib/utils";

type PayerLinkProps = {
  /** The invoice's `payerViewUrl`. Only an https URL becomes a link. */
  url: string | null;
  className?: string;
};

/**
 * The sponsor's PayPal payment page: "Copy payment link" and "Open payment page" (a new tab, without
 * an opener or referrer). Without a usable https link it says so instead.
 */
export function PayerLink({ url, className }: PayerLinkProps) {
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

  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      <Button variant="outline" onClick={() => void copy(href)}>
        <Copy aria-hidden="true" />
        Copy payment link
      </Button>
      <a href={href} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: "outline" })}>
        <ExternalLink aria-hidden="true" />
        Open payment page <span className="sr-only">(opens in a new tab)</span>
      </a>
    </div>
  );
}
