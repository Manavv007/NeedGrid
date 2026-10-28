import { z } from "zod";

/** Blank strings in .env files (`VITE_X=`) mean "not set". */
const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

const optionalText = z.preprocess(blankToUndefined, z.string().trim().optional()).transform((v) => v ?? null);

const EnvSchema = z.object({
  VITE_API_URL: z
    .preprocess(blankToUndefined, z.url({ protocol: /^https?$/ }).optional())
    .transform((v) => (v ? v.replace(/\/+$/, "") : null)),
  VITE_USE_MOCKS: z
    .preprocess(blankToUndefined, z.enum(["true", "false"]).default("false"))
    .transform((v) => v === "true"),
  VITE_PAYPAL_CLIENT_ID: optionalText,
  VITE_CLOUDINARY_CLOUD_NAME: optionalText,
  VITE_CLOUDINARY_UPLOAD_PRESET: optionalText,
  VITE_DEMO_STAFF_KEY: optionalText,
});

export type AppEnv = z.infer<typeof EnvSchema>;

export type EnvResult = { ok: true; env: AppEnv } | { ok: false; env: AppEnv; problems: string[] };

/** Safe values used only when the real config is broken, so modules can still import `env`. */
const FALLBACK_ENV: AppEnv = {
  VITE_API_URL: null,
  VITE_USE_MOCKS: false,
  VITE_PAYPAL_CLIENT_ID: null,
  VITE_CLOUDINARY_CLOUD_NAME: null,
  VITE_CLOUDINARY_UPLOAD_PRESET: null,
  VITE_DEMO_STAFF_KEY: null,
};

/**
 * Parses the public build-time config. PayPal and Cloudinary values may be missing (features that need
 * them show a message instead); the API URL is required unless mocks are on.
 */
export function parseEnv(raw: Record<string, unknown>): EnvResult {
  const parsed = EnvSchema.safeParse(raw);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join(".") || "env"}: ${i.message}`);
    return { ok: false, env: FALLBACK_ENV, problems };
  }
  const env = parsed.data;
  if (!env.VITE_USE_MOCKS && !env.VITE_API_URL) {
    return {
      ok: false,
      env,
      problems: ["VITE_API_URL is missing. Set it to the API's URL, or set VITE_USE_MOCKS=true to use mock data."],
    };
  }
  return { ok: true, env };
}

export const envResult = parseEnv(import.meta.env);
export const env: AppEnv = envResult.env;
