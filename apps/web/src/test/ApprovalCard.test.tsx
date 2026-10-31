import { formatUsd, STAFF_KEY_STORAGE, type AgentAction, type SponsorInvoiceView } from "@needgrid/shared";
import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router";
import { Toaster } from "@/components/ui/sonner";
import { ApprovalCard } from "@/features/assistant/ApprovalCard";
import { ORG_IDS, sponsorInvoices } from "@/mocks/fixtures";
import { AMOUNTS_CHANGED_ERROR, mockDb } from "@/mocks/mockDb";
import { server } from "@/mocks/node";
import { createTestQueryClient } from "./render";

const API = "http://api.test";
const APPROVE = `${API}/api/staff/agent/actions/:id/approve`;
const ROOM12 = ORG_IDS.room12;
const WINTER_IDS = [
  "4c1f7a2e-9b3d-4e5f-8a6b-000000000301",
  "4c1f7a2e-9b3d-4e5f-8a6b-000000000302",
  "4c1f7a2e-9b3d-4e5f-8a6b-000000000303",
];
const TITLE = "Invoice Acme Hardware for 3 items";

beforeEach(() => {
  sessionStorage.setItem(STAFF_KEY_STORAGE, "room12-demo-2026");
});
afterEach(() => {
  vi.restoreAllMocks();
});

function propose(args: Record<string, unknown> = {}): AgentAction {
  const result = mockDb.proposeInvoice(ROOM12, {
    needIds: WINTER_IDS,
    recipientEmail: "sponsor@example.com",
    recipientName: "Acme Hardware",
    send: true,
    ...args,
  });
  if (result.kind !== "ok") throw new Error("expected a proposal");
  return result.action;
}

/** The card in the chat, and (with `twice`) the same action's card in the pending list. */
function renderCards(
  action: AgentAction,
  { twice = false, onAskAgain }: { twice?: boolean; onAskAgain?: () => void } = {},
) {
  const queryClient = createTestQueryClient();
  const router = createMemoryRouter([
    {
      path: "/",
      element: (
        <>
          <ApprovalCard action={action} orgName="Room 12 Readers" onAskAgain={onAskAgain} />
          {twice ? <ApprovalCard action={action} variant="compact" orgName="Room 12 Readers" /> : null}
        </>
      ),
    },
    { path: "/staff/invoices", element: <p>Invoices page</p> },
  ]);
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster />
    </QueryClientProvider>,
  );
  return { queryClient, router, cards: () => screen.getAllByRole("article") };
}

const approveIn = (card: HTMLElement) => within(card).getByRole("button", { name: /^Approve/ });
const rejectIn = (card: HTMLElement) => within(card).getByRole("button", { name: "Reject" });

describe("ApprovalCard: needs your approval", () => {
  it("shows every preview line exactly as sent, the total, and the promise; never the raw args", () => {
    const action = propose();
    renderCards(action);
    const card = screen.getByRole("article", { name: TITLE });
    expect(within(card).getByText("Needs your approval")).toBeInTheDocument();
    expect(within(card).getByText("Invoice:")).toHaveClass("sr-only");
    for (const line of action.preview.lines) {
      expect(within(card).getByRole("row", { name: `${line.label} ${line.value}` })).toBeInTheDocument();
    }
    expect(within(card).getAllByRole("row")).toHaveLength(action.preview.lines.length);
    expect(within(card).getByText(formatUsd(action.preview.totalCents ?? -1))).toBeInTheDocument();
    expect(
      within(card).getByText("Nothing happens until you approve. Amounts were calculated by NeedGrid, not the AI."),
    ).toBeInTheDocument();
    expect(approveIn(card)).toHaveAccessibleName("Approve and send");
    expect(card.textContent).not.toMatch(/needIds|planned|recipientEmail|computed|\{/);
  });

  it('says "Approve" when the invoice is only created, and hides the total when there is none', () => {
    const action = propose({ send: false });
    renderCards({ ...action, preview: { ...action.preview, totalCents: null } });
    const card = screen.getByRole("article", { name: TITLE });
    expect(approveIn(card)).toHaveAccessibleName("Approve");
    expect(within(card).queryByText("Total")).not.toBeInTheDocument();
  });

  it('marks actions the server created itself: "Created by NeedGrid"', () => {
    renderCards({ ...propose(), origin: "system" });
    expect(screen.getByText("Created by NeedGrid")).toBeInTheDocument();
  });
});

describe("ApprovalCard: deciding exactly once", () => {
  it("approves once on a double click, with the same action's card shown twice, and both show the outcome", async () => {
    const approve = vi.spyOn(mockDb, "approveAgentAction");
    let release = () => undefined as void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(http.post(APPROVE, async () => void (await gate)));
    const { cards } = renderCards(propose(), { twice: true });
    const [inline, compact] = cards();
    if (!inline || !compact) throw new Error("expected two cards");

    // Clicks before React has re-rendered, on both cards: the shared guard lets one through.
    fireEvent.click(approveIn(inline));
    fireEvent.click(approveIn(compact));
    fireEvent.click(rejectIn(compact));
    fireEvent.click(approveIn(inline));

    // Both cards show it pending, with the spinner on Approve.
    for (const card of [inline, compact]) {
      expect(await within(card).findByRole("button", { name: "Approving…" })).toBeDisabled();
      expect(within(card).getByRole("button", { name: "Reject" })).toBeDisabled();
    }
    release();

    await waitFor(() => expect(screen.getAllByText("Approved and sent")).toHaveLength(2));
    expect(approve).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Invoice sent to sponsor@example.com.")).toBeInTheDocument();
  });

  it("a real double click approves once too", async () => {
    const approve = vi.spyOn(mockDb, "approveAgentAction");
    const user = userEvent.setup();
    renderCards(propose());
    await user.dblClick(approveIn(screen.getByRole("article", { name: TITLE })));
    expect(await screen.findByText("Approved and sent")).toBeInTheDocument();
    expect(approve).toHaveBeenCalledTimes(1);
  });

  it("reject calls reject once and nothing runs", async () => {
    const approve = vi.spyOn(mockDb, "approveAgentAction");
    const reject = vi.spyOn(mockDb, "rejectAgentAction");
    const { cards } = renderCards(propose(), { twice: true });
    const [inline, compact] = cards();
    if (!inline || !compact) throw new Error("expected two cards");
    fireEvent.click(rejectIn(inline));
    fireEvent.click(rejectIn(compact));
    await waitFor(() => expect(screen.getAllByText("Rejected, nothing was sent.")).toHaveLength(2));
    expect(reject).toHaveBeenCalledTimes(1);
    expect(approve).not.toHaveBeenCalled();
    expect(await screen.findByText("Rejected. Nothing was sent.")).toBeInTheDocument();
    expect(mockDb.listSponsorInvoices(ROOM12)).toEqual(
      sponsorInvoices.filter((r) => r.orgId === ROOM12).map((r) => r.invoice),
    );
  });

  it("a 409 (decided elsewhere) refetches and shows the real outcome, without an error", async () => {
    const action = propose();
    renderCards(action);
    expect(mockDb.approveAgentAction(ROOM12, action.id).kind).toBe("ok"); // someone else, a moment ago
    await userEvent.click(approveIn(screen.getByRole("article", { name: TITLE })));
    expect(await screen.findByText("Approved and sent")).toBeInTheDocument();
    expect(await screen.findByText("This was already decided, so here is what happened.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("a network failure keeps the card, says so, and lets staff try again", async () => {
    server.use(http.post(APPROVE, () => HttpResponse.error(), { once: true }));
    const user = userEvent.setup();
    renderCards(propose());
    const card = screen.getByRole("article", { name: TITLE });
    await user.click(approveIn(card));
    expect(await within(card).findByRole("alert")).toHaveTextContent("We couldn't reach NeedGrid");
    await user.click(approveIn(card));
    expect(await screen.findByText("Approved and sent")).toBeInTheDocument();
  });
});

describe("ApprovalCard: outcomes", () => {
  it("executed invoice: payer link (https, new tab, no opener), copy, and the QR code in a printable dialog", async () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => undefined);
    const user = userEvent.setup();
    const action = propose();
    renderCards(action);
    await user.click(approveIn(screen.getByRole("article", { name: TITLE })));
    const card = await screen.findByRole("article", {
      name: `${TITLE} · ${formatUsd(action.preview.totalCents ?? 0)}`,
    });
    expect(within(card).getByText("Approved and sent")).toBeInTheDocument();
    expect(
      within(card).getByText("Sent to sponsor@example.com. When they pay, all 3 tiles fill up on their own."),
    ).toBeInTheDocument();

    const [invoice] = mockDb.listSponsorInvoices(ROOM12);
    const open = within(card).getByRole("link", { name: "Open payment page (opens in a new tab)" });
    expect(open).toHaveAttribute("href", invoice?.payerViewUrl);
    expect(open).toHaveAttribute("target", "_blank");
    expect(open).toHaveAttribute("rel", "noopener noreferrer");
    await user.click(within(card).getByRole("button", { name: "Copy payment link" }));
    expect(await navigator.clipboard.readText()).toBe(invoice?.payerViewUrl);
    expect(within(card).getByRole("link", { name: "See all invoices" })).toHaveAttribute("href", "/staff/invoices");

    await user.click(within(card).getByRole("button", { name: /Show the payment QR code for Acme Hardware/ }));
    const dialog = await screen.findByRole("dialog", { name: "Pay Room 12 Readers" });
    expect(dialog).toHaveAttribute("data-print", "sheet");
    const summary = `Acme Hardware · 3 items · ${formatUsd(action.preview.totalCents ?? 0)}`;
    expect(within(dialog).getByText(summary)).toBeInTheDocument();
    expect(within(dialog).getByRole("img", { name: `QR code to pay the invoice: ${summary}` })).toHaveAttribute(
      "src",
      invoice?.qrImageDataUrl,
    );
    await user.click(within(dialog).getByRole("button", { name: "Print" }));
    expect(print).toHaveBeenCalledTimes(1);
  });

  it("when `result` isn't an invoice, the payer link comes from the invoices list", async () => {
    server.use(
      http.post(APPROVE, ({ params }) => {
        const result = mockDb.approveAgentAction(ROOM12, String(params.id));
        if (result.kind !== "ok")
          return HttpResponse.json({ error: { code: "INTERNAL", message: "x" } }, { status: 500 });
        return HttpResponse.json({ action: { ...result.action, result: { invoiceId: "elsewhere" } } });
      }),
    );
    renderCards(propose());
    await userEvent.click(approveIn(screen.getByRole("article", { name: TITLE })));
    const link = await screen.findByRole("link", { name: "Open payment page (opens in a new tab)" });
    const [invoice] = mockDb.listSponsorInvoices(ROOM12);
    expect(invoice?.payerViewUrl).toMatch(/^https:/);
    expect(link).toHaveAttribute("href", invoice?.payerViewUrl);
  });

  it("failed: the server's reason, nothing sent, and Ask again", async () => {
    const onAskAgain = vi.fn();
    const action = propose();
    const order = mockDb.createOrder({ needId: WINTER_IDS[1] ?? "", amountCents: 500, rollOverConsent: true });
    if (order.kind === "ok") mockDb.capture(order.order.orderId); // a donor gave in between
    renderCards(action, { onAskAgain });
    await userEvent.click(approveIn(screen.getByRole("article", { name: TITLE })));
    const card = await screen.findByRole("article", { name: TITLE });
    expect(await within(card).findByText("Didn't go through")).toBeInTheDocument();
    expect(within(card).getByText(`${AMOUNTS_CHANGED_ERROR} Nothing was sent.`)).toBeInTheDocument();
    expect(await screen.findByText(AMOUNTS_CHANGED_ERROR, { selector: "[data-description]" })).toBeInTheDocument();
    await userEvent.click(within(card).getByRole("button", { name: "Ask again" }));
    expect(onAskAgain).toHaveBeenCalledTimes(1);
  });

  it("rejected: says nothing was sent", () => {
    const action = propose();
    const result = mockDb.rejectAgentAction(ROOM12, action.id);
    if (result.kind !== "ok") throw new Error("expected a rejection");
    renderCards(result.action);
    const card = screen.getByRole("article", { name: `${TITLE} · ${formatUsd(action.preview.totalCents ?? 0)}` });
    expect(within(card).getByText("Rejected, nothing was sent.")).toBeInTheDocument();
    expect(within(card).queryByRole("button")).not.toBeInTheDocument();
  });

  it("only https payer links and base64 PNG QR codes are used", () => {
    const action = propose();
    const invoice: SponsorInvoiceView = {
      id: "4c1f7a2e-9b3d-4e5f-8a6b-0000000000f1",
      paypalInvoiceId: "INV2-AAAA-BBBB-CCCC-DDDD",
      recipientEmail: "sponsor@example.com",
      recipientName: "Acme Hardware",
      needIds: WINTER_IDS,
      amountCents: 1000,
      status: "sent",
      payerViewUrl: "http://pay.example.com/invoice",
      qrImageDataUrl: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
      createdAt: new Date().toISOString(),
    };
    renderCards({ ...action, status: "executed", result: invoice, decidedAt: invoice.createdAt });
    expect(screen.getByText("No payment link yet.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Open payment page/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /QR code/ })).not.toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
  });

  it("approved but still running: says so and polls until it settles", async () => {
    const action = propose();
    renderCards({ ...action, status: "approved", decidedAt: new Date().toISOString() });
    expect(screen.getByText("Approved, working…")).toBeInTheDocument();
    // The server finishes; the card's poll picks it up.
    expect(mockDb.approveAgentAction(ROOM12, action.id).kind).toBe("ok");
    expect(await screen.findByText("Approved and sent", {}, { timeout: 5_000 })).toBeInTheDocument();
  });
});
