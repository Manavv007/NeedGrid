import { STAFF_KEY_STORAGE, type SponsorInvoiceView } from "@needgrid/shared";
import { focusManager } from "@tanstack/react-query";
import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ORG_IDS, sponsorInvoices } from "@/mocks/fixtures";
import { mockDb } from "@/mocks/mockDb";
import { server } from "@/mocks/node";
import { renderRoute } from "./render";

const INVOICES = "http://api.test/api/staff/invoices";
const ROOM12 = ORG_IDS.room12;
const [SENT, PAID] = sponsorInvoices.map((r) => r.invoice);
const PNG = SENT?.qrImageDataUrl ?? "";

beforeEach(() => {
  sessionStorage.setItem(STAFF_KEY_STORAGE, "room12-demo-2026");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function openInvoices() {
  const utils = renderRoute("/staff/invoices");
  await screen.findByRole("heading", { level: 1, name: "Sponsor invoices" }, { timeout: 10_000 });
  return utils;
}

const bodyRows = () => screen.getAllByRole("row").slice(1);
const rowFor = (name: string) => screen.getByRole("row", { name: new RegExp(name) });
/** The "Sent $X · Paid $Y" line above the list. */
const totals = () => screen.getByText((_, el) => el?.tagName === "P" && /^Sent \$/.test(el.textContent ?? ""));

/** A list the test controls (parsed by the page like any response). */
function serveInvoices(invoices: SponsorInvoiceView[]) {
  server.use(http.get(INVOICES, () => HttpResponse.json({ invoices })));
}

function invoice(fields: Partial<SponsorInvoiceView>): SponsorInvoiceView {
  if (!SENT) throw new Error("expected the fixture invoices");
  return { ...SENT, id: crypto.randomUUID(), ...fields };
}

describe("Invoices page /staff/invoices", () => {
  it("lists the fixture invoices newest first, with totals, status, created time and the nav item active", async () => {
    await openInvoices();
    expect(document.title).toBe("Invoices · Room 12 Readers · NeedGrid staff");
    expect(screen.getByRole("link", { name: "Invoices" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "New invoice with assistant" })).toHaveAttribute(
      "href",
      "/staff/assistant",
    );

    await screen.findByRole("row", { name: /Bayview Dental/ });
    expect(totals()).toHaveTextContent("Sent $52.00 · Paid $59.00");
    expect(bodyRows().map((row) => within(row).getAllByRole("cell")[0]?.textContent)).toEqual([
      "Bayview Dentaloffice@example.com",
      "Lakeside Rotarygiving@example.org",
    ]);

    const sent = rowFor("Bayview Dental");
    expect(within(sent).getByText("2 items")).toBeInTheDocument();
    expect(within(sent).getByText("$52.00")).toBeInTheDocument();
    expect(within(sent).getByText("Sent")).toBeInTheDocument();
    const created = within(sent).getByText("2 days ago");
    expect(created.tagName).toBe("TIME");
    expect(created).toHaveAttribute("datetime", SENT?.createdAt);
    expect(created).toHaveAttribute("title", expect.stringMatching(/^[A-Z][a-z]{2} \d{1,2}, \d{4}, .* UTC$/));

    const paid = rowFor("Lakeside Rotary");
    expect(within(paid).getByText("1 item")).toBeInTheDocument();
    expect(within(paid).getByText("$59.00")).toBeInTheDocument();
    expect(within(paid).getByText("Paid")).toBeInTheDocument();
  });

  it("each row has an https payer link (new tab, no opener) and copies it", async () => {
    const user = userEvent.setup();
    await openInvoices();
    const sent = await screen.findByRole("row", { name: /Bayview Dental/ });
    const open = within(sent).getByRole("link", { name: "Open payment page for Bayview Dental (opens in a new tab)" });
    expect(open).toHaveAttribute("href", SENT?.payerViewUrl);
    expect(open.getAttribute("href")).toMatch(/^https:\/\//);
    expect(open).toHaveAttribute("target", "_blank");
    expect(open).toHaveAttribute("rel", "noopener noreferrer");
    await user.click(within(sent).getByRole("button", { name: "Copy link for Bayview Dental" }));
    expect(await navigator.clipboard.readText()).toBe(SENT?.payerViewUrl);
    expect(await screen.findByText("Payment link copied")).toBeInTheDocument();
  });

  it("the QR thumbnail opens a large printable QR code", async () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => undefined);
    const user = userEvent.setup();
    await openInvoices();
    const sent = await screen.findByRole("row", { name: /Bayview Dental/ });
    await user.click(within(sent).getByRole("button", { name: /Show the payment QR code for Bayview Dental/ }));
    const dialog = await screen.findByRole("dialog", { name: "Pay Room 12 Readers" });
    expect(dialog).toHaveAttribute("data-print", "sheet");
    expect(
      within(dialog).getByRole("img", { name: "QR code to pay the invoice: Bayview Dental · 2 items · $52.00" }),
    ).toHaveAttribute("src", SENT?.qrImageDataUrl);
    await user.click(within(dialog).getByRole("button", { name: "Print" }));
    expect(print).toHaveBeenCalledTimes(1);
  });

  it("names the items when the console already loaded the needs, else only counts them", async () => {
    const { router } = renderRoute("/staff");
    await screen.findByRole("heading", { level: 1, name: "Needs" }, { timeout: 10_000 });
    await screen.findByRole("tab", { name: /^Open/ });
    await act(() => router.navigate("/staff/invoices"));
    const sent = await screen.findByRole("row", { name: /Bayview Dental/ });
    expect(
      within(within(sent).getByRole("list", { name: "Items for Bayview Dental" }))
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["Dry-erase markers", "Glue sticks"]);
    expect(within(rowFor("Lakeside Rotary")).getByText("Kids' winter coats, size 4–5")).toBeInTheDocument();
  });

  it("without the needs in this tab, only the count shows", async () => {
    await openInvoices();
    const sent = await screen.findByRole("row", { name: /Bayview Dental/ });
    expect(within(sent).getByText("2 items")).toBeInTheDocument();
    expect(within(sent).queryByRole("list")).not.toBeInTheDocument();
  });

  it("shows every status in words with an icon; totals add only sent and paid", async () => {
    serveInvoices([
      invoice({
        recipientName: "Draft Co",
        status: "draft",
        amountCents: 1000,
        payerViewUrl: null,
        qrImageDataUrl: null,
      }),
      invoice({ recipientName: "Sent Co", status: "sent", amountCents: 2000 }),
      invoice({ recipientName: "Paid Co", status: "paid", amountCents: 4050 }),
      invoice({ recipientName: "Gone Co", status: "cancelled", amountCents: 8000 }),
    ]);
    await openInvoices();
    await screen.findByRole("row", { name: /Draft Co/ });
    for (const [name, label] of [
      ["Draft Co", "Draft"],
      ["Sent Co", "Sent"],
      ["Paid Co", "Paid"],
      ["Gone Co", "Cancelled"],
    ] as const) {
      const badge = within(rowFor(name)).getByText(label);
      expect(badge.querySelector("svg[aria-hidden='true']")).not.toBeNull();
    }
    expect(totals()).toHaveTextContent("Sent $20.00 · Paid $40.50");
    expect(within(rowFor("Draft Co")).getByText("No payment link yet.")).toBeInTheDocument();
  });

  it("shows a QR code only for a base64 PNG, and a payer link only over https", async () => {
    serveInvoices([
      invoice({ recipientName: "Safe Co", qrImageDataUrl: PNG }),
      invoice({
        recipientName: "Odd Co",
        payerViewUrl: "http://pay.example.com/invoice",
        qrImageDataUrl: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
      }),
    ]);
    await openInvoices();
    const safe = await screen.findByRole("row", { name: /Safe Co/ });
    expect(within(safe).getByRole("button", { name: /Show the payment QR code for Safe Co/ })).toBeInTheDocument();
    const odd = rowFor("Odd Co");
    expect(within(odd).queryByRole("button", { name: /QR code/ })).not.toBeInTheDocument();
    expect(within(odd).queryByRole("link")).not.toBeInTheDocument();
    expect(within(odd).getByText("No payment link yet.")).toBeInTheDocument();
    expect(odd.querySelector("img")).toBeNull();
  });

  it("empty: says so and links to the assistant", async () => {
    serveInvoices([]);
    await openInvoices();
    expect(await screen.findByRole("heading", { name: "No sponsor invoices yet" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ask the assistant to invoice a sponsor" })).toHaveAttribute(
      "href",
      "/staff/assistant",
    );
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("shows an error with Try again, then the list", async () => {
    let fail = true;
    server.use(
      http.get(INVOICES, () =>
        fail ? HttpResponse.json({ error: { code: "INTERNAL", message: "boom" } }, { status: 500 }) : undefined,
      ),
    );
    await openInvoices();
    const alert = await screen.findByRole("alert");
    fail = false;
    await userEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("row", { name: /Bayview Dental/ })).toBeInTheDocument();
  });

  it("a 401 signs staff out and sends them to the login page, coming back here after", async () => {
    server.use(
      http.get(INVOICES, () =>
        HttpResponse.json(
          { error: { code: "UNAUTHORIZED", message: "Missing or invalid staff key" } },
          { status: 401 },
        ),
      ),
    );
    const { router } = renderRoute("/staff/invoices");
    await vi.waitFor(() => expect(router.state.location.pathname).toBe("/staff/login"), { timeout: 5_000 });
    expect(router.state.location.search).toBe(`?next=${encodeURIComponent("/staff/invoices")}`);
    expect(sessionStorage.getItem(STAFF_KEY_STORAGE)).toBeNull();
  });

  it("on a phone: one card per invoice, no table", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    await openInvoices();
    const list = await screen.findByRole("list", { name: "Sponsor invoices" });
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    const cards = within(list).getAllByRole("article");
    expect(cards.map((card) => within(card).getByRole("heading", { level: 2 }).textContent)).toEqual([
      "Bayview Dental",
      "Lakeside Rotary",
    ]);
    const sent = cards[0];
    if (!sent) throw new Error("expected a card");
    expect(within(sent).getByText("Sent")).toBeInTheDocument();
    expect(within(sent).getByText("$52.00")).toBeInTheDocument();
    expect(
      within(sent).getByRole("button", { name: /Show the payment QR code for Bayview Dental/ }),
    ).toBeInTheDocument();
    expect(within(sent).getByRole("link", { name: /Open payment page for Bayview Dental/ })).toBeInTheDocument();
  });

  it("an invoice approved elsewhere shows up when staff come back to the tab", async () => {
    await openInvoices();
    await screen.findByRole("row", { name: /Bayview Dental/ });
    const proposed = mockDb.proposeInvoice(ROOM12, {
      needIds: ["4c1f7a2e-9b3d-4e5f-8a6b-000000000302"],
      recipientEmail: "sponsor@example.com",
      recipientName: "Acme Hardware",
    });
    if (proposed.kind !== "ok") throw new Error("expected a proposal");
    expect(mockDb.approveAgentAction(ROOM12, proposed.action.id)).toMatchObject({ action: { status: "executed" } });
    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    expect(await screen.findByRole("row", { name: /Acme Hardware/ })).toBeInTheDocument();
    expect(bodyRows()).toHaveLength(3);
    expect(within(bodyRows()[0] ?? document.body).getByText("Acme Hardware")).toBeInTheDocument();
    focusManager.setFocused(undefined);
  });
});

describe("Invoices: the fixtures are in the ledger", () => {
  it("the sent invoice holds what was left on its needs; the paid one is a sponsor allocation", () => {
    const card = (id: string) => mockDb.listStaffNeeds(ROOM12).find((need) => need.id === id);
    for (const id of SENT?.needIds ?? []) expect(card(id)).toMatchObject({ remainingCents: 0 });
    expect(SENT?.amountCents).toBe(5200);
    const ledger = mockDb.ledgerSnapshot();
    const sponsor = ledger.allocations.filter((a) => a.reason === "sponsor");
    expect(sponsor.map((a) => [a.needId, a.amountCents])).toEqual([[PAID?.needIds[0], PAID?.amountCents]]);
    expect(ledger.donations.filter((d) => d.source === "invoice").map((d) => d.amountCents)).toEqual([5900]);
    expect(mockDb.moneyProblems()).toEqual([]);
  });
});
