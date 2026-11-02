/**
 * Proof of delivery (AGENT_B_AI_DATA.md §9.4): a vision check of the arrival photo against the ordered product, and
 * the donor-facing note. Neither ever throws: a failed check returns matchScore 0 with UNAVAILABLE_NOTES, so the
 * delivery goes to human review (never auto-approved), and a failed note returns the staff text unchanged.
 *
 * Must not import ../core: ai/index.ts re-exports writeImpactNote and core imports ai/index.ts.
 */
import type { ModelMessage } from "ai";
import { generateText, Output } from "ai";
import { z } from "zod";
import { HttpError } from "../lib/http";
import { loadImage, loadProductImage } from "./images";
import { cached, callModel, isAiConfigured } from "./models";
import { DELIVERY_CHECK_SYSTEM, IMPACT_NOTE_SYSTEM } from "./prompts/delivery";
import { stripControlChars, wrapUntrusted } from "./untrusted";

/** Exact text: the web shows "The automatic check didn't run" for matchScore 0 + these notes (HANDOFF, C, Oct 31). */
export const UNAVAILABLE_NOTES = "Automatic check unavailable; please confirm.";
const MAX_NOTES = 200;
const MAX_IMPACT_NOTE = 300;

export interface DeliveryCheck {
  matchScore: number;
  notes: string;
  visibleQuantityOk: boolean | null;
  /** false when the model couldn't be asked (no key, quota, timeout, bad output). */
  checked: boolean;
}

export interface OrderedProduct {
  title: string;
  quantity: number;
  unit: string;
  imageUrl: string | null;
}

const CheckSchema = z.object({
  matchScore: z.number(),
  visibleQuantityOk: z.boolean().nullable(),
  retailDisplay: z.boolean(),
  notes: z.string(),
});

/**
 * A photo of the product on a shop shelf identifies the product but doesn't prove it arrived (live, Nov 1: our
 * demo store-aisle photo scored 0.9 for Huggies wipes). Capped below DELIVERY_MATCH_THRESHOLD, so staff review it.
 */
export const RETAIL_DISPLAY_MAX_SCORE = 0.5;

const unavailable = (): DeliveryCheck => ({
  matchScore: 0,
  notes: UNAVAILABLE_NOTES,
  visibleQuantityOk: null,
  checked: false,
});

const oneLine = (s: string) => stripControlChars(s).replace(/\s+/g, " ").trim();

function clampNotes(s: string): string {
  const t = oneLine(s);
  return t.length > MAX_NOTES ? `${t.slice(0, MAX_NOTES - 1)}…` : t;
}

/**
 * Arrival photo (our Cloudinary) vs the ordered product's title and, when Channel3 has one, its reference image.
 * Throws only HttpError 400 for a photo that isn't ours or can't be opened (staff must upload it again).
 */
export async function checkDeliveryPhoto(photoUrl: string, product: OrderedProduct): Promise<DeliveryCheck> {
  if (!isAiConfigured()) return unavailable();
  let photo;
  try {
    photo = await loadImage(photoUrl);
  } catch (err) {
    if (err instanceof HttpError && err.status === 400) throw err;
    console.warn("[ai] delivery photo download failed:", (err as Error).message);
    return unavailable();
  }
  const reference = await loadProductImage(product.imageUrl);
  const facts = [
    `Ordered: ${wrapUntrusted("product_title", product.title, 300)}`,
    `Quantity ordered: ${product.quantity} × ${wrapUntrusted("unit", product.unit, 40)}`,
    reference
      ? "The first image is the store's photo of the product. The second is the arrival photo."
      : "The image is the arrival photo.",
  ].join("\n");
  const messages: ModelMessage[] = [
    {
      role: "user",
      content: [
        { type: "text", text: facts },
        ...(reference ? [{ type: "file" as const, data: reference.bytes, mediaType: reference.mediaType }] : []),
        { type: "file", data: photo.bytes, mediaType: photo.mediaType },
      ],
    },
  ];
  try {
    const out = await cached("delivery", { photoUrl, product }, () =>
      callModel(
        async ({ model, signal, providerOptions }) => {
          const { output } = await generateText({
            model,
            instructions: DELIVERY_CHECK_SYSTEM,
            messages,
            output: Output.object({ schema: CheckSchema }),
            temperature: 0,
            maxRetries: 0,
            abortSignal: signal,
            providerOptions,
          });
          return output;
        },
        { label: "delivery", thinkingBudget: 512 },
      ),
    );
    if (!Number.isFinite(out.matchScore)) return unavailable();
    let score = Math.min(1, Math.max(0, out.matchScore));
    if (out.retailDisplay) score = Math.min(score, RETAIL_DISPLAY_MAX_SCORE);
    return {
      matchScore: Math.round(score * 100) / 100,
      notes:
        clampNotes(out.notes) || (out.retailDisplay ? "The photo looks like a store shelf." : "Checked the photo."),
      visibleQuantityOk: out.visibleQuantityOk,
      checked: true,
    };
  } catch (err) {
    console.warn("[ai] delivery check unavailable:", (err as Error).message);
    return unavailable();
  }
}

const NoteSchema = z.object({ note: z.string() });

/** Digit groups ("12", "3.5"), to catch invented numbers. */
const numbersIn = (s: string) => new Set(s.match(/\d+(?:[.,]\d+)?/g) ?? []);

/**
 * Two warm, factual sentences to the donors, from the staff note and the item title only.
 * Never throws: any failure, an over-long reply or a number that isn't in the input returns `staffNote` unchanged.
 */
export async function writeImpactNote(staffNote: string, needTitle: string): Promise<string> {
  if (!oneLine(staffNote) || !isAiConfigured()) return staffNote;
  try {
    const note = await cached("impact-note", { staffNote, needTitle }, () =>
      callModel(
        async ({ model, signal, providerOptions }) => {
          const { output } = await generateText({
            model,
            instructions: IMPACT_NOTE_SYSTEM,
            prompt: `Item: ${wrapUntrusted("item_title", needTitle, 200)}\nStaff note: ${wrapUntrusted("staff_note", staffNote, 500)}`,
            output: Output.object({ schema: NoteSchema }),
            temperature: 0.3,
            maxRetries: 0,
            abortSignal: signal,
            providerOptions,
          });
          return oneLine(output.note).replace(/!+/g, ".");
        },
        { label: "impact-note", thinkingBudget: 0 },
      ),
    );
    const allowed = numbersIn(`${staffNote} ${needTitle}`);
    const invented = [...numbersIn(note)].filter((n) => !allowed.has(n));
    if (!note || note.length > MAX_IMPACT_NOTE || invented.length > 0) return staffNote;
    return note;
  } catch (err) {
    console.warn("[ai] impact note kept as written:", (err as Error).message);
    return staffNote;
  }
}
