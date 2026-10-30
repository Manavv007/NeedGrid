/**
 * Dev-only switches for the hard donation cases, so they can be clicked through in mock mode.
 * Each one is armed once and used up by the next request it applies to:
 *
 * - `fullyFunded`: the next create-order finds another donor already paying for everything left
 *   → `409 FULLY_FUNDED` with the next most urgent need.
 * - `declined`:    the next capture fails like PayPal's `INSTRUMENT_DECLINED`. The mock button then
 *   does what PayPal's restart does (the donor picks another payment method) and the retry succeeds.
 * - `cancel`:      the next Mock PayPal click behaves as if the donor closed the PayPal window.
 *
 * One more switch isn't used up: `liveDemo` starts a pretend donor in this tab (liveDemo.ts), so
 * live updates can be watched without a second browser.
 *
 * MSW handlers only see the API URL, so the page URL is read once when the mock API starts
 * (`?mock=fullyFunded`, `?mock=declined,cancel`, or the param repeated). Tests arm them directly.
 */
const MOCK_SCENARIOS = ["fullyFunded", "declined", "cancel"] as const;
export type MockScenario = (typeof MOCK_SCENARIOS)[number];

const LIVE_DEMO = "liveDemo";

const isScenario = (value: string): value is MockScenario => (MOCK_SCENARIOS as readonly string[]).includes(value);

function mockNames(search: string): string[] {
  return new URLSearchParams(search)
    .getAll("mock")
    .flatMap((value) => value.split(","))
    .map((value) => value.trim());
}

/** Scenarios named in a page query string. Unknown names are ignored. */
export function scenariosFromSearch(search: string): MockScenario[] {
  return [...new Set(mockNames(search).filter(isScenario))];
}

/** `?mock=liveDemo` (alone or next to other scenarios). */
export function wantsLiveDemo(search: string): boolean {
  return mockNames(search).includes(LIVE_DEMO);
}
