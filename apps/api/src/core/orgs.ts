import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { organizations } from "../db/schema";
import type { StaffOrg } from "../plugins/staffAuth";

/** Used by the staff-auth plugin. `hash` = SHA-256 hex of the passcode (lib/crypto.hashStaffKey). */
export async function findOrgByStaffKeyHash(hash: string): Promise<StaffOrg | null> {
  const rows = await db
    .select({
      id: organizations.id,
      slug: organizations.slug,
      name: organizations.name,
      city: organizations.city,
      description: organizations.description,
      causeTags: organizations.causeTags,
      logoUrl: organizations.logoUrl,
    })
    .from(organizations)
    .where(eq(organizations.staffKeyHash, hash))
    .limit(1);
  return rows[0] ?? null;
}
