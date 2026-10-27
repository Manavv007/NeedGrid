import { buildApp } from "./app";
import { closeDb } from "./db/client";
import { env } from "./env";

const app = await buildApp();

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, "shutting down");
  try {
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
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
