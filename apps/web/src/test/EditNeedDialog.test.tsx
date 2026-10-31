import { STAFF_KEY_STORAGE } from "@needgrid/shared";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ORG_IDS } from "@/mocks/fixtures";
import { mockDb } from "@/mocks/mockDb";
import { renderRoute } from "./render";

const HARBOR = ORG_IDS.harbor;
const ID = {
  diapers4: "4c1f7a2e-9b3d-4e5f-8a6b-000000000101", // open, $70 raised of $84, one alternative, has a deadline
  oats: "4c1f7a2e-9b3d-4e5f-8a6b-000000000107", // open, nothing raised yet
  socks: "4c1f7a2e-9b3d-4e5f-8a6b-000000000111", // ordered
} as const;

beforeEach(() => {
  sessionStorage.setItem(STAFF_KEY_STORAGE, "harbor-demo-2026");
});
afterEach(() => {
  vi.restoreAllMocks();
});

async function openEditor(id: string, title: string) {
  const utils = renderRoute(`/staff/needs/${id}`);
  await screen.findByRole("heading", { level: 1, name: title });
  await userEvent.click(screen.getByRole("button", { name: "Edit need" }));
  const dialog = await screen.findByRole("dialog", { name: "Edit need" });
  return { ...utils, dialog };
}

async function replace(field: HTMLElement, text: string) {
  await userEvent.clear(field);
  if (text !== "") await userEvent.type(field, text);
}

describe("Edit need dialog", () => {
  it("sends only the fields that changed, then saves, toasts and closes", async () => {
    const patch = vi.spyOn(mockDb, "patchStaffNeed");
    const { dialog } = await openEditor(ID.diapers4, "Diapers, size 4");
    expect(within(dialog).getByLabelText("Title")).toHaveValue("Diapers, size 4");
    expect(within(dialog).getByLabelText("Target ($)")).toHaveValue("84");

    await replace(within(dialog).getByLabelText("Title"), "Diapers, size 4 (Pampers)");
    await userEvent.selectOptions(within(dialog).getByLabelText("Urgency"), "Medium");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("Changes saved.")).toBeInTheDocument();
    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledWith(HARBOR, ID.diapers4, { title: "Diapers, size 4 (Pampers)", urgency: 2 });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(await screen.findByRole("heading", { level: 1, name: "Diapers, size 4 (Pampers)" })).toBeInTheDocument();
  });

  it("closes without a request when nothing changed", async () => {
    const patch = vi.spyOn(mockDb, "patchStaffNeed");
    const { dialog } = await openEditor(ID.diapers4, "Diapers, size 4");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(patch).not.toHaveBeenCalled();
  });

  it("locks the quantity once money arrived and shows the minimum target", async () => {
    const { dialog } = await openEditor(ID.diapers4, "Diapers, size 4");
    const quantity = within(dialog).getByLabelText("Quantity");
    expect(quantity).toBeDisabled();
    expect(quantity).toHaveAccessibleDescription(
      "Quantity is locked because donations came in. Target can't go below $70 (raised plus held).",
    );
  });

  it("lets the quantity change before any money arrived", async () => {
    const patch = vi.spyOn(mockDb, "patchStaffNeed");
    const { dialog } = await openEditor(ID.oats, "Rolled oats, 42 oz");
    const quantity = within(dialog).getByLabelText("Quantity");
    expect(quantity).toBeEnabled();
    await replace(quantity, "12");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("Changes saved.")).toBeInTheDocument();
    expect(patch).toHaveBeenCalledWith(HARBOR, ID.oats, { quantity: 12 });
  });

  it("checks the target's format itself, and shows the server's refusal for a target below funded + held", async () => {
    const patch = vi.spyOn(mockDb, "patchStaffNeed");
    const { dialog } = await openEditor(ID.diapers4, "Diapers, size 4");
    const target = within(dialog).getByLabelText("Target ($)");

    await replace(target, "12.345");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));
    expect(within(dialog).getByText("Use dollars and cents, like 84.00.")).toBeInTheDocument();
    expect(patch).not.toHaveBeenCalled();

    await replace(target, "50");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "The target can't be below what's already raised or on hold ($70.00)",
    );
    expect(patch).toHaveBeenCalledWith(HARBOR, ID.diapers4, { targetCents: 5000 });
    expect(screen.getByRole("dialog", { name: "Edit need" })).toBeInTheDocument();
  });

  it("swaps the product to an alternative before funding, and clears the deadline", async () => {
    const patch = vi.spyOn(mockDb, "patchStaffNeed");
    const { dialog } = await openEditor(ID.diapers4, "Diapers, size 4");
    await userEvent.selectOptions(
      within(dialog).getByLabelText("Product"),
      within(dialog).getByRole("option", { name: /Huggies Little Movers/ }),
    );
    await userEvent.click(within(dialog).getByRole("button", { name: "Clear the date" }));
    expect(within(dialog).getByLabelText("Needed by")).toHaveValue("");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("Changes saved.")).toBeInTheDocument();
    const [, , body] = patch.mock.calls[0] ?? [];
    expect(Object.keys(body ?? {}).sort()).toEqual(["deadlineAt", "product"]);
    expect(body).toMatchObject({ deadlineAt: null, product: { title: expect.stringMatching(/^Huggies/) } });
  });

  it("explains locked fields on an ordered need", async () => {
    const { dialog } = await openEditor(ID.socks, "Women's socks");
    const target = within(dialog).getByLabelText("Target ($)");
    expect(target).toBeDisabled();
    expect(target).toHaveAccessibleDescription(
      "Quantity is locked because donations came in. The target can't change once the item is ordered.",
    );
  });

  it("Esc closes the dialog and returns focus to the Edit button", async () => {
    await openEditor(ID.diapers4, "Diapers, size 4");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit need" })).toHaveFocus();
  });

  it("Close this need… asks first, and shows the server's refusal when money is attached", async () => {
    const { dialog } = await openEditor(ID.diapers4, "Diapers, size 4");
    await userEvent.click(within(dialog).getByRole("button", { name: "Close this need…" }));
    const confirm = await screen.findByRole("dialog", { name: "Close Diapers, size 4?" });
    expect(confirm).toHaveAccessibleDescription("It disappears from the public page.");

    await userEvent.click(within(confirm).getByRole("button", { name: "Close need" }));
    expect(await within(confirm).findByRole("alert")).toHaveTextContent(
      "This need has donations attached, so it can't be closed yet",
    );

    await userEvent.click(within(confirm).getByRole("button", { name: "Keep it" }));
    expect(screen.queryByRole("dialog", { name: /Close Diapers/ })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Edit need" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close this need…" })).toHaveFocus();
    expect(mockDb.getStaffNeedDetail(HARBOR, ID.diapers4)?.need.status).toBe("open");
  });

  it("closes a need with no money: toast, read-only page, focus on the heading", async () => {
    const { dialog } = await openEditor(ID.oats, "Rolled oats, 42 oz");
    await userEvent.click(within(dialog).getByRole("button", { name: "Close this need…" }));
    const confirm = await screen.findByRole("dialog", { name: "Close Rolled oats, 42 oz?" });
    await userEvent.click(within(confirm).getByRole("button", { name: "Close need" }));

    expect(await screen.findByText("Rolled oats, 42 oz is closed.")).toBeInTheDocument();
    expect(await screen.findByRole("region", { name: /This need is closed/ })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit need" })).not.toBeInTheDocument();
    await vi.waitFor(() => expect(screen.getByRole("heading", { level: 1, name: "Rolled oats, 42 oz" })).toHaveFocus());
  });
});
