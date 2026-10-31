/**
 * Daily total caps for the PUBLIC AI endpoints (team decision, HANDOFF 2026-10-30): on top of the per-IP rate limits,
 * so one script can't use up the free Gemini quota during judging (Dec 1–15). The day resets at midnight Pacific,
 * like Google's free quota.
 *
 * In memory, one counter per feature. Render runs one API instance, so this is the whole server's count; a restart
 * resets it (acceptable: it's a guard against abuse, not billing).
 */
import { HttpError } from "../lib/http";
import { AI_RESTING } from "./models";

/** Requests per Pacific day. Each dashboard question can make several model calls (Studio's tool loop). */
export const DAILY_CAPS = {
  match: 150,
  dashboard: 300,
} as const;
export type CappedFeature = keyof typeof DAILY_CAPS;

/** "2026-10-30" in Pacific time. */
export function pacificDay(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(now);
}

export class DailyCap {
  private day = "";
  private used = 0;

  constructor(
    readonly max: number,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Uses one request. false when today's cap is already reached (nothing is used then). */
  take(): boolean {
    const today = pacificDay(this.now());
    if (today !== this.day) {
      this.day = today;
      this.used = 0;
    }
    if (this.used >= this.max) return false;
    this.used++;
    return true;
  }

  get remaining(): number {
    return pacificDay(this.now()) === this.day ? Math.max(0, this.max - this.used) : this.max;
  }
}

const caps = new Map<CappedFeature, DailyCap>();

/** Call before a public AI request does any model work. Throws 503 UPSTREAM AI_RESTING when today's cap is used up. */
export function takeDailyBudget(feature: CappedFeature): void {
  let cap = caps.get(feature);
  if (!cap) {
    cap = new DailyCap(DAILY_CAPS[feature]);
    caps.set(feature, cap);
  }
  if (!cap.take()) {
    console.warn(`[ai] daily cap reached for ${feature} (${cap.max}/day)`);
    throw new HttpError(503, "UPSTREAM", AI_RESTING);
  }
}

/** Tests only. */
export function resetDailyCaps(): void {
  caps.clear();
}
