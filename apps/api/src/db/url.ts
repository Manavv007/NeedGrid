/**
 * Postgres connection-string helpers shared by the app, drizzle-kit and tests.
 * Kept free of env.ts imports so drizzle.config.ts can use it.
 */

/**
 * pg currently treats sslmode=require as verify-full and prints a SECURITY WARNING on every connect.
 * Make that explicit (same behaviour, no warning). Neon's certificates verify fine.
 */
export function normalizePgUrl(url: string): string {
  try {
    const u = new URL(url);
    const mode = u.searchParams.get("sslmode");
    if (mode === "require" || mode === "prefer" || mode === "verify-ca") u.searchParams.set("sslmode", "verify-full");
    return u.toString();
  } catch {
    return url;
  }
}

/**
 * Neon recommends a DIRECT (non-pooled) connection for schema migrations.
 * Pooled hosts look like `ep-xxx-pooler.region.aws.neon.tech`; the direct host drops `-pooler`.
 * Non-Neon URLs (CI's local Postgres) are returned unchanged.
 */
export function directNeonUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.hostname.endsWith(".neon.tech") && u.hostname.includes("-pooler.")) {
      u.hostname = u.hostname.replace("-pooler.", ".");
    }
    return u.toString();
  } catch {
    return url;
  }
}

/** Host + database name, for safety checks and logs (never the password). */
export function describePgUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname}`;
  } catch {
    return "<invalid url>";
  }
}
