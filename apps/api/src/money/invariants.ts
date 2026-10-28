/**
 * Money invariants (AGENT_A_BACKEND.md §6). Checked after every money test and by
 * `pnpm --filter @needgrid/api check:money` (run it after seeding).
 *
 * 1. every need:      funded_cents = SUM(its allocations)
 * 2. every donation:  SUM(its allocations) + unallocated_cents = amount_cents − refunded_cents
 * 3. no donation has a negative net amount on any need
 * 4. (warning) no open/topping_up/funded need is above its target
 */
import { sql } from "drizzle-orm";
import type { Executor } from "../core/needs";

export interface MoneyReport {
  errors: string[];
  warnings: string[];
}

export async function findMoneyViolations(ex: Executor): Promise<MoneyReport> {
  const errors: string[] = [];
  const warnings: string[] = [];

  const needSums = await ex.execute<{ id: string; title: string; funded: number; allocated: number }>(sql`
    select n.id, n.title, n.funded_cents as funded, coalesce(sum(a.amount_cents), 0)::int as allocated
    from needs n left join allocations a on a.need_id = n.id
    group by n.id
    having n.funded_cents <> coalesce(sum(a.amount_cents), 0)`);
  for (const r of needSums.rows) {
    errors.push(`need ${r.id} "${r.title}": funded_cents ${r.funded} ≠ allocations ${r.allocated}`);
  }

  const donationSums = await ex.execute<{
    id: string;
    amount: number;
    refunded: number;
    unallocated: number;
    allocated: number;
  }>(sql`
    select d.id, d.amount_cents as amount, d.refunded_cents as refunded, d.unallocated_cents as unallocated,
           coalesce(sum(a.amount_cents), 0)::int as allocated
    from donations d left join allocations a on a.donation_id = d.id
    group by d.id
    having coalesce(sum(a.amount_cents), 0) + d.unallocated_cents <> d.amount_cents - d.refunded_cents`);
  for (const r of donationSums.rows) {
    errors.push(
      `donation ${r.id}: allocations ${r.allocated} + unallocated ${r.unallocated} ≠ amount ${r.amount} − refunded ${r.refunded}`,
    );
  }

  const negatives = await ex.execute<{ donation_id: string; need_id: string; net: number }>(sql`
    select donation_id, need_id, sum(amount_cents)::int as net
    from allocations group by donation_id, need_id having sum(amount_cents) < 0`);
  for (const r of negatives.rows) {
    errors.push(`donation ${r.donation_id} has a negative net ${r.net} on need ${r.need_id}`);
  }

  const over = await ex.execute<{ id: string; title: string; funded: number; target: number }>(sql`
    select id, title, funded_cents as funded, target_cents as target from needs
    where status in ('open', 'topping_up', 'funded') and funded_cents > target_cents`);
  for (const r of over.rows) warnings.push(`need ${r.id} "${r.title}" is over target: ${r.funded} > ${r.target}`);

  return { errors, warnings };
}

/** Throws if any invariant is broken. For tests. */
export async function assertMoneyInvariants(ex: Executor): Promise<void> {
  const { errors } = await findMoneyViolations(ex);
  if (errors.length > 0) throw new Error(`Money invariants broken:\n- ${errors.join("\n- ")}`);
}
