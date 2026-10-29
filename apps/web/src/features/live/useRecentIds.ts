import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Ids marked in the last `durationMs` (e.g. tiles that were just funded, for a brief highlight).
 * Marking an id again restarts its time.
 */
export function useRecentIds(durationMs: number) {
  const [ids, setIds] = useState<ReadonlySet<string>>(() => new Set());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  const mark = useCallback(
    (id: string) => {
      const pending = timers.current;
      const existing = pending.get(id);
      if (existing !== undefined) clearTimeout(existing);
      setIds((current) => new Set(current).add(id));
      pending.set(
        id,
        setTimeout(() => {
          pending.delete(id);
          setIds((current) => {
            const next = new Set(current);
            next.delete(id);
            return next;
          });
        }, durationMs),
      );
    },
    [durationMs],
  );

  return { ids, mark };
}
