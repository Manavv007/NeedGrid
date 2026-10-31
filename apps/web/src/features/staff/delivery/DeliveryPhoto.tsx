import { ImageIcon } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

type DeliveryPhotoProps = { url: string; alt: string; className?: string };

/** The arrival photo as the server stored it (`object-cover`), with a placeholder if it fails to load. */
export function DeliveryPhoto({ url, alt, className }: DeliveryPhotoProps) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (failedUrl === url) {
    return (
      <div
        role="img"
        aria-label={`${alt} (the photo didn't load)`}
        className={cn("flex items-center justify-center bg-placeholder-strong text-placeholder-icon", className)}
      >
        <ImageIcon aria-hidden="true" className="size-8" strokeWidth={1.5} />
      </div>
    );
  }
  return (
    <img
      src={url}
      alt={alt}
      decoding="async"
      className={cn("bg-placeholder-strong object-cover", className)}
      onError={() => setFailedUrl(url)}
    />
  );
}
