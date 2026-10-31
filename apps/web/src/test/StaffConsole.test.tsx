import { STAFF_KEY_STORAGE } from "@needgrid/shared";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { ORG_IDS } from "@/mocks/fixtures";
import { mockDb } from "@/mocks/mockDb";
import { server } from "@/mocks/node";
import { renderRoute } from "./render";

const API = "http://api.test";
const ID = {
  toothbrushes: "4c1f7a2e-9b3d-4e5f-8a6b-000000000109", // funded
  socks: "4c1f7a2e-9b3d-4e5f-8a6b-000000000111", // ordered
  handSoap: "4c1f7a2e-9b3d-4e5f-8a6b-000000000113", // draft with a product
} as const;

beforeEach(() => {
  sessionStorage.setItem(STAFF_KEY_STORAGE, "harbor-demo-2026");
});

const rowTitles = () =>
  within(screen.getByRole("tabpanel"))
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).getAllByRole("cell")[0]?.querySelector("strong")?.textContent ?? "");

describe("Staff console /staff", () => {
  it("shows the org, a count per status tab and what is waiting on staff", async () => {
    renderRoute("/staff");
    expect(await screen.findByRole("tab", { name: "Open 8", selected: true })).toBeInTheDocument();
    for (const name of ["Drafts 1", "Funded 2", "Ordered 1", "Delivered 1", "Closed 1"]) {
      expect(screen.getByRole("tab", { name })).toBeInTheDocument();
    }
    expect(document.title).toBe("Needs · Harbor Food Bank · NeedGrid staff");
    expect(screen.getByRole("link", { name: "Public page" })).toHaveAttribute("href", "/o/harbor-food-bank");
    expect(screen.getByRole("link", { name: "Add needs" })).toHaveAttribute("href", "/staff/intake");

    const waiting = screen.getByRole("region", { name: "Waiting on you" });
    expect(within(waiting).getByRole("link", { name: /2 Funded, ready to buy/ })).toHaveAttribute(
      "href",
      "/staff?tab=funded",
    );
    expect(within(waiting).getByRole("link", { name: /1 Ordered, waiting to arrive/ })).toHaveAttribute(
      "href",
      "/staff?tab=ordered",
    );
    expect(within(waiting).queryByText("Money action to approve")).not.toBeInTheDocument();
  });

  it("shows a money action waiting for approval, linking to the assistant", async () => {
    const proposed = mockDb.proposeInvoice(ORG_IDS.harbor, {
      needIds: ["4c1f7a2e-9b3d-4e5f-8a6b-000000000101"],
      recipientEmail: "sponsor@example.com",
    });
    expect(proposed.kind).toBe("ok");
    renderRoute("/staff");
    const waiting = await screen.findByRole("region", { name: "Waiting on you" });
    expect(await within(waiting).findByRole("link", { name: /1 Money action to approve/ })).toHaveAttribute(
      "href",
      "/staff/assistant",
    );
  });

  it("Open includes needs topping up; rows show quantity, money and donors", async () => {
    renderRoute("/staff");
    await screen.findByRole("tab", { name: "Open 8" });
    expect(rowTitles()).toContain("Canned tuna, 5 oz");
    const diapers = screen.getByRole("row", { name: /Diapers, size 4/ });
    expect(within(diapers).getByText("2 × pack of 150")).toBeInTheDocument();
    expect(within(diapers).getByText(/\$70 of \$84/)).toHaveTextContent("$70 of $84 · 6 donors");
    expect(within(diapers).getByRole("progressbar", { name: "Diapers, size 4 funding" })).toBeInTheDocument();
  });

  it("keeps the selected tab in the URL", async () => {
    const { router } = renderRoute("/staff?tab=ordered");
    expect(await screen.findByRole("tab", { name: "Ordered 1", selected: true })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Delivered 1" }));
    expect(router.state.location.search).toBe("?tab=delivered");
    expect(rowTitles()).toEqual(["Diapers, size 3"]);
  });

  it("Publish moves a draft to Open with a toast", async () => {
    const { router } = renderRoute("/staff?tab=drafts");
    await userEvent.click(await screen.findByRole("button", { name: "Publish Hand soap, 7.5 oz" }));

    expect(await screen.findByText("Hand soap, 7.5 oz is live on your public page.")).toBeInTheDocument();
    expect(await screen.findByRole("tab", { name: "Drafts 0" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Open 9" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "No drafts" })).toBeInTheDocument();
    expect(router.state.location.search).toBe("?tab=drafts");

    // It is public now.
    await router.navigate("/o/harbor-food-bank");
    expect(await screen.findByRole("article", { name: "Hand soap, 7.5 oz" })).toBeInTheDocument();
  });

  it("a refused publish keeps the row and shows the server's reason", async () => {
    server.use(
      http.patch(`${API}/api/staff/needs/:id`, () =>
        HttpResponse.json(
          { error: { code: "INVALID_STATE", message: "Choose a product before publishing" } },
          { status: 409 },
        ),
      ),
    );
    renderRoute("/staff?tab=drafts");
    await userEvent.click(await screen.findByRole("button", { name: "Publish Hand soap, 7.5 oz" }));
    expect(await screen.findByText("Choose a product before publishing")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Drafts 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish Hand soap, 7.5 oz" })).toBeEnabled();
  });

  it("funded rows plan the purchase and ordered rows record the delivery", async () => {
    const { router } = renderRoute("/staff?tab=funded");
    expect(await screen.findByRole("link", { name: "Plan purchase for Kids' toothbrushes" })).toHaveAttribute(
      "href",
      `/staff/needs/${ID.toothbrushes}`,
    );
    await userEvent.click(screen.getByRole("tab", { name: "Ordered 1" }));
    expect(screen.getByRole("link", { name: "Record delivery for Women's socks" })).toHaveAttribute(
      "href",
      `/staff/needs/${ID.socks}`,
    );
    expect(router.state.location.search).toBe("?tab=ordered");
  });

  it("shows an error with Try again when the list can't load", async () => {
    let fail = true;
    server.use(
      http.get(`${API}/api/staff/needs`, () => {
        if (!fail) return undefined;
        return HttpResponse.json({ error: { code: "INTERNAL", message: "Something broke" } }, { status: 500 });
      }),
    );
    renderRoute("/staff");
    await userEvent.click(await screen.findByRole("button", { name: "Try again" }));
    fail = false;
    await userEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("tab", { name: "Open 8" })).toBeInTheDocument();
  });
});
