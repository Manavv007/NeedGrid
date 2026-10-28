import { paths } from "@needgrid/shared";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "@/mocks/node";
import { renderRoute } from "./render";

const API = "http://api.test";

describe("Landing page", () => {
  it("shows the hook line and how it works", async () => {
    renderRoute("/");
    expect(
      screen.getByRole("heading", { level: 1, name: "Shelters get 400 cans of beans and zero diapers." }),
    ).toBeInTheDocument();
    for (const link of screen.getAllByRole("link", { name: "See the impact" })) {
      expect(link).toHaveAttribute("href", "/dashboard");
    }
    expect(screen.getByRole("link", { name: "See what's needed" })).toHaveAttribute("href", "#orgs");
    expect(screen.getByRole("heading", { name: "How it works" })).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: /Harbor Food Bank/ })).toBeInTheDocument();
  });

  it("lists the three mock charities with their stats, linking to their pages", async () => {
    renderRoute("/");
    const section = screen.getByRole("region", { name: "Charities on NeedGrid" });
    const harbor = await within(section).findByRole("link", { name: /Harbor Food Bank/ });
    expect(harbor).toHaveAttribute("href", "/o/harbor-food-bank");
    expect(within(harbor).getByText(/still needed/)).toBeInTheDocument();
    expect(within(section).getAllByRole("listitem")).toHaveLength(3);
    expect(within(section).getByRole("link", { name: /Second Chance Paws/ })).toHaveAttribute(
      "href",
      "/o/second-chance-paws",
    );
    expect(within(section).getByRole("link", { name: /Room 12 Readers/ })).toHaveAttribute(
      "href",
      "/o/room-12-readers",
    );
  });

  it("shows the empty state when there are no charities", async () => {
    server.use(http.get(`${API}${paths.orgs}`, () => HttpResponse.json({ orgs: [] })));
    renderRoute("/");
    expect(await screen.findByRole("heading", { name: "No charities yet" })).toBeInTheDocument();
  });

  it("shows the error state and recovers on Try again", async () => {
    let fail = true;
    server.use(
      http.get(`${API}${paths.orgs}`, () =>
        fail
          ? HttpResponse.json({ error: { code: "INTERNAL", message: "boom" } }, { status: 500 })
          : HttpResponse.json({ orgs: [] }),
      ),
    );
    renderRoute("/");
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByRole("heading", { name: "We couldn't load this" })).toBeInTheDocument();

    fail = false;
    await userEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: "No charities yet" })).toBeInTheDocument();
  });
});
