import type { ReactNode } from "react";
import { externalHttpUrl } from "@/lib/links";

type OfferLinkProps = { url: string; children: ReactNode; className?: string };

/**
 * A retailer's page in a new tab. Only http(s) URLs become links (anything else renders nothing),
 * always with `rel="noopener noreferrer"`.
 */
export function OfferLink({ url, children, className }: OfferLinkProps) {
  const href = externalHttpUrl(url);
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
      {children}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}
