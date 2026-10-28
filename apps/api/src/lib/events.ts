import { EventEmitter } from "node:events";
import type { NeedCard } from "@needgrid/shared";

/**
 * In-process fan-out of need updates, keyed by org slug (we run a single API instance).
 * Phase 3's SSE route (GET /api/orgs/:slug/stream) subscribes with onNeedUpdated.
 */
const emitter = new EventEmitter();
emitter.setMaxListeners(0); // one listener per open tile wall

const channel = (orgSlug: string) => `org:${orgSlug}`;

export function emitNeedUpdated(card: NeedCard): void {
  emitter.emit(channel(card.orgSlug), card);
}

/** Returns an unsubscribe function. */
export function onNeedUpdated(orgSlug: string, listener: (card: NeedCard) => void): () => void {
  emitter.on(channel(orgSlug), listener);
  return () => emitter.off(channel(orgSlug), listener);
}
