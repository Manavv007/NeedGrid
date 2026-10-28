/**
 * Manual live check of the Channel3 integration (uses real credits: ~1 search + 1 free retrieve).
 *   pnpm --filter @needgrid/api exec tsx --env-file=.env src/channel3/smoke.ts "pampers size 4 diapers"
 * Prints only product data (never the API key). Not part of tests or the build.
 */
import { channel3Gateway } from "./client";
import { refreshProduct, searchProducts } from "./index";

const watchdog = setTimeout(() => {
  console.error("smoke: timed out after 60 s");
  process.exit(2);
}, 60_000);

const query = process.argv[2] ?? "pampers size 4 diapers";

try {
  // Raw shape of the first result, to confirm the SDK's field names against the live API.
  const raw = await channel3Gateway().search(query, 3);
  const first = raw[0];
  console.log(`raw: ${raw.length} products; first product keys: ${first ? Object.keys(first).join(", ") : "-"}`);
  if (first?.offers?.[0]) console.log("raw first offer:", JSON.stringify(first.offers[0]));

  const snaps = await searchProducts(query, { limit: 8 });
  console.table(
    snaps.map((s) => ({
      id: s.channel3Id,
      title: s.title.slice(0, 60),
      retailer: s.retailer,
      cents: s.unitPriceCents,
      packSize: s.packSize,
      inStock: s.inStock,
    })),
  );

  if (snaps[0]) {
    const { snapshot, allOffers } = await refreshProduct(snaps[0].channel3Id);
    console.log(`refresh ${snaps[0].channel3Id}: best ${snapshot?.retailer} ${snapshot?.unitPriceCents}c;`);
    console.table(allOffers.map((o) => ({ retailer: o.retailer, cents: o.unitPriceCents, inStock: o.inStock })));
  }
  clearTimeout(watchdog);
  process.exit(0);
} catch (err) {
  console.error("smoke failed:", (err as Error).message);
  process.exit(1);
}
