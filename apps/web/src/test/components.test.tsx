import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProgressBar } from "@/components/ProgressBar";
import { StatusBadge } from "@/components/StatusBadge";
import { UrgencyBadge } from "@/components/UrgencyBadge";
import { WAKING_UP_DELAY_MS, WakingUp } from "@/components/WakingUp";

describe("ProgressBar", () => {
  it("exposes the server's amounts to assistive tech", () => {
    render(<ProgressBar fundedCents={7000} heldCents={0} targetCents={8400} label="Diapers, size 4 funding" />);
    const bar = screen.getByRole("progressbar", { name: "Diapers, size 4 funding" });
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "8400");
    expect(bar).toHaveAttribute("aria-valuenow", "7000");
    expect(bar).toHaveAttribute("aria-valuetext", "$70.00 of $84.00 raised");
  });

  it("mentions held money and never draws past 100%", () => {
    const { container } = render(
      <ProgressBar fundedCents={4100} heldCents={9000} targetCents={11200} label="Formula funding" />,
    );
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuetext",
      "$41.00 of $112.00 raised, $90.00 being paid now",
    );
    const [funded, held] = Array.from(container.querySelectorAll<HTMLElement>("[role=progressbar] > div"));
    const total = Number.parseInt(funded?.style.width ?? "0", 10) + Number.parseInt(held?.style.width ?? "0", 10);
    expect(total).toBeLessThanOrEqual(100);
  });
});

describe("badges", () => {
  it("labels urgency in donor and staff words", () => {
    const { rerender } = render(<UrgencyBadge urgency={2} />);
    expect(screen.getByText("Soon")).toBeInTheDocument();
    rerender(<UrgencyBadge urgency={2} audience="staff" />);
    expect(screen.getByText("Medium")).toBeInTheDocument();
    rerender(<UrgencyBadge urgency={1} />);
    expect(screen.getByText("When possible")).toBeInTheDocument();
  });

  it("labels statuses with text", () => {
    render(<StatusBadge status="topping_up" />);
    expect(screen.getByText("Price went up")).toBeInTheDocument();
  });
});

describe("WakingUp", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("stays quiet for 3 s, then explains the slow first load", () => {
    vi.useFakeTimers();
    render(<WakingUp />);
    expect(screen.queryByText("Waking up the server…")).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(WAKING_UP_DELAY_MS);
    });
    expect(screen.getByText("Waking up the server…")).toBeInTheDocument();
  });
});
