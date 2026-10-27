import { z } from "zod";

/** Treat empty strings from .env files as "not set". */
const optional = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === "" ? undefined : v.trim()));

/** Optional positive integer (e.g. HOLD_SECONDS); empty string = not set. */
const optionalPositiveInt = z
  .string()
  .optional()
  .transform((v, ctx) => {
    if (v === undefined || v.trim() === "") return undefined;
    const n = Number(v);
    if (!Number.isInteger(n) || n <= 0) {
      ctx.addIssue({ code: "custom", message: "must be a positive integer" });
      return z.NEVER;
    }
    return n;
  });

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required (Neon pooled connection string)"),
  TEST_DATABASE_URL: optional,

  PAYPAL_ENV: z.enum(["sandbox", "live"]).default("sandbox"),
  PAYPAL_CLIENT_ID: z.string().min(1, "PAYPAL_CLIENT_ID is required"),
  PAYPAL_CLIENT_SECRET: z.string().min(1, "PAYPAL_CLIENT_SECRET is required"),
  PAYPAL_WEBHOOK_ID: optional, // required from Phase 4 (webhooks)
  HOLD_SECONDS: optionalPositiveInt,

  WEB_ORIGIN: z.string().min(1, "WEB_ORIGIN is required (comma-separated list)"),
  STAFF_DEMO_KEY: optional,
  CLOUDINARY_CLOUD_NAME: z.string().min(1, "CLOUDINARY_CLOUD_NAME is required"),

  // B's keys: optional at boot. B's routes return 503 UPSTREAM when missing.
  GOOGLE_GENERATIVE_AI_API_KEY: optional,
  GEMINI_MODEL: z.string().default("gemini-2.5-flash"),
  GEMINI_EMBEDDING_MODEL: z.string().default("gemini-embedding-001"),
  CHANNEL3_API_KEY: optional,
  DASHBOARD_HMAC_SECRET: optional,
  RESEND_API_KEY: optional,
});

export type Env = z.infer<typeof EnvSchema>;

function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    // Fail fast with a readable message; never print values (they may be secrets).
    throw new Error(`Invalid environment configuration:\n${problems}\nSee .env.example.`);
  }
  return parsed.data;
}

export const env = loadEnv();

/** Allowed browser origins for CORS (WEB_ORIGIN list + local Vite dev server). */
export const allowedOrigins = [
  ...new Set([
    ...env.WEB_ORIGIN.split(",")
      .map((o) => o.trim())
      .filter(Boolean),
    "http://localhost:5173",
  ]),
];

export const holdSeconds = env.PAYPAL_ENV === "sandbox" && env.HOLD_SECONDS !== undefined ? env.HOLD_SECONDS : 15 * 60;
