import { useEffect, type RefObject } from "react";

/** Rest at the top and at the bottom before moving again. */
const PAUSE_MS = 5_000;
/** Scrolling one box-height of tiles takes this long: slow enough to read titles in passing. */
const BOX_HEIGHT_MS = 20_000;
/** A background tab hands back one huge frame gap; never jump more than this at once. */
const MAX_FRAME_MS = 100;

type Phase = "top" | "down" | "bottom" | "up";

/**
 * Slowly scrolls `ref`'s content down and back up when it overflows, pausing at both ends. The box
 * should be `overflow-hidden` (scrolled with `scrollTop`, so no scrollbar ever shows). Nothing moves
 * while everything fits, or when `enabled` is false (reduced motion).
 */
export function useAutoScroll(ref: RefObject<HTMLElement | null>, enabled: boolean): void {
  useEffect(() => {
    const box = ref.current;
    if (!box || !enabled || typeof requestAnimationFrame !== "function") return;

    let phase: Phase = "top";
    let phaseStart = performance.now();
    let last = phaseStart;
    let position = 0; // kept as a float here: browsers may round scrollTop
    box.scrollTop = 0;

    function step(now: number): void {
      if (!box) return;
      const elapsed = Math.min(now - last, MAX_FRAME_MS);
      last = now;
      const max = box.scrollHeight - box.clientHeight;
      if (max <= 1) {
        // Everything fits (or tiles were removed): stay at the top.
        if (position !== 0) box.scrollTop = 0;
        position = 0;
        phase = "top";
        phaseStart = now;
      } else {
        const distance = (box.clientHeight / BOX_HEIGHT_MS) * elapsed;
        if (phase === "top" || phase === "bottom") {
          if (now - phaseStart >= PAUSE_MS) {
            phase = phase === "top" ? "down" : "up";
            phaseStart = now;
          }
        } else if (phase === "down") {
          position = Math.min(max, position + distance);
          if (position >= max) {
            phase = "bottom";
            phaseStart = now;
          }
        } else {
          position = Math.max(0, position - distance);
          if (position <= 0) {
            phase = "top";
            phaseStart = now;
          }
        }
        position = Math.min(position, max);
        box.scrollTop = position;
      }
      frame = requestAnimationFrame(step);
    }

    let frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [ref, enabled]);
}
