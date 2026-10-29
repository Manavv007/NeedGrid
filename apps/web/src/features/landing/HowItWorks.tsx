const STEPS = [
  {
    title: "A charity posts exact items",
    body: "A photo of an empty shelf becomes a list of real products with real prices.",
  },
  { title: "You fund a tile", body: "Give any amount or fund the rest, through PayPal." },
  { title: "They buy it", body: "Staff approve the purchase. Every dollar is tracked to an item." },
  { title: "You see it arrive", body: "A photo lands on your impact page. No account needed." },
] as const;

export function HowItWorks() {
  return (
    <section aria-labelledby="how" className="border-y bg-surface">
      <div className="mx-auto max-w-300 px-4 py-11 sm:px-6">
        <h2 id="how" className="mb-6 text-2xl font-extrabold tracking-[-0.02em]">
          How it works
        </h2>
        <ol className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step, i) => (
            <li key={step.title} className="flex flex-col gap-2">
              <span
                aria-hidden="true"
                className="flex size-8 items-center justify-center rounded-full bg-primary-soft font-extrabold text-primary"
              >
                {i + 1}
              </span>
              <strong className="text-base">{step.title}</strong>
              <span className="text-sm leading-normal text-muted-foreground">{step.body}</span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
