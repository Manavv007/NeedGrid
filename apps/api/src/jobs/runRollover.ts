/** `pnpm --filter @needgrid/api job:rollover`: roll over expired needs once (for demos), then exit. */
import { closeDb } from "../db/client";
import { rollOverExpiredNeeds } from "./rollover";

try {
  const done = await rollOverExpiredNeeds();
  if (done.length === 0) console.log("No expired needs to roll over.");
  for (const r of done) {
    console.log(
      `Closed "${r.title}": moved ${r.movedCents} cents, set aside ${r.setAsideCents} cents, ` +
        `${r.refundProposals} refund proposal(s) waiting for staff`,
    );
  }
} finally {
  await closeDb();
}
