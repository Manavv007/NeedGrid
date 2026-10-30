import { setupWorker } from "msw/browser";
import { handlers } from "./handlers";
import { startLiveDemo } from "./liveDemo";
import { mockDb } from "./mockDb";
import { scenariosFromSearch, wantsLiveDemo } from "./scenarios";

/** Browser mock API, started by main.tsx when VITE_USE_MOCKS=true. */
export const worker = setupWorker(...handlers);

/**
 * Arms any `?mock=` scenarios from the page URL (handlers can't see it), then starts the worker.
 * Reload the page with the param to arm a scenario again. `?mock=liveDemo` also starts the pretend
 * donor (liveDemo.ts) once the worker answers requests.
 */
export async function startMockApi(): Promise<void> {
  const scenarios = scenariosFromSearch(window.location.search);
  for (const scenario of scenarios) mockDb.armScenario(scenario);
  if (scenarios.length > 0) console.info(`[mocks] armed for the next request: ${scenarios.join(", ")}`);
  await worker.start({ onUnhandledRequest: "bypass" });
  if (wantsLiveDemo(window.location.search)) startLiveDemo();
}
