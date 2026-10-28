/**
 * CLI: pnpm --filter @needgrid/api check:money
 * Checks the money invariants on DATABASE_URL. Exits 1 if any are broken (warnings don't fail).
 */
import { closeDb, db } from "../db/client";
import { describePgUrl } from "../db/url";
import { env } from "../env";
import { findMoneyViolations } from "./invariants";

const { errors, warnings } = await findMoneyViolations(db);
console.log(`Money check on ${describePgUrl(env.DATABASE_URL)}`);
for (const w of warnings) console.log(`  warning: ${w}`);
for (const e of errors) console.log(`  ERROR:   ${e}`);
console.log(errors.length === 0 ? "OK: all money invariants hold." : `FAILED: ${errors.length} problem(s).`);
await closeDb();
process.exit(errors.length === 0 ? 0 : 1);
