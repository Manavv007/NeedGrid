import { useEffect } from "react";

/**
 * Keeps the screen awake while the component is mounted, where the Screen Wake Lock API exists.
 * The browser drops the lock when the tab is hidden, so it's asked for again when the tab comes back.
 * Failures (battery saver, no permission) are ignored: the page works the same, the screen may sleep.
 */
export function useWakeLock(): void {
  useEffect(() => {
    if (!("wakeLock" in navigator)) return;
    let sentinel: WakeLockSentinel | null = null;
    let active = true;

    async function request(): Promise<void> {
      try {
        const lock = await navigator.wakeLock.request("screen");
        if (active) sentinel = lock;
        else void lock.release().catch(() => undefined);
      } catch {
        // Not allowed right now: nothing to do.
      }
    }
    function onVisibilityChange(): void {
      if (document.visibilityState === "visible" && (sentinel === null || sentinel.released)) void request();
    }

    void request();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      void sentinel?.release().catch(() => undefined);
    };
  }, []);
}
