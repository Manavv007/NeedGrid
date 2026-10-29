import { useCallback, useSyncExternalStore } from "react";

/** Phones get bottom sheets; from this width up the desktop layout (docs/design-tokens.md, brief §10). */
export const DESKTOP_QUERY = "(min-width: 768px)";

export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

const hasMatchMedia = () => typeof window !== "undefined" && typeof window.matchMedia === "function";

/**
 * Whether a CSS media query matches, kept in sync as the window resizes. Without `matchMedia`
 * (jsdom, very old browsers) it returns `fallback`.
 */
export function useMediaQuery(query: string, fallback: boolean): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!hasMatchMedia()) return () => undefined;
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );
  const read = () => (hasMatchMedia() ? window.matchMedia(query).matches : fallback);
  return useSyncExternalStore(subscribe, read, () => fallback);
}
