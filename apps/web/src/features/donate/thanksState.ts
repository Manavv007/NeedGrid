import { Cents } from "@needgrid/shared";
import { z } from "zod";

/**
 * Router state handed from the donate panel to `/thanks/:token`. Amounts never go in the URL.
 * `clampedAmountCents`: the server lowered the gift to what was left (CreateOrderRes.amountCents).
 */
export const ThanksState = z.object({ clampedAmountCents: Cents });
export type ThanksState = z.infer<typeof ThanksState>;
