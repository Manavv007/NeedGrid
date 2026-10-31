import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { ErrorState } from "@/components/ErrorState";
import { QrCode } from "@/components/QrCode";
import { buttonVariants } from "@/components/ui/button";
import { WakingUp } from "@/components/WakingUp";
import { cn } from "@/lib/utils";
import { shortUrl } from "./flyerNeeds";

type FlyerQrProps = {
  /** The absolute address the code opens. */
  url: string;
  /** Accessible name of the code. */
  label: string;
  /** "Scan to fund an item". */
  caption: string;
};

/** The big QR code at the foot of a flyer, with the address in words and the sandbox note. */
export function FlyerQr({ url, label, caption }: FlyerQrProps) {
  return (
    <div className="mt-auto flex flex-col items-center gap-5 border-t-2 border-foreground pt-6 sm:flex-row sm:gap-8 sm:pt-7">
      <QrCode value={url} label={label} className="size-44 shrink-0 sm:size-55" />
      <div className="flex min-w-0 flex-col gap-2.5 text-center sm:text-left">
        <p className="text-[26px] leading-[1.1] font-extrabold sm:text-[26pt]">{caption}</p>
        <p className="text-[15px] break-all sm:text-[13pt]">{shortUrl(url)}</p>
        <p className="text-[13px] sm:text-[11pt]">Sandbox demo, no real money</p>
      </div>
    </div>
  );
}

type FlyerMessageProps = {
  title: string;
  message: string;
  /** Up to two links, the first one primary. */
  links: ReadonlyArray<{ to: string; label: string }>;
  /** A check for good news ("Everything here is funded"), nothing for "not found". */
  goodNews?: boolean;
};

/** When there's nothing to print: no QR code to an empty wall, just where to go instead. */
export function FlyerMessage({ title, message, links, goodNews = false }: FlyerMessageProps) {
  return (
    <main className="flex min-h-svh items-center justify-center bg-placeholder px-4 py-16">
      <section className="flex max-w-md flex-col items-center gap-3.5 rounded-2xl border bg-surface p-6 text-center">
        {goodNews ? (
          <span
            aria-hidden="true"
            className="flex size-14 items-center justify-center rounded-full bg-badge-success-bg text-success"
          >
            <Check className="size-6.5" strokeWidth={3} />
          </span>
        ) : null}
        <h1 className="text-xl font-extrabold">{title}</h1>
        <p className="max-w-80 text-sm leading-normal text-soft">{message}</p>
        <div className="flex flex-wrap justify-center gap-2.5">
          {links.map((link, i) => (
            <Link key={link.to} to={link.to} className={buttonVariants({ variant: i === 0 ? "default" : "outline" })}>
              {link.label}
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}

/** Shaped like a flyer sheet; "Waking up the server…" joins it after 3 s. */
export function FlyerLoading() {
  return (
    <main className="min-h-svh bg-placeholder px-4 py-8">
      <div role="status" className="mx-auto flex w-full max-w-[8.5in] flex-col gap-6">
        <span className="sr-only">Loading the flyer…</span>
        <div aria-hidden="true" className="flex flex-col gap-5 bg-surface p-5 motion-safe:animate-pulse sm:p-14">
          <div className="h-4 w-48 rounded-md bg-placeholder" />
          <div className="h-12 w-[80%] rounded-md bg-track" />
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="h-16 rounded-[10px] bg-track" />
            ))}
          </div>
          <div className="size-44 bg-track sm:size-55" />
        </div>
        <WakingUp />
      </div>
    </main>
  );
}

export function FlyerError({ onRetry }: { onRetry: () => void }) {
  return (
    <main className="flex min-h-svh items-center justify-center bg-placeholder px-4 py-16">
      <ErrorState onRetry={onRetry} />
    </main>
  );
}

/** "Harbor Food Bank · Portland, ME" over the headline. */
export function FlyerOrgLine({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("text-[15px] font-semibold sm:text-[14pt]", className)}>{children}</p>;
}
