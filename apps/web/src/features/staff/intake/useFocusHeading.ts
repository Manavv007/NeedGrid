import { useEffect, useRef } from "react";

/**
 * Moves focus to a step's heading when the step appears (not on first page load), so keyboard and
 * screen-reader users land at the start of the new content instead of on a button that vanished.
 */
export function useFocusHeading(enabled: boolean) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (enabled) ref.current?.focus();
  }, [enabled]);
  return ref;
}
