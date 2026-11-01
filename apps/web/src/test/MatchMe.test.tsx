import { MatchRes, OrgPageRes, type MatchReq } from "@needgrid/shared";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockDb } from "@/mocks/mockDb";
import { server } from "@/mocks/node";
import { renderRoute } from "./render";

// The box is behind `matchMe`, which is on only in mock mode; these tests turn it on.
vi.mock("@/lib/features", () => ({ features: { flyers: true, matchMe: true, moneyActions: true } }));

const MATCH = "http://api.test/api/match";
const DIAPERS_4 = "4c1f7a2e-9b3d-4e5f-8a6b-000000000101";

afterEach(() => {
  vi.restoreAllMocks();
});

type User = ReturnType<typeof userEvent.setup>;

async function openLanding() {
  const user = userEvent.setup();
  const utils = renderRoute("/");
  const box = await screen.findByRole("region", { name: "Not sure where to start?" }, { timeout: 10_000 });
  return { ...utils, user, box };
}

const textBox = () => screen.getByRole("textbox", { name: "What do you care about?" });
const budgetBox = () => screen.getByRole("textbox", { name: "Your budget" });
const results = () => screen.getByRole("list", { name: "Your matches" });

async function ask(user: User, text: string, budget?: string) {
  await user.clear(textBox());
  if (text !== "") await user.type(textBox(), text);
  if (budget !== undefined) {
    await user.clear(budgetBox());
    if (budget !== "") await user.type(budgetBox(), budget);
  }
  await user.click(screen.getByRole("button", { name: "Find matches" }));
}

/** Records every body sent to the match endpoint; the real mock still answers. */
function recordBodies(): unknown[] {
  const bodies: unknown[] = [];
  server.use(
    http.post(MATCH, async ({ request }) => {
      bodies.push(await request.clone().json());
      return undefined;
    }),
  );
  return bodies;
}

describe("Match me box (landing page, flag on)", () => {
  it("diapers for babies, $25 → exactly MatchReq → 3 cards with reasons → a card opens its need page", async () => {
    const bodies = recordBodies();
    const { user, router } = await openLanding();
    expect(budgetBox()).toHaveValue("25");
    expect(screen.getByRole("button", { name: "$25" })).toHaveAttribute("aria-pressed", "true");

    await ask(user, "  diapers for babies ");
    expect(await screen.findByText("3 matches found")).toBeInTheDocument();
    expect(bodies).toEqual([{ text: "diapers for babies", budgetCents: 2500 } satisfies MatchReq]);

    const cards = within(results()).getAllByRole("article");
    expect(cards.map((card) => within(card).getByRole("heading", { level: 3 }).textContent)).toEqual([
      "Diapers, size 4",
      "Baby wipes, unscented",
      "Infant formula, 12.4 oz",
    ]);
    const [diapers, , formula] = cards;
    if (!diapers || !formula) throw new Error("expected 3 cards");
    expect(within(diapers).getByText("AI suggestion")).toBeInTheDocument();
    expect(
      within(diapers).getByText("Your $25 covers the last of Diapers, size 4 at Harbor Food Bank"),
    ).toBeInTheDocument();
    expect(within(diapers).getByText("Harbor Food Bank")).toBeInTheDocument();
    expect(within(diapers).getByText("$14 left")).toBeInTheDocument();
    expect(within(diapers).getByRole("progressbar", { name: "Diapers, size 4 funding" })).toBeInTheDocument();
    // Display only: the budget doesn't cover the formula, so the gift goes toward it.
    expect(within(diapers).queryByText(/goes toward it/)).not.toBeInTheDocument();
    expect(within(formula).getByText("Your $25 goes toward it")).toBeInTheDocument();
    expect(within(diapers).getByRole("link", { name: "Fund it: Diapers, size 4" })).toHaveAttribute(
      "href",
      `/o/harbor-food-bank/n/${DIAPERS_4}?donate=1`,
    );

    // Nothing the donor typed is kept anywhere.
    expect(router.state.location.search).toBe("");
    expect(JSON.stringify({ ...sessionStorage, ...localStorage })).not.toContain("diapers");

    await user.click(within(diapers).getByRole("link", { name: "Diapers, size 4" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Diapers, size 4" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`/o/harbor-food-bank/n/${DIAPERS_4}`);
  });

  it("checks the form before sending: text length, budget range and dollars", async () => {
    const bodies = recordBodies();
    const { user } = await openLanding();

    await ask(user, "");
    expect(screen.getByText("Tell us a little more (at least 3 characters).")).toBeInTheDocument();
    expect(textBox()).toHaveAttribute("aria-invalid", "true");

    await user.click(textBox());
    await user.paste("x".repeat(301));
    expect(screen.getByText("301/300 characters")).toBeInTheDocument();
    expect(screen.getByText("Keep it to 300 characters or fewer.")).toBeInTheDocument();

    for (const [budget, error] of [
      ["abc", "Use dollars and cents, like 12.50."],
      ["1.234", "Use dollars and cents, like 12.50."],
      ["0.50", "The smallest budget is $1.00."],
      ["1000.01", "The largest budget is $1,000.00."],
      ["", "Enter a budget in dollars."],
    ] as const) {
      await ask(user, "warm coats", budget);
      expect(screen.getByText(error)).toBeInTheDocument();
      expect(budgetBox()).toHaveAttribute("aria-invalid", "true");
    }
    expect(bodies).toEqual([]);

    await ask(user, "warm coats", "12.5");
    await screen.findByText(/match(es)? found$/);
    expect(bodies).toEqual([{ text: "warm coats", budgetCents: 1250 }]);
  });

  it("the quick chips set the budget", async () => {
    const bodies = recordBodies();
    const { user } = await openLanding();
    await user.click(screen.getByRole("button", { name: "$50" }));
    expect(budgetBox()).toHaveValue("50");
    expect(screen.getByRole("button", { name: "$50" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "$25" })).toHaveAttribute("aria-pressed", "false");
    await ask(user, "baby");
    await screen.findByText("3 matches found");
    expect(bodies).toEqual([{ text: "baby", budgetCents: 5000 }]);
  });

  it("shows B's reason as plain text: markup stays literal", async () => {
    server.use(
      http.post(MATCH, () => {
        const page = OrgPageRes.parse(mockDb.getOrgPage("harbor-food-bank"));
        const need = page.needs.find((n) => n.id === DIAPERS_4);
        return HttpResponse.json(
          MatchRes.parse({ matches: [{ need, orgName: "Harbor Food Bank", reason: "<b>Bold</b> & <i>true</i>" }] }),
        );
      }),
    );
    const { user } = await openLanding();
    await ask(user, "diapers");
    expect(await screen.findByText("1 match found")).toBeInTheDocument();
    const card = within(results()).getByRole("article", { name: "Diapers, size 4" });
    expect(within(card).getByText("<b>Bold</b> & <i>true</i>")).toBeInTheDocument();
    expect(card.querySelector("b, i")).toBeNull();
  });

  it("429: says to wait a minute", async () => {
    for (let i = 0; i < 10; i += 1) mockDb.takeMatchRequest();
    const { user } = await openLanding();
    await ask(user, "diapers");
    expect(await screen.findByText("Too many tries, wait a minute.")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Your matches" })).not.toBeInTheDocument();
  });

  it("503: shows the server's 'resting' message as a calm note", async () => {
    mockDb.armScenario("matchResting");
    const { user } = await openLanding();
    await ask(user, "diapers");
    const note = await screen.findByText(/^The AI is resting, try again tomorrow\./);
    expect(note).toHaveAttribute("role", "status");
    expect(note).toHaveTextContent("You can still pick any item from the charities below.");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("400: the server's reason, inline", async () => {
    server.use(
      http.post(MATCH, () =>
        HttpResponse.json({ error: { code: "VALIDATION", message: "Request is invalid" } }, { status: 400 }),
      ),
    );
    const { user } = await openLanding();
    await ask(user, "diapers");
    expect(await screen.findByRole("alert")).toHaveTextContent("Request is invalid");
  });

  it("other failures: a friendly message and Retry, which sends the same request again", async () => {
    const bodies: unknown[] = [];
    server.use(
      http.post(
        MATCH,
        async ({ request }) => {
          bodies.push(await request.clone().json());
          return HttpResponse.json({ error: { code: "INTERNAL", message: "boom" } }, { status: 500 });
        },
        { once: true },
      ),
    );
    const { user } = await openLanding();
    await ask(user, "diapers for babies");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("We couldn't find matches just now. Please try again.");
    await user.click(within(alert).getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("3 matches found")).toBeInTheDocument();
    expect(bodies).toEqual([{ text: "diapers for babies", budgetCents: 2500 }]);
  });

  it("Cancel aborts the request and goes back to the form", async () => {
    let signal: AbortSignal | null = null;
    server.use(
      http.post(MATCH, async ({ request }) => {
        signal = request.signal;
        await delay("infinite");
        return HttpResponse.json({ matches: [] });
      }),
    );
    const { user } = await openLanding();
    await ask(user, "diapers");
    expect(await screen.findByText("Finding needs that fit…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Find matches" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(signal?.aborted).toBe(true));
    expect(screen.queryByText("Finding needs that fit…")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Find matches" })).toBeEnabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText(/found$/)).not.toBeInTheDocument();
  });

  it("nothing fits: says so and points to every charity's list", async () => {
    const { user } = await openLanding();
    await ask(user, "spaceship parts");
    expect(await screen.findByRole("heading", { name: "Nothing fits that right now" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See all needs" })).toHaveAttribute("href", "#orgs");
    expect(screen.getByText("No matches found")).toBeInTheDocument();
  });
});
