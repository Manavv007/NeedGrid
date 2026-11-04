/** Vitest global setup/teardown: drops this run's private database (created in vitest.config.ts). Never throws. */
import { dropRunDatabase } from "./runDb";

export default function setup() {
  return async () => {
    const base = process.env.NG_TEST_BASE_URL ?? "";
    const name = process.env.NG_TEST_RUN_DB ?? "";
    if (base && name) await dropRunDatabase(base, name);
  };
}
