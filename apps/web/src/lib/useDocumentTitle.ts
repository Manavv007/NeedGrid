import { useEffect } from "react";

/**
 * Sets `document.title` while the component is mounted and restores the previous title on unmount.
 * Pass null to leave the title alone (e.g. while data is still loading).
 */
export function useDocumentTitle(title: string | null): void {
  useEffect(() => {
    if (title === null) return;
    const previous = document.title;
    document.title = title;
    return () => {
      document.title = previous;
    };
  }, [title]);
}
