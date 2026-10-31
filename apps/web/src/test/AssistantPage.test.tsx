import { formatUsd, STAFF_KEY_STORAGE, type AgentChatReq, type ReconcileReport } from "@needgrid/shared";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CHAT_TRANSCRIPT_STORAGE } from "@/lib/chatTranscript";
import { RATE_LIMITED_MESSAGE } from "@/lib/ndjson";
import { ORG_IDS } from "@/mocks/fixtures";
import { AMOUNTS_CHANGED_ERROR, mockDb } from "@/mocks/mockDb";
import { server } from "@/mocks/node";
import { controlledNdjson } from "./ndjsonStream";
import { renderRoute } from "./render";

const CHAT = "http://api.test/api/staff/agent/chat";
const INVOICE_PROMPT = "Invoice Acme Hardware (sponsor@example.com) for the whole winter-coats list";
const TITLE = "Invoice Acme Hardware for 3 items";
const WINTER = "Winter coats, kids' size 8";

afterEach(() => {
  vi.restoreAllMocks();
  expect(mockDb.moneyProblems()).toEqual([]);
});

async function openAssistant(key = "room12-demo-2026") {
  sessionStorage.setItem(STAFF_KEY_STORAGE, key);
  const user = userEvent.setup();
  const utils = renderRoute("/staff/assistant");
  // The first full render in a file is the slowest (cold imports).
  await screen.findByRole("heading", { level: 1, name: "Assistant" }, { timeout: 10_000 });
  return { ...utils, user };
}

type User = ReturnType<typeof userEvent.setup>;

const box = () => screen.getByRole("textbox", { name: "Message the assistant" });
const conversation = () => screen.getByRole("list", { name: "Conversation" });
const pending = () => screen.getByRole("region", { name: /^Pending approvals/ });
const assistantBubbles = () =>
  within(conversation())
    .queryAllByText("Assistant:")
    .map((prefix) => prefix.parentElement?.textContent?.replace(/^Assistant: /, ""));

async function ask(user: User, text: string) {
  await user.type(box(), text);
  await user.keyboard("{Enter}");
}

/** Replace the chat endpoint with a reply the test drives; records each request body. */
function driveChat() {
  const reply = controlledNdjson();
  const bodies: AgentChatReq[] = [];
  server.use(
    http.post(
      CHAT,
      async ({ request }) => {
        bodies.push((await request.json()) as AgentChatReq);
        return reply.response();
      },
      { once: true },
    ),
  );
  return { reply, bodies };
}

describe("Assistant: the invoice scene (mock mode, Room 12)", () => {
  it("prompt → streamed reply → approval card inline and pending → approve → payer link + QR → held tiles", async () => {
    const { user, router } = await openAssistant();
    expect(document.title).toBe("Assistant · Room 12 Readers · NeedGrid staff");
    expect(await within(pending()).findByText("Nothing to approve")).toBeInTheDocument();

    await user.click(
      within(screen.getByRole("list", { name: "Suggestions" })).getByRole("button", { name: INVOICE_PROMPT }),
    );
    expect(within(conversation()).getByText(INVOICE_PROMPT)).toBeInTheDocument();
    expect(await screen.findByText("I've prepared it, please review the approval card.")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Suggestions" })).not.toBeInTheDocument();

    // Tool lines finished with a check.
    for (const summary of ["Looked up open needs · found 3 items", "Prepared an invoice for your approval"]) {
      expect(within(conversation()).getByText(summary).closest("p")).toHaveTextContent(`Done: ${summary}`);
    }
    // The same card in the chat and in Pending approvals.
    const inline = within(conversation()).getByRole("article", { name: TITLE });
    const listed = await within(pending()).findByRole("article", { name: TITLE });
    expect(screen.getByRole("heading", { name: "Pending approvals · 1" })).toBeInTheDocument();
    const [action] = mockDb.listAgentActions(ORG_IDS.room12, "proposed");
    const total = formatUsd(action?.preview.totalCents ?? 0);
    expect(within(inline).getByText(total)).toBeInTheDocument();
    expect(within(listed).getByText(total)).toBeInTheDocument();

    await user.click(within(inline).getByRole("button", { name: "Approve and send" }));
    expect(await within(conversation()).findByText("Approved and sent")).toBeInTheDocument();
    expect(
      within(conversation()).getByRole("link", { name: "Open payment page (opens in a new tab)" }),
    ).toHaveAttribute("href", expect.stringMatching(/^https:\/\/www\.sandbox\.paypal\.com\//));
    expect(
      within(conversation()).getByRole("button", { name: /Show the payment QR code for Acme Hardware/ }),
    ).toBeInTheDocument();
    // Decided, so it leaves Pending approvals for Recent.
    expect(await within(pending()).findByText(`Sent · ${total}`)).toBeInTheDocument();
    expect(within(pending()).getByText("Nothing to approve")).toBeInTheDocument();

    // The public wall: the coats are on hold for the sponsor.
    await router.navigate("/o/room-12-readers");
    const tile = await screen.findByRole("article", { name: WINTER });
    expect(within(tile).getByRole("progressbar")).toHaveAttribute(
      "aria-valuetext",
      expect.stringContaining("being paid now, $0 left"),
    );
  });

  it("a failed approval (amounts changed) offers Ask again with the original request", async () => {
    const { user } = await openAssistant();
    await ask(user, INVOICE_PROMPT);
    const card = await within(conversation()).findByRole("article", { name: TITLE });
    mockDb.armScenario("amountsChanged");
    await user.click(within(card).getByRole("button", { name: "Approve and send" }));
    const failed = await within(conversation()).findByRole("article", { name: TITLE });
    expect(await within(failed).findByText(`${AMOUNTS_CHANGED_ERROR} Nothing was sent.`)).toBeInTheDocument();
    await user.click(within(failed).getByRole("button", { name: "Ask again" }));
    expect(box()).toHaveValue(INVOICE_PROMPT);
    expect(box()).toHaveFocus();
  });
});

describe("Assistant: streaming", () => {
  it("text deltas grow one bubble, as plain text (markup shows literally)", async () => {
    const { reply } = driveChat();
    const { user } = await openAssistant();
    await ask(user, "hello");
    expect(await screen.findByText("Thinking…")).toBeInTheDocument();
    reply.send({ type: "text", delta: "Hel" });
    reply.send({ type: "text", delta: "lo, " }, { type: "text", delta: "<b>bold</b> & more.\nNext line" });
    await waitFor(() => expect(assistantBubbles()).toEqual(["Hello, <b>bold</b> & more.\nNext line"]));
    expect(conversation().querySelector("b")).toBeNull();
    expect(box()).toBeDisabled();
    reply.send({ type: "done" });
    reply.close();
    await waitFor(() => expect(box()).toBeEnabled());
    expect(screen.queryByRole("button", { name: "Stop the reply" })).not.toBeInTheDocument();
  });

  it("a tool line spins, then turns into a check; a reconcile result renders the report table", async () => {
    const { reply } = driveChat();
    const { user } = await openAssistant();
    await ask(user, "Check this week's money matches our records");
    reply.send({ type: "tool_call", tool: "reconcile", summary: "Checking PayPal transactions…" });
    const line = (await within(conversation()).findByText("Checking PayPal transactions…")).closest("p");
    expect(line).toHaveTextContent("Working: Checking PayPal transactions…");

    const report: ReconcileReport = {
      periodStart: "2026-10-21T12:00:00.000Z",
      periodEnd: "2026-10-27T12:00:00.000Z",
      paypalTotalCents: 61_200,
      recordedTotalCents: 61_200,
      matchedCount: 31,
      mismatches: [],
      ok: true,
    };
    reply.send({ type: "tool_result", tool: "reconcile", summary: "Checked PayPal transactions", data: report });
    expect(await within(conversation()).findByText("Checked PayPal transactions")).toBeInTheDocument();
    expect(within(conversation()).getByText("Checked PayPal transactions").closest("p")).toHaveTextContent(
      "Done: Checked PayPal transactions",
    );
    const table = within(conversation()).getByRole("region", { name: "Everything matches" });
    expect(within(table).getByRole("row", { name: /Payments matched/ })).toHaveTextContent("31 of 31");
    reply.send({ type: "done" });
    reply.close();
  });

  it("a reconcile result that isn't a ReconcileReport shows only its summary", async () => {
    const { reply } = driveChat();
    const { user } = await openAssistant();
    await ask(user, "check");
    reply.send(
      { type: "tool_call", tool: "reconcile", summary: "Checking PayPal transactions…" },
      { type: "tool_result", tool: "reconcile", summary: "Checked PayPal transactions", data: { ok: "yes" } },
      { type: "done" },
    );
    reply.close();
    expect(await within(conversation()).findByText("Checked PayPal transactions")).toBeInTheDocument();
    expect(within(conversation()).queryByRole("region")).not.toBeInTheDocument();
  });

  it("Stop aborts the reply: no error, the box is usable again", async () => {
    const { reply } = driveChat();
    const { user } = await openAssistant();
    await ask(user, "hello");
    reply.send({ type: "text", delta: "Working on it" });
    expect(await screen.findByText("Working on it")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Stop the reply" }));
    expect(await screen.findByText("Stopped.")).toBeInTheDocument();
    expect(box()).toBeEnabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Stop the reply" })).not.toBeInTheDocument();
    // Whatever the server still sends is no longer read.
    reply.send({ type: "text", delta: " and more" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByText(/and more/)).not.toBeInTheDocument();
  });

  it("an error event shows a red bubble and gives the box back", async () => {
    mockDb.armScenario("assistantError");
    const { user } = await openAssistant();
    await ask(user, "hello");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Sorry, the assistant hit a problem and stopped. Your data is fine. Please try again.",
    );
    await waitFor(() => expect(box()).toBeEnabled());
    // And the next message goes through.
    await ask(user, "What's still unfunded and urgent?");
    expect(await screen.findByText(/These still need donations/)).toBeInTheDocument();
  });

  it("an unreadable line ends the reply with a generic error, never the raw text", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockDb.armScenario("assistantBadLine");
    const { user } = await openAssistant();
    await ask(user, "hello");
    expect(await screen.findByRole("alert")).toHaveTextContent("Part of the reply couldn't be read");
    expect(document.body).not.toHaveTextContent("<b>raw</b>");
    await waitFor(() => expect(box()).toBeEnabled());
  });

  it("a reply that ends without done says it ended early", async () => {
    const { reply } = driveChat();
    const { user } = await openAssistant();
    await ask(user, "hello");
    reply.send({ type: "text", delta: "Half a" });
    reply.close();
    expect(await screen.findByText("The reply ended early.")).toBeInTheDocument();
    expect(box()).toBeEnabled();
  });

  it("429: says to slow down, in the chat", async () => {
    for (let i = 0; i < 20; i += 1) mockDb.takeChatRequest("room12-demo-2026");
    const { user } = await openAssistant();
    await ask(user, "hello");
    expect(await screen.findByRole("alert")).toHaveTextContent(RATE_LIMITED_MESSAGE);
    expect(box()).toBeEnabled();
  });
});

describe("Assistant: the message box and history", () => {
  it("Enter sends, Shift+Enter adds a line, and the counter appears near 4000 characters", async () => {
    const { reply, bodies } = driveChat();
    const { user } = await openAssistant();
    await user.type(box(), "first line{Shift>}{Enter}{/Shift}second line");
    expect(box()).toHaveValue("first line\nsecond line");
    expect(bodies).toEqual([]);
    await user.keyboard("{Enter}");
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]?.messages.at(-1)).toEqual({ role: "user", content: "first line\nsecond line" });
    expect(box()).toHaveValue("");
    reply.send({ type: "done" });
    reply.close();
    await waitFor(() => expect(box()).toBeEnabled());

    await user.click(box());
    await user.paste("x".repeat(4_001));
    expect(screen.getByText(/4,001\/4,000 characters\. Keep it to 4,000 or fewer\./)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });

  it("sends only the text history, newest 30 messages, and keeps the transcript for the tab", async () => {
    const saved = Array.from({ length: 40 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      text: `message ${i + 1}`,
    }));
    sessionStorage.setItem(CHAT_TRANSCRIPT_STORAGE, JSON.stringify({ orgId: ORG_IDS.room12, messages: saved }));
    const { reply, bodies } = driveChat();
    const { user } = await openAssistant();
    expect(within(conversation()).getByText("message 40")).toBeInTheDocument();

    await ask(user, "and now?");
    await waitFor(() => expect(bodies).toHaveLength(1));
    const messages = bodies[0]?.messages ?? [];
    expect(messages).toHaveLength(30);
    expect(messages[0]).toEqual({ role: "assistant", content: "message 12" });
    expect(messages.at(-1)).toEqual({ role: "user", content: "and now?" });
    expect(messages.every((m) => Object.keys(m).sort().join() === "content,role")).toBe(true);

    reply.send({ type: "text", delta: "Here you go." }, { type: "done" });
    reply.close();
    await waitFor(() => expect(box()).toBeEnabled());
    const stored = JSON.parse(sessionStorage.getItem(CHAT_TRANSCRIPT_STORAGE) ?? "{}") as { messages: unknown[] };
    expect(stored.messages.at(-1)).toEqual({ role: "assistant", text: "Here you go." });

    // New chat clears it (and shows the suggestions again).
    await user.click(screen.getByRole("button", { name: "New chat" }));
    expect(screen.getByRole("list", { name: "Suggestions" })).toBeInTheDocument();
    expect(sessionStorage.getItem(CHAT_TRANSCRIPT_STORAGE)).toBeNull();
  });

  it("another charity's saved chat is never shown", async () => {
    sessionStorage.setItem(
      CHAT_TRANSCRIPT_STORAGE,
      JSON.stringify({ orgId: ORG_IDS.harbor, messages: [{ role: "user", text: "Harbor's secret" }] }),
    );
    await openAssistant();
    expect(screen.queryByText("Harbor's secret")).not.toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Suggestions" })).toBeInTheDocument();
  });
});
