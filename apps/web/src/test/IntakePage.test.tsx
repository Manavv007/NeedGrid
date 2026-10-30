import { STAFF_KEY_STORAGE, type PublishNeedReq } from "@needgrid/shared";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "@/mocks/node";
import { renderRoute } from "./render";

const API = "http://api.test";
const NEEDS_ROUTE = `${API}/api/staff/needs`;
const INTAKE_ROUTE = `${API}/api/staff/intake`;

const SNAPSHOT_KEYS = [
  "channel3Id",
  "fetchedAt",
  "imageUrl",
  "inStock",
  "packSize",
  "retailer",
  "title",
  "unitPriceCents",
  "url",
].sort();

beforeEach(() => {
  sessionStorage.setItem(STAFF_KEY_STORAGE, "harbor-demo-2026");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

/** Records every publish body and lets the normal mock handler answer. */
function recordPublishes() {
  const bodies: PublishNeedReq[] = [];
  server.use(
    http.post(NEEDS_ROUTE, async ({ request }) => {
      bodies.push((await request.clone().json()) as PublishNeedReq);
    }),
  );
  return bodies;
}

async function typeList(text = "2 packs size 4 diapers\n24 cans of chicken") {
  await userEvent.type(await screen.findByLabelText("Or type or paste a list"), text);
  await userEvent.click(screen.getByRole("button", { name: "Find products" }));
}

async function openReview() {
  const utils = renderRoute("/staff/intake");
  await typeList();
  await screen.findByRole("heading", { level: 1, name: "Review 6 items" });
  return utils;
}

const card = (title: string) => screen.getByRole("article", { name: title });
const includeBox = (title: string) => within(card(title)).getByRole("checkbox", { name: "Include this item" });
const summary = () => screen.getByText(/items selected/);

describe("Intake /staff/intake", () => {
  it("step 1 offers a photo and a list; the list goes to review with the server's warnings", async () => {
    vi.stubEnv("VITE_USE_MOCKS", "true");
    renderRoute("/staff/intake");
    expect(await screen.findByRole("heading", { level: 1, name: "What do you need?" })).toBeInTheDocument();
    const photo = screen.getByLabelText(/Take or upload a photo/);
    expect(photo).toHaveAttribute("type", "file");
    expect(photo).toHaveAttribute("accept", "image/*");
    expect(photo).toHaveAttribute("capture", "environment");

    await typeList();
    expect(await screen.findByRole("heading", { level: 1, name: "Review 6 items" })).toBeInTheDocument();
    const warnings = screen.getByRole("alert");
    expect(warnings).toHaveTextContent('No good product match for "Canned chicken". Paste a product link');
    expect(warnings).toHaveTextContent('One line was hard to read. We marked it "Please check".');
    expect(within(card("Peanut butter, 40 oz")).getByText(/Please check · quantity hard to read/)).toBeInTheDocument();
    expect(summary()).toHaveTextContent("4 of 6 items selected · estimated total $206");
    expect(screen.getByRole("button", { name: "Publish 4 needs" })).toBeEnabled();
  });

  it("without Cloudinary (and mocks off) the photo option says so and the list still works", async () => {
    renderRoute("/staff/intake");
    expect(await screen.findByText("Photo upload isn't set up yet")).toBeInTheDocument();
    expect(screen.queryByLabelText(/Take or upload a photo/)).not.toBeInTheDocument();
    await typeList();
    expect(await screen.findByRole("heading", { level: 1, name: "Review 6 items" })).toBeInTheDocument();
  });

  it("a photo is checked, uploaded (mock), then read", async () => {
    vi.stubEnv("VITE_USE_MOCKS", "true");
    const sent: unknown[] = [];
    server.use(
      http.post(INTAKE_ROUTE, async ({ request }) => {
        sent.push(await request.clone().json());
      }),
    );
    const user = userEvent.setup({ applyAccept: false });
    renderRoute("/staff/intake");
    const input = await screen.findByLabelText(/Take or upload a photo/);

    await user.upload(input, new File(["%PDF"], "list.pdf", { type: "application/pdf" }));
    expect(await screen.findByText(/That file isn't a photo/)).toBeInTheDocument();

    await user.upload(input, new File(["jpeg"], "shelf.jpg", { type: "image/jpeg" }));
    expect(
      await screen.findByRole("heading", { level: 1, name: "Review 6 items" }, { timeout: 3000 }),
    ).toBeInTheDocument();
    expect(sent).toEqual([{ imageUrl: expect.stringMatching(/^https:\/\/res\.cloudinary\.com\//) }]);
  });

  it("shows staged progress while the AI works, and Cancel goes back with nothing saved", async () => {
    server.use(http.post(INTAKE_ROUTE, () => delay("infinite")));
    renderRoute("/staff/intake");
    await typeList("socks");
    expect(await screen.findByRole("heading", { level: 1, name: "Working on your list…" })).toBeInTheDocument();
    expect(screen.getByText("Reading your list…", { selector: "[aria-live]" })).toBeInTheDocument();
    expect(screen.getByText("This takes 10 to 30 seconds. Nothing is published yet.")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(await screen.findByRole("heading", { level: 1, name: "What do you need?" })).toBeInTheDocument();
    expect(screen.getByLabelText("Or type or paste a list")).toHaveValue("socks");
    expect(await screen.findByText("Cancelled. Nothing was saved.")).toBeInTheDocument();
  });

  it.each([
    [429, "RATE_LIMITED", "Too many tries, wait a minute."],
    [503, "UPSTREAM", "AI isn't set up on this server."],
    [502, "UPSTREAM", "The AI didn't answer, try again."],
    [500, "INTERNAL", "We couldn't read that. Please try again."],
  ] as const)("a %i from intake says %s… then Try again works", async (status, code, message) => {
    let fail = true;
    server.use(
      http.post(INTAKE_ROUTE, () => {
        if (!fail) return undefined;
        return HttpResponse.json({ error: { code, message: "upstream detail" } }, { status });
      }),
    );
    renderRoute("/staff/intake");
    await typeList();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(message);

    fail = false;
    await userEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Review 6 items" })).toBeInTheDocument();
  });

  it("editing the quantity updates the target estimate and the total", async () => {
    await openReview();
    const diapers = card("Diapers, size 4");
    expect(within(diapers).getByText("$84")).toBeInTheDocument();
    expect(within(diapers).getByText("estimate")).toBeInTheDocument();
    expect(within(diapers).getByText("incl. 8% for tax and shipping")).toBeInTheDocument();

    const quantity = within(diapers).getByLabelText("Quantity");
    await userEvent.clear(quantity);
    await userEvent.type(quantity, "3");
    expect(within(diapers).getByText("$125")).toBeInTheDocument();
    expect(summary()).toHaveTextContent("estimated total $247");

    await userEvent.clear(quantity);
    expect(within(diapers).getByText("Enter a whole number from 1 to 10000.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish 4 needs" })).toBeDisabled();
  });

  it("a row with no product can't be ticked until a pasted link gives it one", async () => {
    await openReview();
    const chicken = card("Canned chicken");
    expect(within(chicken).getByText("No product found")).toBeInTheDocument();
    expect(includeBox("Canned chicken")).toBeDisabled();
    expect(includeBox("Canned chicken")).not.toBeChecked();

    const link = within(chicken).getByLabelText("We couldn't find a match. Paste a product link instead.");
    await userEvent.type(link, "https://www.notfound.example/ip/chicken");
    await userEvent.click(within(chicken).getByRole("button", { name: "Use this link" }));
    expect(await within(chicken).findByText(/Couldn't find a product at that link/)).toBeInTheDocument();
    expect(includeBox("Canned chicken")).toBeDisabled();

    await userEvent.clear(link);
    await userEvent.type(link, "https://www.walmart.com/ip/great-value-chunk-chicken");
    await userEvent.click(within(chicken).getByRole("button", { name: "Use this link" }));
    expect(await within(card("Canned chicken")).findByText("Great value chunk chicken")).toBeInTheDocument();
    expect(includeBox("Canned chicken")).toBeEnabled();
    expect(includeBox("Canned chicken")).toBeChecked();
    expect(screen.getByRole("button", { name: "Publish 5 needs" })).toBeEnabled();
  });

  it("an item without a server target shows Set a target; staff's own target is sent as targetCents", async () => {
    const bodies = recordPublishes();
    await openReview();
    const toothpaste = card("Toothpaste, 4 oz");
    expect(within(toothpaste).getByText("Set a target")).toBeInTheDocument();
    expect(includeBox("Toothpaste, 4 oz")).toBeDisabled();

    await userEvent.click(within(toothpaste).getByRole("button", { name: "Set target" }));
    await userEvent.type(within(toothpaste).getByLabelText("Target in dollars"), "60");
    expect(includeBox("Toothpaste, 4 oz")).toBeChecked();

    // Diapers: change the estimate to staff's own number.
    const diapers = card("Diapers, size 4");
    await userEvent.click(within(diapers).getByRole("button", { name: "Edit target" }));
    const target = within(diapers).getByLabelText("Target in dollars");
    expect(target).toHaveValue("84.00");
    await userEvent.clear(target);
    await userEvent.type(target, "90");
    expect(within(diapers).getByText("your target")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Publish 5 needs" }));
    expect(await screen.findByRole("heading", { name: "5 needs are live" })).toBeInTheDocument();
    const byTitle = new Map(bodies.map((body) => [body.title, body]));
    expect(byTitle.get("Diapers, size 4")?.targetCents).toBe(9000);
    expect(byTitle.get("Toothpaste, 4 oz")?.targetCents).toBe(6000);
    expect(byTitle.get("Laundry detergent")).not.toHaveProperty("targetCents");
  });

  it("publishes only ticked rows, one after another, with exactly the PublishNeedReq fields", async () => {
    const bodies = recordPublishes();
    await openReview();
    await userEvent.click(includeBox("Baby wipes, unscented"));
    fireEvent.change(within(card("Diapers, size 4")).getByLabelText("Needed by (optional)"), {
      target: { value: "2026-11-20" },
    });
    await userEvent.click(within(card("Diapers, size 4")).getByRole("radio", { name: "Medium" }));
    expect(summary()).toHaveTextContent("3 of 6 items selected");

    await userEvent.click(screen.getByRole("button", { name: "Publish 3 needs" }));
    expect(await screen.findByRole("heading", { name: "3 needs are live" })).toBeInTheDocument();
    expect(bodies.map((body) => body.title)).toEqual(["Diapers, size 4", "Peanut butter, 40 oz", "Laundry detergent"]);

    const [diapers] = bodies;
    expect(diapers).toEqual({
      title: "Diapers, size 4",
      description: "",
      category: "baby",
      urgency: 2,
      quantity: 2,
      unit: "pack of 150",
      product: expect.objectContaining({ title: "Parent's Choice Diapers Size 4, 150 Count", unitPriceCents: 3849 }),
      alternatives: [
        expect.objectContaining({ title: "Huggies Little Movers Size 4, 120 Count" }),
        expect.objectContaining({ title: "Pampers Cruisers Size 4, 112 Count" }),
      ],
      deadlineAt: "2026-11-20T23:59:59.000Z",
      publish: true,
    });
    for (const body of bodies) {
      expect(Object.keys(body.product).sort()).toEqual(SNAPSHOT_KEYS);
      for (const alternative of body.alternatives) expect(Object.keys(alternative).sort()).toEqual(SNAPSHOT_KEYS);
    }
  });

  it("a failed publish stays on screen with the server's message and Retry", async () => {
    let failures = 1;
    server.use(
      http.post(NEEDS_ROUTE, async ({ request }) => {
        const body = (await request.clone().json()) as PublishNeedReq;
        if (body.title !== "Peanut butter, 40 oz" || failures === 0) return undefined;
        failures -= 1;
        return HttpResponse.json({ error: { code: "INTERNAL", message: "The database is busy" } }, { status: 500 });
      }),
    );
    await openReview();
    await userEvent.click(screen.getByRole("button", { name: "Publish 4 needs" }));

    expect(await screen.findByRole("heading", { level: 1, name: "3 of 4 published" })).toBeInTheDocument();
    expect(screen.getByText("The database is busy")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /needs are live/ })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Retry Peanut butter, 40 oz" }));
    expect(await screen.findByRole("heading", { name: "4 needs are live" })).toBeInTheDocument();
    expect(screen.queryByText("The database is busy")).not.toBeInTheDocument();
  });

  it("Save as drafts sends publish: false and points to the Drafts tab", async () => {
    const bodies = recordPublishes();
    await openReview();
    await userEvent.click(screen.getByRole("button", { name: "Save as drafts" }));
    expect(await screen.findByRole("heading", { name: "4 drafts saved" })).toBeInTheDocument();
    expect(bodies.every((body) => body.publish === false)).toBe(true);
    expect(screen.getAllByRole("link", { name: "Back to needs" }).at(-1)).toHaveAttribute("href", "/staff?tab=drafts");
  });

  it("published needs show up on the public tile wall in the same tab", async () => {
    const { router } = await openReview();
    const title = within(card("Diapers, size 4")).getByLabelText("Item");
    await userEvent.clear(title);
    await userEvent.type(title, "Diapers, size 5");
    await userEvent.click(screen.getByRole("button", { name: "Publish 4 needs" }));
    await userEvent.click(await screen.findByRole("link", { name: "View your public page" }));

    expect(router.state.location.pathname).toBe("/o/harbor-food-bank");
    const tile = await screen.findByRole("article", { name: "Diapers, size 5" });
    expect(within(tile).getByText("$84 left")).toBeInTheDocument();
  });

  it("leaving with unpublished drafts asks first", async () => {
    const { router } = await openReview();
    await userEvent.click(screen.getAllByRole("link", { name: /Back to needs/ })[0] as HTMLElement);
    const dialog = await screen.findByRole("dialog", { name: "Leave without publishing?" });
    expect(dialog).toHaveTextContent("6 items on this page aren't saved yet.");

    await userEvent.click(within(dialog).getByRole("button", { name: "Stay on this page" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(router.state.location.pathname).toBe("/staff/intake");
    expect(screen.getByRole("heading", { level: 1, name: "Review 6 items" })).toBeInTheDocument();

    await userEvent.click(screen.getAllByRole("link", { name: /Back to needs/ })[0] as HTMLElement);
    await userEvent.click(await screen.findByRole("button", { name: "Leave and discard" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Needs" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/staff");
  });
});
