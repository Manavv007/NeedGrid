import { buildApp } from "./app";
import { closeDb } from "./db/client";
import { env } from "./env";
import { startHoldReleaser } from "./jobs/releaseHolds";

const app = await buildApp();
let stopHoldReleaser: (() => void) | null = null;

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, "shutting down");
  try {
    stopHoldReleaser?.();
    await app.close();
    await closeDb();
  } finally {
    process.exit(0);
  }
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

try {
  await app.listen({ host: "0.0.0.0", port: env.PORT });
  // Background jobs run only in the real server, never in tests (which build the app directly).
  stopHoldReleaser = startHoldReleaser(app.log);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
