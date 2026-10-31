/**
 * The dashboard's AI (AGENT_B_AI_DATA.md §10.2). AG Studio's built-in agent team, driven by our Gemini adapter.
 *
 * Read-only by construction: the built-in agents only have Studio's own tools (look at the schema, run queries,
 * add/configure/position widgets and filters on this page). There are no network, PayPal or external tools, and
 * the only data Studio holds is the three no-personal-data datasets. The relay adds NeedGrid's own rules to every
 * turn (apps/api/src/ai/dashboardRelay.ts → DASHBOARD_GUARD). Model picker off: the server chooses the model.
 */
import { createAiHarness, type AgAiHarnessSetup, type AgAiPromptStarter } from "ag-studio";
import { geminiAdapter } from "./geminiAdapter";

export const PROMPT_STARTERS: AgAiPromptStarter[] = [
  {
    label: "What did November buy?",
    prompt: "What did November's donations buy, by category? Show it as a chart.",
  },
  {
    label: "Most items delivered",
    prompt: "Which charity delivered the most items? Add a chart.",
  },
  {
    label: "Funded to delivered",
    prompt: "How long does it take from funded to delivered, on average, for each charity?",
  },
  {
    label: "Most urgent needs",
    prompt: "What's still needed most urgently? List the urgent items and how much is still needed for each.",
  },
];

export function buildAi(): AgAiHarnessSetup {
  const adapter = geminiAdapter();
  return ({ api }) => createAiHarness(api, { adapter, promptStarters: PROMPT_STARTERS });
}
