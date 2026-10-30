import { STAFF_KEY_STORAGE } from "@needgrid/shared";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_IMAGE_BYTES, MOCK_UPLOAD_URL } from "@/lib/cloudinary";
import { ORG_IDS } from "@/mocks/fixtures";
import { mockDb } from "@/mocks/mockDb";
import { server } from "@/mocks/node";
import { renderRoute } from "./render";

const API = "http://api.test";
const DELIVERY_ROUTE = `${API}/api/staff/needs/:id/delivery`;
const CONFIRM_ROUTE = `${API}/api/staff/deliveries/:id/confirm`;
const SOCKS = "4c1f7a2e-9b3d-4e5f-8a6b-000000000111"; // Harbor, ordered at Target, 3 donors

const REVIEW = "Needs your review before donors see it";
const DELIVERED = /Delivered, donors have been updated/;

// Mock mode: photos "upload" to the fixed Cloudinary-style demo URL (lib/cloudinary.ts).
beforeEach(() => {
  sessionStorage.setItem(STAFF_KEY_STORAGE, "harbor-demo-2026");
  vi.stubEnv("VITE_USE_MOCKS", "true");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function openSocks() {
  // applyAccept: false, so a non-image file reaches our own check (a phone's picker can't be trusted).
  const user = userEvent.setup({ applyAccept: false });
  const utils = renderRoute(`/staff/needs/${SOCKS}`);
  // The first full render in a file is the slowest (cold imports): more time on a busy machine.
  await screen.findByRole("heading", { level: 1, name: "Women's socks" }, { timeout: 10_000 });
  return { ...utils, user };
}

type User = ReturnType<typeof userEvent.setup>;

const panel = () => screen.getByRole("region", { name: /Record the delivery/ });
const photoInput = () => within(panel()).getByLabelText(/Arrival photo|Choose another photo/);
const noteBox = () => screen.getByLabelText("Note for donors (optional)");
const checkButton = () => screen.getByRole("button", { name: "Check delivery" });
const jpeg = () => new File(["jpeg"], "arrival.jpg", { type: "image/jpeg" });

async function addPhoto(user: User) {
  await user.upload(photoInput(), jpeg());
  expect(await screen.findByText("Photo uploaded", {}, { timeout: 5_000 })).toBeInTheDocument();
}

/** Photo, optional note, Check delivery. */
async function checkDelivery(user: User, note = "") {
  await addPhoto(user);
  if (note) await user.type(noteBox(), note);
  await user.click(checkButton());
}

/** Records request bodies sent to `route`; the normal mock handler still answers. */
function bodiesSentTo(route: string) {
  const bodies: unknown[] = [];
  server.use(
    http.post(route, async ({ request }) => {
      bodies.push(await request.clone().json());
    }),
  );
  return bodies;
}

const failWith = (route: string, status: number, code: string, message: string) =>
  server.use(http.post(route, () => HttpResponse.json({ error: { code, message } }, { status })));

describe("Delivery panel: step 1", () => {
  it("takes a camera photo, checks the file and the note before anything is sent", async () => {
    const sent = bodiesSentTo(DELIVERY_ROUTE);
    const { user } = await openSocks();
    expect(panel()).toHaveTextContent("3 donors waiting for a photo");
    const input = photoInput();
    expect(input).toHaveAttribute("type", "file");
    expect(input).toHaveAttribute("accept", "image/*");
    expect(input).toHaveAttribute("capture", "environment");

    await user.click(checkButton());
    expect(within(panel()).getByText("Add the arrival photo first.")).toBeInTheDocument();

    await user.upload(input, new File(["%PDF"], "receipt.pdf", { type: "application/pdf" }));
    expect(await within(panel()).findByText(/That file isn't a photo/)).toBeInTheDocument();

    const huge = new File(["x"], "huge.jpg", { type: "image/jpeg" });
    Object.defineProperty(huge, "size", { value: MAX_IMAGE_BYTES + 1 });
    await user.upload(input, huge);
    expect(await within(panel()).findByText(/bigger than 10 MB/)).toBeInTheDocument();

    await user.upload(input, jpeg());
    expect(await screen.findByText("Photo uploaded", {}, { timeout: 5_000 })).toBeInTheDocument();

    expect(screen.getByText("We'll turn this into a short thank-you for donors.")).toBeInTheDocument();
    await user.click(noteBox());
    await user.paste("x".repeat(501));
    expect(screen.getByText("Keep it to 500 characters or fewer.")).toBeInTheDocument();
    expect(noteBox()).toHaveAttribute("aria-invalid", "true");
    await user.click(checkButton());
    expect(sent).toEqual([]);
  });

  it("shows the staged check while the server looks at the photo", async () => {
    let release = () => undefined as void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.post(DELIVERY_ROUTE, async () => {
        await gate;
      }),
    );
    const { user } = await openSocks();
    await checkDelivery(user, "On the shelf by lunch");
    expect(await screen.findByRole("region", { name: "Checking the delivery" })).toBeInTheDocument();
    expect(
      screen.getByText("Checking the photo against the product…", { selector: "[aria-live]" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Writing a short thank-you for donors…")).toBeInTheDocument();
    release();
    expect(await screen.findByRole("region", { name: DELIVERED })).toBeInTheDocument();
  });
});

describe("Delivery panel: the server's answer", () => {
  it("a matching photo is delivered at once, with the server's score and message", async () => {
    const sent = bodiesSentTo(DELIVERY_ROUTE);
    const { user } = await openSocks();
    await checkDelivery(user, "  on the shelf by lunch ");

    expect(await screen.findByText("Delivered. Donors can see the photo now.")).toBeInTheDocument();
    const card = await screen.findByRole("region", { name: DELIVERED });
    expect(within(card).getByRole("meter", { name: "Photo match score" })).toHaveAttribute("aria-valuenow", "94");
    expect(within(card).getByText("94% match")).toBeInTheDocument();
    expect(within(card).getByText("AI check:").parentElement).toHaveTextContent(
      "AI check: The photo shows Hanes Women's Cushioned Crew Socks, 12 Pack, the product that was ordered.",
    );
    expect(within(card).getByText("“On the shelf by lunch. Thank you for helping us get it.”")).toBeInTheDocument();
    expect(within(card).getByRole("img", { name: "Women's socks after it arrived" })).toHaveAttribute(
      "src",
      MOCK_UPLOAD_URL,
    );
    expect(sent).toEqual([{ photoUrl: MOCK_UPLOAD_URL, staffNote: "on the shelf by lunch" }]);
    await waitFor(() => expect(within(card).getByRole("heading", { name: DELIVERED })).toHaveFocus());
    expect(screen.getByText("Delivered", { selector: "span.rounded-full" })).toBeInTheDocument();
  });

  it("a doubtful photo waits for review; Confirm sends no message when it wasn't edited", async () => {
    const confirms = bodiesSentTo(CONFIRM_ROUTE);
    const { user } = await openSocks();
    await checkDelivery(user, "mismatch? only 2 packs");

    expect(await screen.findByText("Please review the photo before donors see it.")).toBeInTheDocument();
    const review = await screen.findByRole("region", { name: REVIEW });
    await waitFor(() => expect(within(review).getByRole("heading", { name: REVIEW })).toHaveFocus());
    expect(screen.queryByRole("region", { name: /Waiting for delivery/ })).not.toBeInTheDocument();

    expect(within(review).getByText("What we ordered")).toBeInTheDocument();
    expect(
      within(review).getByRole("img", { name: "Hanes Women's Cushioned Crew Socks, 12 Pack" }),
    ).toBeInTheDocument();
    expect(within(review).getByText("What arrived")).toBeInTheDocument();
    expect(within(review).getByRole("img", { name: "Women's socks after it arrived" })).toHaveAttribute(
      "src",
      MOCK_UPLOAD_URL,
    );
    expect(within(review).getByRole("meter", { name: "Photo match score" })).toHaveAttribute("aria-valuenow", "42");
    expect(within(review).getByText("42% match · check it")).toBeInTheDocument();
    expect(within(review).getByText("AI check:").parentElement).toHaveTextContent(/doesn't clearly show Hanes/);

    const message = within(review).getByLabelText("Message for donors");
    expect(message).toHaveValue("Mismatch? only 2 packs. Thank you for helping us get it.");
    expect(within(review).getByText("Written by AI from your note. Edit it before you confirm.")).toBeInTheDocument();

    await user.click(within(review).getByRole("button", { name: "Confirm delivery" }));
    expect(await screen.findByText("Delivery confirmed. Donors can see the photo now.")).toBeInTheDocument();
    const card = await screen.findByRole("region", { name: DELIVERED });
    expect(within(card).getByText("42% match · confirmed by staff")).toBeInTheDocument();
    expect(confirms).toEqual([{}]);
    await waitFor(() => expect(within(card).getByRole("heading", { name: DELIVERED })).toHaveFocus());
  });

  it("an edited message is what Confirm sends, and what donors see", async () => {
    const confirms = bodiesSentTo(CONFIRM_ROUTE);
    const { user } = await openSocks();
    await checkDelivery(user, "mismatch");
    const review = await screen.findByRole("region", { name: REVIEW });
    const message = within(review).getByLabelText("Message for donors");
    await user.clear(message);
    await user.type(message, "All 4 packs arrived. Warm feet for 48 women!");
    await user.click(within(review).getByRole("button", { name: "Confirm delivery" }));

    const card = await screen.findByRole("region", { name: DELIVERED });
    expect(within(card).getByText("“All 4 packs arrived. Warm feet for 48 women!”")).toBeInTheDocument();
    expect(confirms).toEqual([{ message: "All 4 packs arrived. Warm feet for 48 women!" }]);
  });

  it("when the automatic check didn't run, says so; staff look and confirm", async () => {
    const confirms = bodiesSentTo(CONFIRM_ROUTE);
    mockDb.armScenario("deliveryFail");
    const { user } = await openSocks();
    await checkDelivery(user);

    const review = await screen.findByRole("region", { name: REVIEW });
    expect(
      within(review).getByText("The automatic check didn't run. Please look at the photo and confirm."),
    ).toBeInTheDocument();
    expect(within(review).queryByRole("meter")).not.toBeInTheDocument();
    expect(within(review).queryByText("AI check:")).not.toBeInTheDocument();
    const message = within(review).getByLabelText("Message for donors");
    expect(message).toHaveValue("");
    expect(
      within(review).getByText("No message yet. Write a short thank-you for donors, or leave it empty."),
    ).toBeInTheDocument();

    await user.type(message, "Here they are.");
    await user.click(within(review).getByRole("button", { name: "Confirm delivery" }));
    const card = await screen.findByRole("region", { name: DELIVERED });
    expect(within(card).getByText("Checked by staff (the automatic check didn't run)")).toBeInTheDocument();
    expect(confirms).toEqual([{ message: "Here they are." }]);
  });

  it("Retake photo goes back to step 1 with the note kept", async () => {
    const sent = bodiesSentTo(DELIVERY_ROUTE);
    const { user } = await openSocks();
    await checkDelivery(user, "mismatch at the door");
    const review = await screen.findByRole("region", { name: REVIEW });

    await user.click(within(review).getByRole("button", { name: "Retake photo" }));
    expect(panel()).toBeInTheDocument();
    expect(noteBox()).toHaveValue("mismatch at the door");
    expect(photoInput()).toHaveFocus();
    expect(screen.queryByText("Photo uploaded")).not.toBeInTheDocument();

    await addPhoto(user);
    await user.clear(noteBox());
    await user.type(noteBox(), "All 4 packs");
    await user.click(checkButton());
    expect(await screen.findByRole("region", { name: DELIVERED })).toBeInTheDocument();
    expect(sent).toEqual([
      { photoUrl: MOCK_UPLOAD_URL, staffNote: "mismatch at the door" },
      { photoUrl: MOCK_UPLOAD_URL, staffNote: "All 4 packs" },
    ]);
  });

  it("reopens the review after a reload when a delivery still needs it", async () => {
    expect(
      mockDb.recordDelivery(ORG_IDS.harbor, SOCKS, { photoUrl: MOCK_UPLOAD_URL, staffNote: "mismatch" }).kind,
    ).toBe("ok");
    await openSocks();
    const review = screen.getByRole("region", { name: REVIEW });
    expect(within(review).getByText("42% match · check it")).toBeInTheDocument();
    expect(within(review).getByLabelText("Message for donors")).toHaveValue(
      "Mismatch. Thank you for helping us get it.",
    );
    expect(screen.queryByRole("region", { name: /Record the delivery/ })).not.toBeInTheDocument();
    // Nothing happened on this page yet, so focus stays where it was.
    expect(within(review).getByRole("heading", { name: REVIEW })).not.toHaveFocus();
  });
});

describe("Delivery panel: never twice, and errors", () => {
  it("checks once on a double click, and confirms once on a double click", async () => {
    const record = vi.spyOn(mockDb, "recordDelivery");
    const confirm = vi.spyOn(mockDb, "confirmDelivery");
    const { user } = await openSocks();
    await addPhoto(user);
    await user.type(noteBox(), "mismatch");
    await user.dblClick(checkButton());
    const review = await screen.findByRole("region", { name: REVIEW });
    expect(record).toHaveBeenCalledTimes(1);

    await user.dblClick(within(review).getByRole("button", { name: "Confirm delivery" }));
    expect(await screen.findByRole("region", { name: DELIVERED })).toBeInTheDocument();
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it.each([
    [503, "UPSTREAM", "AI is not configured", "AI isn't set up on this server."],
    [502, "UPSTREAM", "The AI service is busy", "The photo check didn't answer, try again."],
    [
      400,
      "VALIDATION",
      "Images must be uploaded to the NeedGrid Cloudinary account",
      "Images must be uploaded to the NeedGrid Cloudinary account",
    ],
  ])("a %i from the check says so in place, and the photo stays for another try", async (status, code, sent, shown) => {
    failWith(DELIVERY_ROUTE, status, code, sent);
    const { user } = await openSocks();
    await checkDelivery(user);
    expect(await within(panel()).findByRole("alert")).toHaveTextContent(shown);
    expect(screen.getByText("Photo uploaded")).toBeInTheDocument();
    expect(checkButton()).toBeEnabled();
  });

  it("a 409 (no longer ordered) shows the server's reason and the page catches up", async () => {
    server.use(
      http.post(
        DELIVERY_ROUTE,
        () => {
          // Someone else recorded the delivery a moment earlier.
          mockDb.recordDelivery(ORG_IDS.harbor, SOCKS, { photoUrl: MOCK_UPLOAD_URL, staffNote: "" });
        },
        { once: true },
      ),
    );
    const { user } = await openSocks();
    await checkDelivery(user);
    // In a toast, and in place until the page shows the delivery someone else recorded.
    expect(
      await screen.findAllByText("A delivery can only be recorded for an ordered item (it is delivered now)"),
    ).not.toHaveLength(0);
    expect(await screen.findByRole("region", { name: DELIVERED })).toBeInTheDocument();
  });

  it("a failed confirm keeps the review with the server's reason", async () => {
    failWith(CONFIRM_ROUTE, 409, "INVALID_STATE", "This delivery can't be confirmed (the item is closed now)");
    const { user } = await openSocks();
    await checkDelivery(user, "mismatch");
    const review = await screen.findByRole("region", { name: REVIEW });
    await user.click(within(review).getByRole("button", { name: "Confirm delivery" }));
    expect(await within(review).findByRole("alert")).toHaveTextContent(
      "This delivery can't be confirmed (the item is closed now)",
    );
    expect(within(review).getByRole("button", { name: "Confirm delivery" })).toBeEnabled();
  });
});
