/**
 * Needs this tab just changed itself (a donor's hold, a staff edit or publish), so live-update
 * announcements can skip them: people don't need to hear about what they just did. Display only;
 * the cache is still patched with the server's card.
 */
export const OWN_CHANGE_MS = 10_000;

const until = new Map<string, number>();

/** Call when this tab starts, and again when it finishes, changing a need. */
export function markOwnChange(needId: string): void {
  until.set(needId, Date.now() + OWN_CHANGE_MS);
}

export function isOwnChange(needId: string): boolean {
  const expiresAt = until.get(needId);
  if (expiresAt === undefined) return false;
  if (expiresAt > Date.now()) return true;
  until.delete(needId);
  return false;
}

/** Tests: forget everything between cases. */
export function clearOwnChanges(): void {
  until.clear();
}
