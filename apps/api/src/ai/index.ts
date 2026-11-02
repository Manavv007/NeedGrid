// OWNER: B (AI & Data). A's code imports ONLY from this file; keep these exported names and signatures.
// Must not import from ../core (core/needs.ts imports this file → import cycle).
import type { NeedCard } from "@needgrid/shared";
import { embedText } from "./embeddings";
import { isEmbeddingConfigured } from "./models";

/**
 * Embedding for Match me: 768 unit-length dimensions, or null on ANY failure (no key, quota, timeout, bad size).
 * Never throws: publishing a need must not fail because of it. The need just isn't searchable by Match me.
 */
export async function embedNeedText(
  need: Pick<NeedCard, "title" | "description" | "category" | "unit">,
): Promise<number[] | null> {
  if (!isEmbeddingConfigured()) return null;
  try {
    return await embedText(
      `${need.title}. ${need.unit}. Category: ${need.category}. ${need.description}`,
      "RETRIEVAL_DOCUMENT",
    );
  } catch (err) {
    // The message never contains the need's text.
    console.warn("[ai] embedding skipped:", (err as Error).message);
    return null;
  }
}

/** Warm 2-sentence donor update from a staff note. Never throws: returns the input on failure (ai/delivery.ts). */
export { writeImpactNote } from "./delivery";
