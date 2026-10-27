// OWNER: B (AI & Data). Created by A as a Day-1 stub; A's code imports ONLY from this file.
// Keep these exported names and signatures; replace the bodies.
import type { NeedCard } from "@needgrid/shared";

/** Embedding for Match me (768 dims). Must never throw: return null on any failure. */
export async function embedNeedText(
  _need: Pick<NeedCard, "title" | "description" | "category" | "unit">,
): Promise<number[] | null> {
  return null;
}

/** Warm 2-line donor update from a staff note. Must never throw: return the input on failure. */
export async function writeImpactNote(staffNote: string, _needTitle: string): Promise<string> {
  return staffNote;
}
