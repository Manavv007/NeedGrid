import { STAFF_KEY_HEADER } from "@needgrid/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { hashStaffKey } from "../lib/crypto";
import { HttpError } from "../lib/http";

/** The organization a staff request acts for. Full row so /api/staff/me can return OrgPublic. */
export interface StaffOrg {
  id: string;
  slug: string;
  name: string;
  city: string;
  description: string;
  causeTags: string[];
  logoUrl: string | null;
}

export type FindOrgByStaffKeyHash = (hash: string) => Promise<StaffOrg | null>;

declare module "fastify" {
  interface FastifyInstance {
    /** preHandler: 401 unless `x-staff-key` matches an organization. Sets req.staffOrg. */
    requireStaff: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    /** Set by requireStaff. Use getStaffOrg(req) to read it without a null check. */
    staffOrg?: StaffOrg;
  }
}

const MAX_KEY_LENGTH = 200;
/** Wrong passcodes allowed per client IP per window, before answering 429 (slows down guessing). */
export const STAFF_KEY_FAILURES = { max: 20, windowMs: 10 * 60_000 };

export const staffAuthPlugin = fp(
  async (app: FastifyInstance, opts: { findOrgByStaffKeyHash: FindOrgByStaffKeyHash }) => {
    // In memory: one API instance. Keyed by req.ip (trustProxy). Bounded so it can't grow without limit.
    const failures = new Map<string, { count: number; resetAt: number }>();
    const tooMany = (ip: string, now: number) => {
      const f = failures.get(ip);
      return Boolean(f && f.resetAt > now && f.count >= STAFF_KEY_FAILURES.max);
    };
    const recordFailure = (ip: string, now: number) => {
      const f = failures.get(ip);
      if (!f || f.resetAt <= now) {
        if (failures.size >= 10_000) failures.clear();
        failures.set(ip, { count: 1, resetAt: now + STAFF_KEY_FAILURES.windowMs });
      } else {
        f.count++;
      }
    };

    app.decorateRequest("staffOrg", undefined);
    app.decorate("requireStaff", async (req: FastifyRequest) => {
      const raw = req.headers[STAFF_KEY_HEADER];
      const key = Array.isArray(raw) ? raw[0] : raw;
      if (!key || key.length > MAX_KEY_LENGTH) {
        throw new HttpError(401, "UNAUTHORIZED", "Staff passcode required");
      }
      const now = Date.now();
      if (tooMany(req.ip, now)) {
        throw new HttpError(429, "RATE_LIMITED", "Too many wrong passcodes. Try again in 10 minutes.");
      }
      // Lookup is by unique hash, so the comparison happens in the database index.
      const org = await opts.findOrgByStaffKeyHash(hashStaffKey(key));
      if (!org) {
        recordFailure(req.ip, now);
        throw new HttpError(401, "UNAUTHORIZED", "That staff passcode is not valid");
      }
      req.staffOrg = org;
    });
  },
  { name: "needgrid-staff-auth" },
);

/** For handlers behind `preHandler: app.requireStaff`. */
export function getStaffOrg(req: FastifyRequest): StaffOrg {
  if (!req.staffOrg) throw new HttpError(401, "UNAUTHORIZED", "Staff passcode required");
  return req.staffOrg;
}
