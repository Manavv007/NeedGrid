import { createHash, timingSafeEqual } from "node:crypto";

/** SHA-256 lowercase hex of the UTF-8 passcode. Must match how B's seed stores organizations.staff_key_hash. */
export function hashStaffKey(passcode: string): string {
  return createHash("sha256").update(passcode, "utf8").digest("hex");
}

/** Constant-time comparison of two hex digests. */
export function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ab.length === bb.length && ab.length > 0 && timingSafeEqual(ab, bb);
}
