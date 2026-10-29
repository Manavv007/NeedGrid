import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ANNOUNCE_INTERVAL_MS, useThrottledAnnouncer } from "@/lib/useThrottledAnnouncer";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("useThrottledAnnouncer", () => {
  it("speaks at most once per 5 s, and a burst is read as its latest message", () => {
    const { result } = renderHook(() => useThrottledAnnouncer());
    const announce = (text: string) => act(() => result.current.announce(text));
    const wait = (ms: number) => act(() => vi.advanceTimersByTime(ms));

    expect(result.current.message).toBe("");
    announce("Diapers, size 4: $14 left");
    expect(result.current.message).toBe("Diapers, size 4: $14 left");

    announce("Diapers, size 4: $9 left");
    announce("Baby wipes, unscented: $10 left");
    announce("Diapers, size 4 is fully funded");
    wait(ANNOUNCE_INTERVAL_MS - 1);
    expect(result.current.message).toBe("Diapers, size 4: $14 left");
    wait(1);
    expect(result.current.message).toBe("Diapers, size 4 is fully funded");

    // Right after a message the next one waits its turn too.
    announce("Toothpaste, 4 oz: $32 left");
    wait(ANNOUNCE_INTERVAL_MS - 1);
    expect(result.current.message).toBe("Diapers, size 4 is fully funded");
    wait(1);
    expect(result.current.message).toBe("Toothpaste, 4 oz: $32 left");

    // After a quiet spell, the next message is read at once.
    wait(ANNOUNCE_INTERVAL_MS * 4);
    announce("Rolled oats, 42 oz: $50 left");
    expect(result.current.message).toBe("Rolled oats, 42 oz: $50 left");
  });

  it("drops a waiting message when the page goes away", () => {
    const { result, unmount } = renderHook(() => useThrottledAnnouncer());
    act(() => result.current.announce("first"));
    act(() => result.current.announce("second"));
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
