/**
 * `?mock=liveDemo` (mock mode only): a pretend donor in this tab, so live updates can be watched
 * without a second browser. Every 4 s a random Harbor Food Bank tile that still takes money gets a
 * $5–$20 gift through the same mock API a real donor uses (create order → capture, with the
 * server's clamping), which sends `need.updated` to every open screen in this tab. It stops once
 * nothing at Harbor has money left to raise.
 *
 * Try it: `/o/harbor-food-bank?display=1&mock=liveDemo` (big screen) or `/o/harbor-food-bank?mock=liveDemo`.
 */
import {
  CaptureRes,
  CreateOrderRes,
  DONATABLE_STATUSES,
  paths,
  type CreateOrderReq,
  type NeedStatus,
} from "@needgrid/shared";
import { ApiClientError, apiPost } from "@/lib/api";
import { mockDb } from "./mockDb";

export const LIVE_DEMO_ORG = "harbor-food-bank";
export const LIVE_DEMO_EVERY_MS = 4_000;
const MIN_GIFT_DOLLARS = 5;
const MAX_GIFT_DOLLARS = 20;

const DONATABLE: readonly NeedStatus[] = DONATABLE_STATUSES;

const randomBelow = (n: number) => Math.floor(Math.random() * n);

/** One pretend gift. False when no Harbor tile has anything left to raise. */
async function giveOnce(): Promise<boolean> {
  const needs = mockDb.getOrgPage(LIVE_DEMO_ORG)?.needs ?? [];
  const open = needs.filter((need) => DONATABLE.includes(need.status) && need.remainingCents > 0);
  const need = open[randomBelow(open.length)];
  if (!need) return false;

  const dollars = MIN_GIFT_DOLLARS + randomBelow(MAX_GIFT_DOLLARS - MIN_GIFT_DOLLARS + 1);
  // A requested amount, like a donor's: the mock server clamps it to what's left.
  const req: CreateOrderReq = { needId: need.id, amountCents: dollars * 100, rollOverConsent: true };
  const order = await apiPost(paths.createOrder, req, CreateOrderRes);
  await apiPost(paths.captureOrder(order.orderId), {}, CaptureRes);
  return true;
}

/** Starts the pretend donor; returns a function that stops it. */
export function startLiveDemo(): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function tick(): Promise<void> {
    let more = true;
    try {
      more = await giveOnce();
    } catch (error) {
      // Someone (this tab's donor) filled the tile first: just pick another one next time.
      const justFunded = error instanceof ApiClientError && error.code === "FULLY_FUNDED";
      if (!justFunded) console.warn("[mocks] liveDemo: a pretend gift failed", error);
    }
    if (stopped) return;
    if (!more) {
      console.info("[mocks] liveDemo: every Harbor tile is covered, so the pretend donor stops.");
      return;
    }
    timer = setTimeout(() => void tick(), LIVE_DEMO_EVERY_MS);
  }

  console.info(`[mocks] liveDemo: a pretend donor gives $5–$20 to a random Harbor tile every 4 s.`);
  timer = setTimeout(() => void tick(), LIVE_DEMO_EVERY_MS);
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
