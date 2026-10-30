import { STAFF_KEY_STORAGE, type PurchasePlanRes } from "@needgrid/shared";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ORG_IDS } from "@/mocks/fixtures";
import { mockDb } from "@/mocks/mockDb";
import { server } from "@/mocks/node";
import { fixtureCard, installFakeEventSource, onlyStream, sendNeedUpdate } from "./fakeEventSource";
import { renderRoute } from "./render";

const API = "http://api.test";
const HARBOR = ORG_IDS.harbor;
const ID = {
  diapers4: "4c1f7a2e-9b3d-4e5f-8a6b-000000000101", // open, $70 of $84, 6 donors
  tuna: "4c1f7a2e-9b3d-4e5f-8a6b-000000000108", // topping_up, $5 more needed
  toothbrushes: "4c1f7a2e-9b3d-4e5f-8a6b-000000000109", // funded, pricier today
  laundry: "4c1f7a2e-9b3d-4e5f-8a6b-000000000110", // funded, cheaper today
  socks: "4c1f7a2e-9b3d-4e5f-8a6b-000000000111", // ordered, TGT-4417-2290
  diapers3: "4c1f7a2e-9b3d-4e5f-8a6b-000000000112", // delivered, 93% match
  handSoap: "4c1f7a2e-9b3d-4e5f-8a6b-000000000113", // draft
  paperTowels: "4c1f7a2e-9b3d-4e5f-8a6b-000000000114", // closed
  enzyme: "4c1f7a2e-9b3d-4e5f-8a6b-000000000208", // Paws, funded, exact
  snacks: "4c1f7a2e-9b3d-4e5f-8a6b-000000000307", // Room 12, funded, hand-written product
} as const;

const page = (id: string) => `/staff/needs/${id}`;

beforeEach(() => {
  sessionStorage.setItem(STAFF_KEY_STORAGE, "harbor-demo-2026");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** A paragraph whose whole text (across <strong>s) is exactly `text`. */
const paragraph = (text: string) => screen.getByText((_, el) => el?.tagName === "P" && el.textContent === text);
const findParagraph = (text: string) => screen.findByText((_, el) => el?.tagName === "P" && el.textContent === text);
const step = (name: RegExp) => screen.getByRole("region", { name });

async function openPage(id: string, title: string) {
  const utils = renderRoute(page(id));
  await screen.findByRole("heading", { level: 1, name: title });
  return utils;
}

function planOf(orgId: string, id: string): PurchasePlanRes {
  const result = mockDb.planPurchase(orgId, id);
  if (result.kind !== "ok") throw new Error(`expected a plan, got ${result.kind}`);
  return result.plan;
}

describe("Staff need page /staff/needs/:id by status", () => {
  it("open: header, progress, links, waiting for donations, timeline", async () => {
    renderRoute(page(ID.diapers4));
    expect(await screen.findByText("Loading this need…")).toBeInTheDocument();
    await screen.findByRole("heading", { level: 1, name: "Diapers, size 4" });

    expect(document.title).toBe("Diapers, size 4 · Harbor Food Bank · NeedGrid staff");
    expect(screen.getByText("Open", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByText(/^2 × pack of 150/)).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Diapers, size 4 funding" })).toHaveAttribute(
      "aria-valuenow",
      "7000",
    );
    expect(paragraph("$70 of $84 · 6 donors")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View public page" })).toHaveAttribute(
      "href",
      `/o/harbor-food-bank/n/${ID.diapers4}`,
    );
    expect(screen.getByRole("link", { name: "Back to needs" })).toHaveAttribute("href", "/staff");
    expect(screen.getByRole("button", { name: "Edit need" })).toBeInTheDocument();

    expect(step(/Waiting for donations/)).toHaveTextContent("$14.00 left of $84.00");
    expect(screen.queryByRole("button", { name: /Check price/ })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Where this item is" })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Progress" })).toBeInTheDocument();
  });

  it("draft: not public, and Publish uses the same PATCH as the console", async () => {
    await openPage(ID.handSoap, "Hand soap, 7.5 oz");
    expect(screen.queryByRole("link", { name: "View public page" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to needs" })).toHaveAttribute("href", "/staff?tab=drafts");

    await userEvent.click(within(step(/This is a draft/)).getByRole("button", { name: "Publish" }));
    expect(await screen.findByText("Hand soap, 7.5 oz is live on your public page.")).toBeInTheDocument();
    expect(await screen.findByRole("region", { name: /Waiting for donations/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View public page" })).toBeInTheDocument();
  });

  it("funded with no plan: Check price & plan purchase, and Step 2 locked", async () => {
    await openPage(ID.laundry, "Laundry detergent");
    expect(screen.getByRole("button", { name: "Check price & plan purchase" })).toBeInTheDocument();
    const order = step(/Step 2 · Buy it and mark as ordered/);
    expect(order).toHaveTextContent("Unlocks after approval");
    expect(within(order).getByLabelText("Retailer order number")).toBeDisabled();
    expect(within(order).getByRole("button", { name: "Mark as ordered" })).toBeDisabled();
    expect(within(order).queryByRole("link")).not.toBeInTheDocument();
  });

  it("funded with a proposed plan from earlier: shows it, and asks for a fresh check for the money outcome", async () => {
    planOf(HARBOR, ID.laundry);
    await openPage(ID.laundry, "Laundry detergent");
    const card = step(/Step 1 · Approve the purchase/);
    expect(within(card).getByText("Tide Original Liquid Laundry Detergent, 92 fl oz")).toBeInTheDocument();
    expect(within(card).getByText("Price in this plan")).toBeInTheDocument();
    expect(within(card).queryByText("Cheaper")).not.toBeInTheDocument();
    expect(paragraph("Check the price again to see what happens to the money before you approve.")).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Approve purchase" })).toBeEnabled();
    expect(within(card).getByRole("button", { name: "Check the price again" })).toBeInTheDocument();
    expect(step(/Step 2/)).toHaveTextContent("Unlocks after approval");
  });

  it("funded with an approved purchase: Step 2 unlocked with the buy link", async () => {
    mockDb.approvePurchase(HARBOR, planOf(HARBOR, ID.laundry).purchase.id);
    await openPage(ID.laundry, "Laundry detergent");
    expect(step(/Step 1 · Purchase approved/)).toHaveTextContent("$13.49 each at Target");
    const order = step(/Step 2/);
    expect(order).not.toHaveTextContent("Unlocks");
    expect(within(order).getByRole("link", { name: /Buy it at Target/ })).toHaveAttribute(
      "href",
      "https://www.target.com/search?q=tide%20original%20liquid%20detergent%2092%20oz",
    );
    expect(within(order).getByLabelText("Retailer order number")).toBeEnabled();
  });

  it("topping up after a pricier approval: waiting for the gap, Step 2 locked until funded again", async () => {
    await openPage(ID.tuna, "Canned tuna, 5 oz");
    expect(step(/Step 1 · Purchase approved/)).toHaveTextContent("Waiting for $5.00 more from donors");
    const order = step(/Step 2/);
    expect(order).toHaveTextContent("Unlocks when it's fully funded again");
    expect(within(order).getByRole("button", { name: "Mark as ordered" })).toBeDisabled();
  });

  it("ordered: waiting for delivery with the order number and a delivery placeholder with no actions", async () => {
    await openPage(ID.socks, "Women's socks");
    const ordered = step(/Waiting for delivery/);
    expect(ordered).toHaveTextContent("Target on");
    expect(ordered).toHaveTextContent("TGT-4417-2290");
    const slot = step(/Record the delivery/);
    expect(slot).toHaveTextContent("Recording the delivery comes in the next update");
    expect(within(slot).queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit need" })).toBeInTheDocument();
  });

  it("delivered: read-only success card with both photos, the match meter and the message", async () => {
    await openPage(ID.diapers3, "Diapers, size 3");
    const card = step(/Delivered, donors have been updated/);
    expect(within(card).getByRole("meter", { name: "Photo match score" })).toHaveAttribute("aria-valuenow", "93");
    expect(within(card).getByText("Photo match 93%")).toBeInTheDocument();
    expect(within(card).getByRole("img", { name: "Diapers, size 3 after it arrived" })).toBeInTheDocument();
    expect(within(card).getByText(/were on the shelf by lunch/)).toBeInTheDocument();
    expect(within(card).getByText("7 donors can now see this photo on their impact page.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit need" })).not.toBeInTheDocument();
  });

  it("closed: read-only, not public, no Edit", async () => {
    await openPage(ID.paperTowels, "Paper towels");
    expect(step(/This need is closed/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit need" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "View public page" })).not.toBeInTheDocument();
  });

  it.each([
    ["an unknown id", "4c1f7a2e-9b3d-4e5f-8a6b-000000000999"],
    ["a malformed id", "not-a-uuid"],
    ["another charity's need", ID.enzyme],
  ])("404 for %s", async (_, id) => {
    renderRoute(page(id));
    expect(await screen.findByRole("heading", { name: "We couldn't find that need" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to needs" })).toHaveAttribute("href", "/staff");
  });

  it("shows an error with Try again when the need can't load", async () => {
    let fail = true;
    server.use(
      http.get(`${API}/api/staff/needs/:id`, () =>
        fail ? HttpResponse.json({ error: { code: "INTERNAL", message: "boom" } }, { status: 500 }) : undefined,
      ),
    );
    renderRoute(page(ID.laundry));
    const alert = await screen.findByRole("alert");
    fail = false;
    await userEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Laundry detergent" })).toBeInTheDocument();
  });

  it("refetches when a live update arrives for this need", async () => {
    installFakeEventSource();
    await openPage(ID.diapers4, "Diapers, size 4");
    const order = mockDb.createOrder({ needId: ID.diapers4, amountCents: 1000, rollOverConsent: true });
    if (order.kind !== "ok") throw new Error("expected an order");
    mockDb.capture(order.order.orderId);
    sendNeedUpdate(fixtureCard("harbor-food-bank", ID.diapers4), onlyStream());
    expect(await findParagraph("$80 of $84 · 7 donors")).toBeInTheDocument();
  });
});

describe("Purchase plan", () => {
  it("demo flow: cheaper offer → surplus to the next need → approve → mark as ordered", async () => {
    await openPage(ID.laundry, "Laundry detergent");
    await userEvent.click(screen.getByRole("button", { name: "Check price & plan purchase" }));

    const card = await screen.findByRole("region", { name: /Step 1 · Approve the purchase/ });
    expect(within(card).getByText("Price now")).toBeInTheDocument();
    expect(within(card).getByText("Cheaper")).toBeInTheDocument();
    expect(within(card).getByText("$14.59")).toHaveClass("line-through");
    expect(within(card).getByText("$13.49")).toBeInTheDocument();
    expect(
      within(within(card).getByRole("list", { name: "What the price check found" }))
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["Price dropped 8%", "In stock"]);
    expect(within(card).getByText(/^Same product as posted, now \$1\.10 cheaper/)).toBeInTheDocument();
    expect(within(card).getByText("AI check:")).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: /^Open offer/ })).toHaveAttribute("rel", "noopener noreferrer");
    expect(paragraph("$7.00 surplus will move to Diapers, size 4, your next most urgent need.")).toBeInTheDocument();
    expect(within(card).getByText("Calculated by NeedGrid, not the AI.")).toBeInTheDocument();
    expect(step(/Step 2/)).toHaveTextContent("Unlocks after approval");

    await userEvent.click(within(card).getByRole("button", { name: "Approve purchase" }));
    expect(await screen.findByText("Approved. $7.00 moved to Diapers, size 4.")).toBeInTheDocument();
    expect(await screen.findByRole("region", { name: /Step 1 · Purchase approved/ })).toBeInTheDocument();

    const order = step(/Step 2/);
    await userEvent.type(within(order).getByLabelText("Retailer order number"), "  TGT-2000-55  ");
    await userEvent.click(within(order).getByRole("button", { name: "Mark as ordered" }));
    expect(await screen.findByText("Marked as ordered")).toBeInTheDocument();
    expect(await screen.findByRole("region", { name: /Waiting for delivery/ })).toHaveTextContent("TGT-2000-55");

    // The next need's tile moved on the public wall.
    expect(mockDb.getOrgPage("harbor-food-bank")?.needs.find((n) => n.id === ID.diapers4)?.fundedCents).toBe(7700);
  });

  it("shows the staged wait while the price check runs", async () => {
    let release = () => undefined as void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.post(`${API}/api/staff/needs/:id/purchase-plan`, async () => {
        await gate;
        return undefined;
      }),
    );
    await openPage(ID.laundry, "Laundry detergent");
    await userEvent.click(screen.getByRole("button", { name: "Check price & plan purchase" }));
    expect(await screen.findAllByText("Checking the latest price…")).not.toHaveLength(0);
    release();
    expect(await screen.findByRole("button", { name: "Approve purchase" })).toBeInTheDocument();
  });

  it("pricier: gap wording, 'ask for $X more', other offers as information only", async () => {
    await openPage(ID.toothbrushes, "Kids' toothbrushes");
    await userEvent.click(screen.getByRole("button", { name: "Check price & plan purchase" }));
    const card = await screen.findByRole("region", { name: /Step 1 · Approve the purchase/ });

    expect(within(card).getByText("Pricier")).toBeInTheDocument();
    expect(paragraph("Price went up: the tile will ask donors for $3.00 more.")).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Hide other offers" })).toHaveAttribute("aria-expanded", "true");
    expect(within(card).getByText("Other offers we found")).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: /Open offer: Oral-B Kids Extra Soft/ })).toHaveAttribute(
      "href",
      expect.stringMatching(/^https:\/\/www\.walmart\.com\//),
    );
    // No way to send a chosen offer: no radios, no re-check button.
    expect(within(card).queryAllByRole("radio")).toHaveLength(0);
    expect(within(card).queryByRole("button", { name: /Re-check/ })).not.toBeInTheDocument();

    await userEvent.click(within(card).getByRole("button", { name: "Approve and ask for $3 more" }));
    expect(await screen.findByText("Approved. Donors will be asked for $3.00 more.")).toBeInTheDocument();
    expect(await screen.findByText("Waiting for $3.00 more from donors")).toBeInTheDocument();
    expect(screen.getByText("Price went up", { selector: "span" })).toBeInTheDocument();
    expect(step(/Step 2/)).toHaveTextContent("Unlocks when it's fully funded again");
  });

  it("exact: Funds match exactly, and a plain Approved toast", async () => {
    sessionStorage.setItem(STAFF_KEY_STORAGE, "paws-demo-2026");
    await openPage(ID.enzyme, "Enzyme cleaner, 1 gal");
    await userEvent.click(screen.getByRole("button", { name: "Check price & plan purchase" }));
    expect(await screen.findByText("Funds match exactly.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "See other offers" })).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(screen.getByRole("button", { name: "Approve purchase" }));
    expect(await screen.findByText("Approved.")).toBeInTheDocument();
  });

  it("hand-written product: the manual flag, same price, no other offers", async () => {
    sessionStorage.setItem(STAFF_KEY_STORAGE, "room12-demo-2026");
    await openPage(ID.snacks, "Snacks for reading club");
    await userEvent.click(screen.getByRole("button", { name: "Check price & plan purchase" }));
    const card = await screen.findByRole("region", { name: /Step 1 · Approve the purchase/ });
    expect(within(card).getByText("Price not refreshed: manual product")).toBeInTheDocument();
    expect(within(card).getByText("Same price")).toBeInTheDocument();
    expect(paragraph("Funds match exactly.")).toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: /other offers/ })).not.toBeInTheDocument();
  });

  it("shows the money outcome exactly as the server sent it", async () => {
    server.use(
      http.post(`${API}/api/staff/needs/:id/purchase-plan`, ({ params }) => {
        const plan = planOf(HARBOR, String(params.id));
        // Not what raised minus new cost would give: the browser must not recompute it.
        return HttpResponse.json({ ...plan, money: { kind: "surplus", cents: 1234, nextNeed: null } });
      }),
    );
    await openPage(ID.laundry, "Laundry detergent");
    await userEvent.click(screen.getByRole("button", { name: "Check price & plan purchase" }));
    expect(await screen.findByText("$12.34 surplus")).toBeInTheDocument();
    expect(paragraph("$12.34 surplus will stay on this item.")).toBeInTheDocument();
  });

  it.each([
    [503, "UPSTREAM", "AI isn't set up on this server."],
    [502, "UPSTREAM", "Couldn't check the price, try again."],
  ])("a %i from the price check says so and keeps the button", async (status, code, message) => {
    server.use(
      http.post(`${API}/api/staff/needs/:id/purchase-plan`, () =>
        HttpResponse.json({ error: { code, message: "upstream" } }, { status }),
      ),
    );
    await openPage(ID.laundry, "Laundry detergent");
    await userEvent.click(screen.getByRole("button", { name: "Check price & plan purchase" }));
    expect(await screen.findByText(message, { selector: "p.text-danger" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check price & plan purchase" })).toBeEnabled();
  });

  it("a 409 from the price check shows the server's message and refetches", async () => {
    await openPage(ID.laundry, "Laundry detergent");
    // Someone raised the target meanwhile: the need is open again.
    mockDb.patchStaffNeed(HARBOR, ID.laundry, { targetCents: 20_000 });
    await userEvent.click(screen.getByRole("button", { name: "Check price & plan purchase" }));
    expect(
      await screen.findAllByText("The price can only be checked once the item is fully funded (it is open now)"),
    ).not.toHaveLength(0);
    expect(await screen.findByRole("region", { name: /Waiting for donations/ })).toBeInTheDocument();
  });

  it("approves exactly once on a double click", async () => {
    const approve = vi.spyOn(mockDb, "approvePurchase");
    await openPage(ID.laundry, "Laundry detergent");
    await userEvent.click(screen.getByRole("button", { name: "Check price & plan purchase" }));
    await userEvent.dblClick(await screen.findByRole("button", { name: "Approve purchase" }));
    expect(await screen.findByText("Approved. $7.00 moved to Diapers, size 4.")).toBeInTheDocument();
    expect(await screen.findByRole("region", { name: /Step 1 · Purchase approved/ })).toBeInTheDocument();
    expect(approve).toHaveBeenCalledTimes(1);
  });

  it("a 409 on approve shows the server's message and refetches the page", async () => {
    await openPage(ID.laundry, "Laundry detergent");
    await userEvent.click(screen.getByRole("button", { name: "Check price & plan purchase" }));
    const approveButton = await screen.findByRole("button", { name: "Approve purchase" });
    mockDb.patchStaffNeed(HARBOR, ID.laundry, { targetCents: 20_000 });
    await userEvent.click(approveButton);
    expect(
      await screen.findByText("A purchase can only be approved while the item is funded (it is open now)"),
    ).toBeInTheDocument();
    expect(await screen.findByRole("region", { name: /Waiting for donations/ })).toBeInTheDocument();
  });

  it("mark as ordered checks the order number before sending, then sends it trimmed", async () => {
    const markOrdered = vi.spyOn(mockDb, "markOrdered");
    const { purchase } = planOf(HARBOR, ID.laundry);
    mockDb.approvePurchase(HARBOR, purchase.id);
    await openPage(ID.laundry, "Laundry detergent");
    const order = step(/Step 2/);
    const input = within(order).getByLabelText("Retailer order number");
    const submit = within(order).getByRole("button", { name: "Mark as ordered" });

    await userEvent.click(submit);
    expect(within(order).getByText("Enter the order number from the retailer's confirmation.")).toBeInTheDocument();
    expect(input).toHaveAttribute("aria-invalid", "true");

    await userEvent.click(input);
    await userEvent.paste("x".repeat(101));
    expect(within(order).getByText("Keep the order number under 100 characters.")).toBeInTheDocument();
    await userEvent.click(submit);
    expect(markOrdered).not.toHaveBeenCalled();

    await userEvent.clear(input);
    await userEvent.type(input, " WM-118 ");
    await userEvent.click(submit);
    expect(await screen.findByText("Marked as ordered")).toBeInTheDocument();
    expect(markOrdered).toHaveBeenCalledTimes(1);
    expect(markOrdered).toHaveBeenCalledWith(HARBOR, purchase.id, { orderRef: "WM-118" });
  });

  it("a refused mark as ordered keeps the form with the server's reason", async () => {
    mockDb.approvePurchase(HARBOR, planOf(HARBOR, ID.laundry).purchase.id);
    server.use(
      http.post(`${API}/api/staff/purchases/:id/ordered`, () =>
        HttpResponse.json(
          { error: { code: "INVALID_STATE", message: "Only an approved purchase can be marked as ordered" } },
          { status: 409 },
        ),
      ),
    );
    await openPage(ID.laundry, "Laundry detergent");
    const order = step(/Step 2/);
    await userEvent.type(within(order).getByLabelText("Retailer order number"), "TGT-1");
    await userEvent.click(within(order).getByRole("button", { name: "Mark as ordered" }));
    expect(await within(order).findByText("Only an approved purchase can be marked as ordered")).toBeInTheDocument();
    expect(within(order).getByRole("button", { name: "Mark as ordered" })).toBeEnabled();
  });
});
