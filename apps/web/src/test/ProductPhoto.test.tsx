import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProductPhoto } from "@/components/ProductPhoto";

const tuna = { title: "Canned tuna", imageUrl: null };
const diapers = { title: "Pampers Cruisers, Size 4", imageUrl: "https://example.com/diapers.jpg" };

describe("ProductPhoto", () => {
  it("shows the photo with the product title as alt text", () => {
    render(<ProductPhoto product={diapers} category="baby" labelClassName="text-xs" />);
    expect(screen.getByRole("img", { name: "Pampers Cruisers, Size 4" })).toHaveAttribute(
      "src",
      "https://example.com/diapers.jpg",
    );
    expect(screen.queryByText("Baby")).not.toBeInTheDocument();
  });

  it("without an image: the category placeholder with its plain-English label", () => {
    render(<ProductPhoto product={tuna} category="food" labelClassName="text-xs" />);
    const placeholder = screen.getByRole("img", { name: "No photo for Canned tuna (Food)" });
    expect(placeholder).toHaveTextContent("Food");
    expect(placeholder).toHaveClass("bg-category-food-bg", "text-category-food-text");
    expect(placeholder.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByText(/No photo yet|Product photo/)).not.toBeInTheDocument();
  });

  it("falls back to the placeholder when the image fails to load", () => {
    render(<ProductPhoto product={diapers} category="baby" labelClassName="text-xs" />);
    fireEvent.error(screen.getByRole("img", { name: "Pampers Cruisers, Size 4" }));
    expect(screen.queryByRole("img", { name: "Pampers Cruisers, Size 4" })).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: "No photo for Pampers Cruisers, Size 4 (Baby)" })).toHaveTextContent("Baby");
  });

  it("compact thumbnails (no label size given) show only the tinted icon", () => {
    render(<ProductPhoto product={tuna} category="school" />);
    const placeholder = screen.getByRole("img", { name: "No photo for Canned tuna (School supplies)" });
    expect(placeholder).toHaveTextContent("");
    expect(placeholder).toHaveClass("bg-category-school-bg");
    expect(placeholder.querySelector("svg")).toBeInTheDocument();
  });

  it("without any product, names the item generically", () => {
    render(<ProductPhoto product={null} category="other" />);
    expect(screen.getByRole("img", { name: "No photo for this item (Other)" })).toBeInTheDocument();
  });
});
