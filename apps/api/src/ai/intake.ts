/**
 * Intake (AGENT_B_AI_DATA.md §9.1): photo or text → ExtractedNeed[] → Channel3 candidates → top 3 options → drafts.
 * NOTHING is saved here; staff publish drafts through A's POST /api/staff/needs.
 *
 * The model extracts text fields; quantities are clamped and pack math / targets are deterministic.
 */
import {
  CATEGORIES,
  computeTargetCents,
  ExtractedNeed,
  IntakeRes,
  type DraftNeed,
  type IntakeReq,
  type ProductOption,
  type ProductSnapshot,
} from "@needgrid/shared";
import { generateText, Output, type ModelMessage } from "ai";
import { z } from "zod";
import { lookupByUrl, PET_CATEGORY, searchProducts } from "../channel3";
import { HttpError } from "../lib/http";
import { loadImage } from "./images";
import { cached, googleOptions, languageModel, withRetry } from "./models";
import { INTAKE_IMAGE_PROMPT, INTAKE_SYSTEM, INTAKE_TEXT_PROMPT, MAX_INTAKE_ITEMS } from "./prompts/intake";
import { pricePerItemCents, rankMany } from "./rank";
import { stripControlChars, wrapUntrusted } from "./untrusted";

const MAX_QUANTITY = 10_000; // PublishNeedReq limit
const MAX_TITLE = 120;
const MAX_UNIT = 30;
const MAX_WARNINGS = 10;
const SEARCH_CONCURRENCY = 4;

/** What Gemini fills in. Kept simple for Gemini's structured output (no refinements, no unions). */
const IntakeModelSchema = z.object({
  items: z.array(
    z.object({
      title: z.string(),
      quantity: z.number(),
      unit: z.string(),
      quantityIsLooseItems: z.boolean(),
      category: z.enum(CATEGORIES),
      urgency: z.number(),
      notes: z.string().nullable(),
      searchQuery: z.string(),
      confidence: z.number(),
    }),
  ),
  warnings: z.array(z.string()),
});
type ModelItem = z.infer<typeof IntakeModelSchema>["items"][number];

export interface ExtractedItem {
  extracted: ExtractedNeed;
  quantityIsLooseItems: boolean;
}

export interface Extraction {
  items: ExtractedItem[];
  warnings: string[];
}

const clean = (s: string, max: number) => stripControlChars(s).replace(/\s+/g, " ").trim().slice(0, max);
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Model item → validated ExtractedNeed, or null if it's unusable. */
export function toExtracted(m: ModelItem): ExtractedItem | null {
  const title = clean(m.title, MAX_TITLE);
  const searchQuery = clean(m.searchQuery, 200) || title;
  if (title.length < 2) return null;
  const quantity = Number.isFinite(m.quantity) ? clamp(Math.round(m.quantity), 1, MAX_QUANTITY) : 1;
  const parsed = ExtractedNeed.safeParse({
    title,
    quantity,
    unit: clean(m.unit, MAX_UNIT) || "item",
    category: m.category,
    urgency: Number.isFinite(m.urgency) ? clamp(Math.round(m.urgency), 1, 3) : 2,
    notes: m.notes ? clean(m.notes, 300) || null : null,
    searchQuery,
    confidence: Number.isFinite(m.confidence) ? clamp(m.confidence, 0, 1) : 0.5,
  });
  return parsed.success ? { extracted: parsed.data, quantityIsLooseItems: m.quantityIsLooseItems } : null;
}

/** Gemini extraction, temperature 0, cached 24 h by image URL or text. */
export async function extractNeeds(input: { imageUrl: string } | { text: string }): Promise<Extraction> {
  return cached("intake", input, () =>
    withRetry(
      async (signal) => {
        let messages: ModelMessage[];
        if ("imageUrl" in input) {
          const image = await loadImage(input.imageUrl);
          messages = [
            {
              role: "user",
              content: [
                { type: "text", text: INTAKE_IMAGE_PROMPT },
                { type: "file", data: image.bytes, mediaType: image.mediaType },
              ],
            },
          ];
        } else {
          messages = [
            { role: "user", content: `${INTAKE_TEXT_PROMPT}\n${wrapUntrusted("needs_list", input.text, 5000)}` },
          ];
        }
        const { output } = await generateText({
          model: languageModel(),
          instructions: INTAKE_SYSTEM,
          messages,
          output: Output.object({ schema: IntakeModelSchema }),
          temperature: 0,
          maxRetries: 0,
          abortSignal: signal,
          providerOptions: googleOptions(1024),
        });
        const items = output.items.flatMap((m) => toExtracted(m) ?? []).slice(0, MAX_INTAKE_ITEMS);
        const warnings = output.warnings.map((w) => clean(w, 200)).filter(Boolean);
        if (output.items.length > MAX_INTAKE_ITEMS) warnings.push(`Only the first ${MAX_INTAKE_ITEMS} items were kept`);
        return { items, warnings };
      },
      { label: "intake" },
    ),
  );
}

// ---------------------------------------------------------------------------------------------
// Pack math (deterministic)
// ---------------------------------------------------------------------------------------------

function plural(word: string, n: number): string {
  if (n === 1 || /s$/i.test(word)) return word;
  if (/(x|ch|sh)$/i.test(word)) return `${word}es`;
  if (/[^aeiou]y$/i.test(word)) return `${word.slice(0, -1)}ies`;
  return `${word}s`;
}

const addNote = (notes: string | null, note: string) => (notes ? `${notes}; ${note}` : note);

/**
 * Rewrites quantity/unit into purchasable packs of the chosen product and returns the pack count to fund.
 * - "300 diapers" + pack of 150 → 2 × "pack of 150", note "300 diapers = 2 packs of 150"
 * - loose pieces but the product's pack size is unknown → quantity unchanged, packsNeeded null (no target:
 *   300 × the pack price would be wildly wrong), note asks staff to check
 * - otherwise the quantity is already in purchasable units
 */
export function applyPackMath(
  item: ExtractedItem,
  product: Pick<ProductSnapshot, "packSize"> | undefined,
): { extracted: ExtractedNeed; packsNeeded: number | null } {
  const e = item.extracted;
  if (!product) return { extracted: e, packsNeeded: null };
  if (!item.quantityIsLooseItems) return { extracted: e, packsNeeded: e.quantity };
  const ps = product.packSize;
  if (ps === null) {
    return {
      extracted: { ...e, notes: addNote(e.notes, "check how many come in one pack before publishing") },
      packsNeeded: null,
    };
  }
  if (ps === 1) return { extracted: e, packsNeeded: e.quantity };
  const packs = Math.ceil(e.quantity / ps);
  const note = `${e.quantity} ${plural(e.unit, e.quantity)} = ${packs} ${plural("pack", packs)} of ${ps}`;
  return {
    extracted: { ...e, quantity: packs, unit: `pack of ${ps}`.slice(0, MAX_UNIT), notes: addNote(e.notes, note) },
    packsNeeded: packs,
  };
}

export function toDraft(item: ExtractedItem, options: ProductOption[]): DraftNeed {
  const { extracted, packsNeeded } = applyPackMath(item, options[0]);
  return {
    draftId: crypto.randomUUID(),
    extracted,
    options,
    suggestedTargetCents:
      options[0] && packsNeeded !== null ? computeTargetCents(options[0].unitPriceCents, packsNeeded) : null,
  };
}

// ---------------------------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------------------------

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return out;
}

const URL_ONLY = /^https?:\/\/\S+$/i;

/** Pasted retailer link → one draft with that exact product. */
async function intakeFromUrl(url: string): Promise<IntakeRes> {
  const product = await lookupByUrl(url);
  if (!product) {
    return {
      drafts: [],
      warnings: ["Couldn't find a product at that link. Try another link, or type the item instead."],
    };
  }
  // Best effort: let the model name and categorise it. Falls back to the product title / "other".
  let first: ExtractedItem | undefined;
  try {
    first = (await extractNeeds({ text: product.title })).items[0];
  } catch {
    first = undefined;
  }
  const extracted: ExtractedNeed = {
    title: first?.extracted.title ?? clean(product.title, MAX_TITLE),
    quantity: 1,
    unit: product.packSize && product.packSize > 1 ? `pack of ${product.packSize}` : "item",
    category: first?.extracted.category ?? "other",
    urgency: 2,
    notes: "Added from a product link: set the quantity",
    searchQuery: clean(product.title, 200),
    confidence: 1,
  };
  const option: ProductOption = {
    ...product,
    fitScore: 1,
    fitReason: "The product you linked",
    pricePerItemCents: pricePerItemCents(product),
  };
  return {
    drafts: [
      {
        draftId: crypto.randomUUID(),
        extracted,
        options: [option],
        suggestedTargetCents: computeTargetCents(product.unitPriceCents, 1),
      },
    ],
    warnings: [],
  };
}

/** POST /api/staff/intake body → drafts + warnings. Search/ranking failures per item never fail the whole intake. */
export async function runIntake(req: IntakeReq): Promise<IntakeRes> {
  const text = req.text?.trim();
  if (text && URL_ONLY.test(text)) return IntakeRes.parse(await intakeFromUrl(text));

  const input = req.imageUrl ? { imageUrl: req.imageUrl } : text ? { text } : null;
  if (!input) throw new HttpError(400, "VALIDATION", "Send a photo or some text");

  const { items, warnings } = await extractNeeds(input);
  if (items.length === 0 && warnings.length === 0)
    warnings.push("No items found. Try a clearer photo or type the list.");

  let searchFailed = false;
  const candidateLists = await mapLimit(items, SEARCH_CONCURRENCY, async (item) => {
    try {
      return await searchProducts(item.extracted.searchQuery, {
        limit: 8,
        excludeCategoryIds: item.extracted.category === "pet" ? [] : [PET_CATEGORY],
      });
    } catch (err) {
      searchFailed = true;
      console.warn("[intake] product search failed:", (err as Error).message);
      return [] as ProductSnapshot[];
    }
  });
  // One ranking call for the whole list (Gemini's free tier allows only a few requests per minute).
  const optionLists = await rankMany(items.map((item, i) => ({ input: item, candidates: candidateLists[i]! })));
  const drafts = items.map((item, i) => {
    const options = optionLists[i]!;
    const title = item.extracted.title;
    if (options.length === 0 && candidateLists[i]!.length > 0) {
      warnings.push(`No good product match for "${title}". Paste a product link to choose one yourself.`);
    } else if (options.length === 0 && !searchFailed) {
      warnings.push(`No products found for "${title}". Paste a product link to choose one yourself.`);
    }
    return toDraft(item, options);
  });
  if (searchFailed)
    warnings.push("Product search is unavailable right now, so some items have no product suggestions.");

  return IntakeRes.parse({ drafts, warnings: [...new Set(warnings)].slice(0, MAX_WARNINGS) });
}
