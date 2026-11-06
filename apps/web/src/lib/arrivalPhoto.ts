import type { NeedCard } from "@needgrid/shared";
import { isCloudinaryImageUrl } from "./cloudinary";

/**
 * The arrival photo to show in place of the product photo (`NeedCard.deliveryPhotoUrl`, shared
 * v1.1.0): only for a delivered need, and only on our Cloudinary host (the same check as uploads).
 * Anything else → null, and the product photo stays.
 */
export function arrivalPhotoUrl(need: Pick<NeedCard, "status" | "deliveryPhotoUrl">): string | null {
  if (need.status !== "delivered") return null;
  return isCloudinaryImageUrl(need.deliveryPhotoUrl) ? need.deliveryPhotoUrl : null;
}
