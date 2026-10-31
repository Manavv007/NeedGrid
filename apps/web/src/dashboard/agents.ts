/**
 * The dashboard's AI (AGENT_B_AI_DATA.md §10.2): ONE "analyst" agent on Studio's own loop (directLlmRunner),
 * driven by our Gemini adapter.
 *
 * Why not Studio's built-in team: it hands work lead → planning → page → widget → lead, about 15 model calls for
 * one chart, which runs every free-tier Gemini model out of its per-minute quota (seen live Oct 31), and the
 * lighter models lose track of the plan between agents. The analyst does the same with 3–4 calls:
 * add_widget, configure_<widgetId>, answer.
 *
 * Read-only by construction: only Studio's own tools (schema, queries, widgets and filters on this dashboard).
 * No network, PayPal or external tools; the data has no personal information; the relay adds NeedGrid's rules to
 * every turn (apps/api/src/ai/dashboardRelay.ts → DASHBOARD_GUARD). No model picker: the server picks Gemini.
 */
import {
  createAiHarness,
  directLlmRunner,
  type AgAiAgentContext,
  type AgAiHarnessSetup,
  type AgAiPromptStarter,
  type AgAiTool,
  type AgStudioApi,
} from "ag-studio";
import { geminiAdapter } from "./geminiAdapter";
import { defaultReport } from "./reportState";

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

/** Widgets of the built-in report: the analyst adds its own charts rather than rewiring these. */
const DEFAULT_WIDGET_IDS = new Set(defaultReport().pages.flatMap((p) => Object.keys(p.widgets ?? {})));
/** Configure tools listed per turn; each carries a large schema, and the relay caps a turn at 200 KB. */
const MAX_CONFIGURE_TOOLS = 4;

/** Studio's tool names must be function-name safe for Gemini: letters, digits, _ . - and at most 64 chars. */
export const configureToolName = (widgetId: string) =>
  `configure_${widgetId.replace(/[^A-Za-z0-9_.-]/g, "_")}`.slice(0, 64);

interface PageWidget {
  id: string;
  type: string;
}

/** Widgets on the selected page that the analyst may configure (added by someone, not the built-in ones). */
export function configurableWidgets(api: Pick<AgStudioApi, "getState">): PageWidget[] {
  const state = api.getState();
  const page = state.pages.find((p) => p.id === state.selectedPageId);
  return Object.entries(page?.widgets ?? {})
    .filter(([id, w]) => w && !DEFAULT_WIDGET_IDS.has(id))
    .map(([id, w]) => ({ id, type: String(w!.type) }))
    .slice(-MAX_CONFIGURE_TOOLS);
}

function analystTools({ api, studio }: AgAiAgentContext): AgAiTool[] {
  const configure = configurableWidgets(api).map((w) =>
    studio.configureWidget({ widgetType: w.type, widgetId: w.id }, { name: configureToolName(w.id) }),
  );
  return [
    studio.viewSchema(),
    studio.viewPage(),
    studio.executeQuery(),
    studio.addWidget(),
    studio.positionWidget(),
    studio.removeWidget(),
    studio.addWidgetFilter(),
    studio.removeWidgetFilter(),
    studio.addPageFilter(),
    studio.removePageFilter(),
    ...configure,
  ];
}

function analystInstructions({ api }: AgAiAgentContext): string {
  const ctx = api.getAiContext();
  const catalogue = ctx.catalogue();
  const onPage = new Set(configurableWidgets(api).map((w) => w.type));
  const types = catalogue
    .map((e) => `- ${e.type}: ${e.name}. ${e.description}${e.usage ? ` ${e.usage}` : ""}`)
    .join("\n");
  const guidance = catalogue
    .filter((e) => onPage.has(e.type) && e.configuration)
    .map((e) => `### ${e.type}\n${e.configuration}`)
    .join("\n\n");
  const widgets = configurableWidgets(api);

  return `## Role
You are NeedGrid's impact analyst, the only agent in this chat. You answer questions about NeedGrid's public impact data
by querying it and by adding charts to the dashboard page the reader is looking at. Keep answers short and plain.

## The data
- needs: one row per item a charity asked for (title, charity, category, urgency, status, target/funded/still needed in USD,
  dates, days from funded to delivered).
- donations: one row per gift (USD, charity, date, month "YYYY-MM").
- allocations: which item each dollar paid for (USD, category, charity, date, month "YYYY-MM"). "What did donations buy"
  means allocations.
- Months: the text field month is "YYYY-MM" (November 2026 = "2026-11"); for charts over time use calendar::month or
  calendar::week. Exact field ids come from view_schema (already loaded at the start of this conversation).

## How to work (few steps: every step costs time)
- A question about numbers: call execute_query once, then answer with the numbers from its result. Never invent numbers.
- A chart: (1) add_widget with a new widget id, a type from the catalogue below, placed below the existing widgets
  (yTrack = bottom of the lowest widget), about 12–24 columns wide and 14–18 rows high. (2) On your next turn a tool
  named configure_<widgetId> exists for it: call it with the data mapping (exact field ids, sum for USD amounts).
  (3) If a filter is needed (e.g. one month), add_widget_filter on that widget. (4) Say in one or two sentences what
  the chart shows. Add at most two widgets per request unless asked for more.
- Don't change or remove the existing built-in widgets; add new ones instead.
- If something fails, read the error, fix the arguments and try once more, then explain what went wrong.

## Widget catalogue
${types}
${guidance ? `\n## Configuration guidance for widgets you can configure\n${guidance}` : ""}
${widgets.length ? `\n## Widgets you can configure now\n${widgets.map((w) => `- ${w.id} (${w.type}): tool ${configureToolName(w.id)}`).join("\n")}` : ""}`;
}

export function buildAi(): AgAiHarnessSetup {
  const adapter = geminiAdapter();
  return ({ api }) =>
    createAiHarness(api, () => ({
      agents: [
        directLlmRunner({
          id: "analyst",
          name: "NeedGrid analyst",
          description: "Answers questions about NeedGrid's impact data and adds charts.",
          adapter,
          instructions: analystInstructions,
          tools: analystTools,
          defaultToolCalls: () => [{ tool: "view_schema" }, { tool: "view_page" }],
          // A backstop: one chart takes 3–4 rounds.
          maxTurns: 12,
        }),
      ],
      primary: "analyst",
      promptStarters: PROMPT_STARTERS,
    }));
}
