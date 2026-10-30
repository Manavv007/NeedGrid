import { STAFF_KEY_HEADER, STAFF_KEY_STORAGE } from "@needgrid/shared";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { safeStaffNext } from "@/lib/unauthorized";
import { server } from "@/mocks/node";
import { renderRoute } from "./render";

const API = "http://api.test";
const HARBOR_KEY = "harbor-demo-2026";

const storedKey = () => sessionStorage.getItem(STAFF_KEY_STORAGE);
const where = (router: { state: { location: { pathname: string; search: string } } }) =>
  `${router.state.location.pathname}${router.state.location.search}`;

/** Every query of the staff side that is still in the cache. */
function staffQueries(queryClient: ReturnType<typeof renderRoute>["queryClient"]) {
  return queryClient
    .getQueryCache()
    .findAll({ predicate: (q) => ["staffMe", "staffNeeds", "staffNeed"].includes(String(q.queryKey[0])) });
}

async function signInWith(passcode: string) {
  await userEvent.type(await screen.findByLabelText("Passcode"), passcode);
  await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
}

describe("Staff login /staff/login", () => {
  it("a wrong passcode stays here, says so inline and stores nothing", async () => {
    const { router } = renderRoute("/staff/login");
    expect(await screen.findByRole("heading", { level: 1, name: "Sign in to your charity" })).toBeInTheDocument();

    await signInWith("wrongcode");
    expect(await screen.findByText("That passcode didn't work. Check it and try again.")).toBeInTheDocument();
    expect(screen.getByLabelText("Passcode")).toHaveAttribute("aria-invalid", "true");
    expect(storedKey()).toBeNull();
    expect(where(router)).toBe("/staff/login");
  });

  it("Try the staff console signs in with the demo passcode, sent only as a header", async () => {
    const sent: (string | null)[] = [];
    server.use(
      http.get(`${API}/api/staff/me`, ({ request }) => {
        sent.push(request.headers.get(STAFF_KEY_HEADER));
      }),
    );
    const { router } = renderRoute("/staff/login");
    await userEvent.click(await screen.findByRole("button", { name: "Try the staff console" }));

    expect(await screen.findByRole("heading", { level: 1, name: "Needs" })).toBeInTheDocument();
    expect(where(router)).toBe("/staff");
    expect(screen.getByText(/Harbor Food Bank/, { selector: "header span" })).toBeInTheDocument();
    expect(storedKey()).toBe(HARBOR_KEY);
    expect(sent).toEqual([HARBOR_KEY]);
    expect(router.state.location.search).not.toContain(HARBOR_KEY);
  });

  it("other failures get a friendly message, not the server's", async () => {
    server.use(
      http.get(`${API}/api/staff/me`, () =>
        HttpResponse.json({ error: { code: "INTERNAL", message: "pg pool exhausted" } }, { status: 500 }),
      ),
    );
    renderRoute("/staff/login");
    await signInWith(HARBOR_KEY);
    expect(
      await screen.findByText("We couldn't sign you in just now. Please try again in a moment."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/pg pool/)).not.toBeInTheDocument();
    expect(storedKey()).toBeNull();
  });

  it("the show button reveals the passcode and says whether it is pressed", async () => {
    renderRoute("/staff/login");
    const input = await screen.findByLabelText("Passcode");
    const toggle = screen.getByRole("button", { name: "Show passcode" });
    expect(input).toHaveAttribute("type", "password");
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(toggle);
    expect(input).toHaveAttribute("type", "text");
    expect(toggle).toHaveAttribute("aria-pressed", "true");
  });

  it("lists the three demo passcodes in a collapsible note", async () => {
    renderRoute("/staff/login");
    const summary = await screen.findByText("Demo passcodes (sandbox only)");
    expect(summary.closest("details")).not.toHaveAttribute("open");
    expect(screen.getByText("harbor-demo-2026")).toBeInTheDocument();
    expect(screen.getByText("paws-demo-2026")).toBeInTheDocument();
    expect(screen.getByText("room12-demo-2026")).toBeInTheDocument();
  });

  it("goes back to the staff page from ?next= after signing in", async () => {
    const { router } = renderRoute(`/staff/login?next=${encodeURIComponent("/staff/intake")}`);
    await signInWith(HARBOR_KEY);
    expect(await screen.findByRole("heading", { level: 1, name: "What do you need?" })).toBeInTheDocument();
    expect(where(router)).toBe("/staff/intake");
  });

  it("ignores a ?next= that leaves the staff side or the site", async () => {
    const { router } = renderRoute(`/staff/login?next=${encodeURIComponent("https://evil.example/staff")}`);
    await signInWith(HARBOR_KEY);
    expect(await screen.findByRole("heading", { level: 1, name: "Needs" })).toBeInTheDocument();
    expect(where(router)).toBe("/staff");
  });

  it("already signed in: goes straight to the console", async () => {
    sessionStorage.setItem(STAFF_KEY_STORAGE, HARBOR_KEY);
    const { router } = renderRoute("/staff/login");
    expect(await screen.findByRole("heading", { level: 1, name: "Needs" })).toBeInTheDocument();
    expect(where(router)).toBe("/staff");
  });

  it("Sign out forgets the key and every staff query, then shows the login page", async () => {
    const { router, queryClient } = renderRoute("/staff/login");
    await signInWith(HARBOR_KEY);
    await screen.findByRole("tab", { name: "Open 8" });
    expect(staffQueries(queryClient).length).toBeGreaterThan(0);

    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Sign in to your charity" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/staff/login");
    await waitFor(() => expect(storedKey()).toBeNull());
    expect(staffQueries(queryClient)).toHaveLength(0);
  });
});

describe("safeStaffNext", () => {
  it.each([
    ["/staff/intake", "/staff/intake"],
    ["/staff?tab=funded", "/staff?tab=funded"],
    ["/staff", "/staff"],
    [null, "/staff"],
    ["", "/staff"],
    ["/o/harbor-food-bank", "/staff"],
    ["/staffing", "/staff"],
    ["/staff/login", "/staff"],
    ["//evil.example/staff", "/staff"],
    ["/\\evil.example", "/staff"],
    ["https://evil.example/staff", "/staff"],
    ["javascript:alert(1)", "/staff"],
  ])("%s → %s", (raw, expected) => {
    expect(safeStaffNext(raw)).toBe(expected);
  });
});

describe("StaffGate", () => {
  it("without a passcode, sends staff to sign in and remembers the page", async () => {
    const { router } = renderRoute("/staff/intake");
    expect(await screen.findByRole("heading", { level: 1, name: "Sign in to your charity" })).toBeInTheDocument();
    expect(where(router)).toBe(`/staff/login?next=${encodeURIComponent("/staff/intake")}`);
  });

  it("a 401 mid-session clears the key and goes to the login page", async () => {
    sessionStorage.setItem(STAFF_KEY_STORAGE, HARBOR_KEY);
    const { router, queryClient } = renderRoute("/staff?tab=funded");
    await screen.findByRole("tab", { name: "Funded 2" });

    // The passcode was changed elsewhere: the next request with the old one is refused.
    sessionStorage.setItem(STAFF_KEY_STORAGE, "rotated-elsewhere");
    await act(() => queryClient.invalidateQueries());

    expect(await screen.findByRole("heading", { level: 1, name: "Sign in to your charity" })).toBeInTheDocument();
    expect(where(router)).toBe(`/staff/login?next=${encodeURIComponent("/staff?tab=funded")}`);
    expect(storedKey()).toBeNull();
    await waitFor(() => expect(staffQueries(queryClient)).toHaveLength(0));
  });
});
