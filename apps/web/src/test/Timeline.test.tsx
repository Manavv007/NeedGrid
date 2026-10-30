import type { TimelineEvent } from "@needgrid/shared";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Timeline, timelineModel } from "@/components/Timeline";

const event = (type: TimelineEvent["type"], at: string): TimelineEvent => ({
  type,
  at,
  label: type,
  amountCents: null,
});

const POSTED = event("created", "2026-10-20T14:00:00.000Z");
const FUNDED = event("funded", "2026-10-24T09:00:00.000Z");
const PRICE_UP = event("topping_up", "2026-10-25T08:30:00.000Z");
const ORDERED = event("ordered", "2026-10-25T10:00:00.000Z");
const DELIVERED = event("delivered", "2026-10-28T18:00:00.000Z");

const states = (status: Parameters<typeof timelineModel>[0], events: TimelineEvent[]) =>
  timelineModel(status, events).stages.map((s) => `${s.key}:${s.state}`);

describe("timelineModel", () => {
  it("open: posted done, funding now, ordered next, delivered later", () => {
    expect(states("open", [POSTED])).toEqual(["posted:done", "funded:current", "ordered:next", "delivered:later"]);
  });

  it("funded and ordered move the next stage along", () => {
    expect(states("funded", [POSTED, FUNDED])).toEqual([
      "posted:done",
      "funded:done",
      "ordered:next",
      "delivered:later",
    ]);
    expect(states("ordered", [POSTED, FUNDED, ORDERED])).toEqual([
      "posted:done",
      "funded:done",
      "ordered:done",
      "delivered:next",
    ]);
  });

  it("delivered: every stage done with its date", () => {
    const model = timelineModel("delivered", [POSTED, FUNDED, ORDERED, DELIVERED]);
    expect(model.stages.map((s) => s.at)).toEqual([POSTED.at, FUNDED.at, ORDERED.at, DELIVERED.at]);
  });

  it("topping up keeps Funded done and adds the price-went-up note", () => {
    const model = timelineModel("topping_up", [POSTED, FUNDED, PRICE_UP]);
    expect(model.stages.map((s) => s.state)).toEqual(["done", "done", "next", "later"]);
    expect(model.priceWentUp).toBe(PRICE_UP);
  });

  it("trusts the status when an event is missing (no invented date)", () => {
    const model = timelineModel("ordered", [POSTED]);
    expect(model.stages.map((s) => [s.state, s.at])).toEqual([
      ["done", POSTED.at],
      ["done", null],
      ["done", null],
      ["next", null],
    ]);
  });
});

describe("Timeline", () => {
  it("renders the four stages with dates, Now/Next/Later and the funding percent", () => {
    render(<Timeline need={{ status: "open", fundedCents: 7000, targetCents: 8400 }} events={[POSTED]} />);
    const items = within(screen.getByRole("list", { name: "Progress" })).getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual([
      "Posted, doneOct 20",
      "Funding · 83%Now",
      "OrderedNext",
      "DeliveredLater",
    ]);
    expect(items[1]).toHaveAttribute("aria-current", "step");
  });

  it("shows Price went up under Funded", () => {
    render(
      <Timeline
        need={{ status: "topping_up", fundedCents: 7100, targetCents: 7600 }}
        events={[POSTED, FUNDED, PRICE_UP]}
        variant="list"
      />,
    );
    expect(screen.getByText(/Price went up · Oct 25/)).toBeInTheDocument();
  });
});
