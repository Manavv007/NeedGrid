import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderRoute } from "./render";

describe("Not found page", () => {
  it("renders for unknown URLs inside the public layout, with a way home", async () => {
    renderRoute("/this/does/not/exist");
    expect(await screen.findByRole("heading", { name: "This page isn't here" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to NeedGrid" })).toHaveAttribute("href", "/");
    expect(screen.getByText("Sandbox demo, no real money")).toBeInTheDocument();
  });

  it("renders for unknown staff URLs too", async () => {
    renderRoute("/staff/nope/nope");
    expect(await screen.findByRole("heading", { name: "This page isn't here" })).toBeInTheDocument();
  });
});
