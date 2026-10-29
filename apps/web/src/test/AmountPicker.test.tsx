import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { AmountPicker } from "@/features/donate/AmountPicker";
import { defaultChoice, type GiftChoice } from "@/features/donate/money-input";

/** The picker with its state, like DonatePanel holds it. */
function Picker({ remainingCents }: { remainingCents: number }) {
  const [choice, setChoice] = useState<GiftChoice>(() => defaultChoice(remainingCents));
  const [otherText, setOtherText] = useState("");
  return (
    <AmountPicker
      remainingCents={remainingCents}
      choice={choice}
      otherText={otherText}
      onChoiceChange={setChoice}
      onOtherTextChange={setOtherText}
    />
  );
}

function options(): string[] {
  const group = screen.getByRole("group", { name: "Choose your gift" });
  return within(group)
    .getAllByRole("button")
    .map((b) => b.textContent ?? "");
}

const pressed = () => screen.getAllByRole("button", { pressed: true }).map((b) => b.textContent);

describe("AmountPicker", () => {
  it("hides presets at or above what's left and offers Fund the rest for exactly the remainder", () => {
    render(<Picker remainingCents={1400} />);
    expect(options()).toEqual(["$10", "Fund the rest ($14.00)", "Other amount"]);
    expect(pressed()).toEqual(["Fund the rest ($14.00)"]);
  });

  it("shows every preset when plenty is left and starts on $25", () => {
    render(<Picker remainingCents={5600} />);
    expect(options()).toEqual(["$10", "$25", "$50", "Fund the rest ($56.00)", "Other amount"]);
    expect(pressed()).toEqual(["$25"]);
  });

  it("offers only Fund the rest when less than the minimum is left", () => {
    render(<Picker remainingCents={60} />);
    expect(options()).toEqual(["Fund the rest ($0.60)"]);
    expect(screen.getByText("Only 60 cents to go, so we only offer the exact amount.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Amount in dollars")).not.toBeInTheDocument();
  });

  it("moves the selection with aria-pressed", async () => {
    render(<Picker remainingCents={1400} />);
    await userEvent.click(screen.getByRole("button", { name: "$10" }));
    expect(pressed()).toEqual(["$10"]);
  });

  it("checks the Other amount inline, linked to the field with aria-describedby", async () => {
    const user = userEvent.setup();
    render(<Picker remainingCents={1400} />);
    await user.click(screen.getByRole("button", { name: "Other amount" }));
    const input = screen.getByLabelText("Amount in dollars");
    expect(input).toHaveFocus();
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(input).toHaveAccessibleDescription("Min $1, max $14 for this item.");

    await user.type(input, "12.345");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription(/^Use dollars and cents, like 12\.50\./);

    await user.clear(input);
    await user.type(input, "15");
    expect(input).toHaveAccessibleDescription(/^The most you can give here is \$14\.00\./);

    await user.clear(input);
    await user.type(input, "0.50");
    expect(input).toHaveAccessibleDescription(/^The minimum is \$1\.00\./);

    await user.clear(input);
    await user.type(input, "12.50");
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(input).toHaveAccessibleDescription("Min $1, max $14 for this item.");
  });

  it("disables every option while a payment is in progress", () => {
    render(
      <AmountPicker
        remainingCents={1400}
        choice={{ kind: "rest" }}
        otherText=""
        onChoiceChange={() => undefined}
        onOtherTextChange={() => undefined}
        disabled
      />,
    );
    for (const button of screen.getAllByRole("button")) expect(button).toBeDisabled();
  });
});
