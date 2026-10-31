import { Link } from "react-router";
import { features } from "@/lib/features";
import { STAFF_ASSISTANT_PATH } from "@/lib/links";
import { consoleTabPath, type ConsoleTab } from "./consoleTabs";

type WaitingOnYouProps = {
  counts: Readonly<Record<ConsoleTab, number>>;
  /**
   * Money actions the assistant proposed that still need approval. `null` while the count isn't
   * known; the card also needs the `moneyActions` flag (on since C-9).
   */
  approvals: number | null;
};

type Card = { key: string; count: number; title: string; hint: string; to: string };

/** "Waiting on you" (StaffConsole.dc.html): what needs a person today, each linking to where to do it. */
export function WaitingOnYou({ counts, approvals }: WaitingOnYouProps) {
  const cards: Card[] = [
    {
      key: "funded",
      count: counts.funded,
      title: "Funded, ready to buy",
      hint: "Check price and plan purchase",
      to: consoleTabPath("funded"),
    },
    {
      key: "ordered",
      count: counts.ordered,
      title: "Ordered, waiting to arrive",
      hint: "Record delivery with a photo",
      to: consoleTabPath("ordered"),
    },
  ];
  if (features.moneyActions && approvals !== null) {
    cards.push({
      key: "approvals",
      count: approvals,
      title: approvals === 1 ? "Money action to approve" : "Money actions to approve",
      hint: "From the assistant",
      to: STAFF_ASSISTANT_PATH,
    });
  }
  const waiting = cards.filter((card) => card.count > 0);

  return (
    <section aria-labelledby="waiting-heading" className="mt-6">
      <h2 id="waiting-heading" className="text-base font-extrabold">
        Waiting on you
      </h2>
      {waiting.length === 0 ? (
        <p className="mt-2 text-sm text-soft">Nothing is waiting on you right now.</p>
      ) : (
        <ul className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {waiting.map((card) => (
            <li key={card.key}>
              <Link
                to={card.to}
                className="flex min-h-11 items-center gap-3.5 rounded-xl border bg-surface p-3.5 text-foreground no-underline hover:border-border-strong hover:text-foreground"
              >
                <span
                  aria-hidden="true"
                  className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xl font-extrabold text-primary"
                >
                  {card.count}
                </span>
                <span className="flex min-w-0 flex-col">
                  <strong className="text-sm">
                    <span className="sr-only">{card.count}</span> {card.title}
                  </strong>{" "}
                  <span className="text-[13px] text-muted-foreground">{card.hint}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
