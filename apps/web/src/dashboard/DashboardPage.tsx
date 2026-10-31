/**
 * Public impact dashboard (/dashboard, optional ?org=<slug>). OWNER: B. Lazy-loaded by C's router inside the public
 * layout; must stay the default export.
 *
 * View mode for everyone, with an "Edit / explore" switch. Edits are kept in this browser only
 * (localStorage needgrid.dashboard.v1); Reset brings back the default report. Nothing is saved on the server.
 * The AI chat appears only when the relay says the AI is on (GET /api/ai/dashboard-complete); everything else
 * works without it (§10.4).
 */
import { useQuery } from "@tanstack/react-query";
import {
  AgStudioAiModule,
  enableStudioDevValidations,
  type AgReportState,
  type AgStudioApi,
  type AgStudioMode,
} from "ag-studio";
import { AgStudio, AgStudioProvider } from "ag-studio-react";
import { useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { ErrorState } from "@/components/ErrorState";
import { Button } from "@/components/ui/button";
import { WakingUp } from "@/components/WakingUp";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import { buildAi } from "./agents";
import { buildStudioData, filterByOrg, useDashboardData, type DashboardData } from "./data";
import { isDashboardAiEnabled } from "./geminiAdapter";
import { clearSaved, defaultReport, loadSaved, PAGE_TITLES, save, withPanelsFor } from "./reportState";
import { needGridStudioTheme } from "./theme";

if (import.meta.env.DEV) enableStudioDevValidations();

const LICENSE = import.meta.env.VITE_AG_STUDIO_LICENSE || undefined;

export default function DashboardPage() {
  const [params] = useSearchParams();
  const org = params.get("org");
  const data = useDashboardData();
  const ai = useQuery({
    queryKey: ["dashboardAiEnabled"],
    queryFn: ({ signal }) => isDashboardAiEnabled({ signal }),
    staleTime: 5 * 60_000,
  });

  const orgName = data.data?.needs.find((n) => n.orgSlug === org)?.orgName ?? null;
  useDocumentTitle(orgName ? `Impact: ${orgName} · NeedGrid` : "Impact dashboard · NeedGrid");

  if (data.isPending) return <WakingUp />;
  if (data.isError) {
    return (
      <div className="px-4 py-10">
        <ErrorState title="We couldn't load the dashboard" onRetry={() => void data.refetch()} />
      </div>
    );
  }
  // The AI check is quick; show the dashboard without the chat until it answers rather than waiting.
  return <Dashboard data={filterByOrg(data.data, org)} orgName={orgName} aiEnabled={ai.data === true} />;
}

function Dashboard({ data, orgName, aiEnabled }: { data: DashboardData; orgName: string | null; aiEnabled: boolean }) {
  const apiRef = useRef<AgStudioApi | null>(null);
  const [mode, setMode] = useState<AgStudioMode>("view");
  const [selectedPageId, setSelectedPageId] = useState("impact");
  const [edited, setEdited] = useState(() => loadSaved() !== null);
  // Studio reads initialState once, when it's created.
  const [initialState] = useState<AgReportState>(() => withPanelsFor("view", loadSaved() ?? defaultReport()));
  const [pageIds, setPageIds] = useState(() => initialState.pages.map((p) => p.id));
  const studioData = useMemo(() => buildStudioData(data), [data]);
  const aiSetup = useMemo(() => (aiEnabled ? buildAi() : undefined), [aiEnabled]);

  const setState = (next: (s: AgReportState) => AgReportState) => {
    const api = apiRef.current;
    if (api) api.setState(next(api.getState()));
  };
  const changeMode = (next: AgStudioMode) => {
    setState((s) => withPanelsFor(next, s));
    setMode(next);
  };
  const selectPage = (pageId: string) => {
    setState((s) => ({ ...s, selectedPageId: pageId }));
    setSelectedPageId(pageId);
  };
  const reset = () => {
    clearSaved();
    setEdited(false);
    const api = apiRef.current;
    if (!api) return;
    api.setState(withPanelsFor(mode, defaultReport()));
    api.clearHistory();
    setSelectedPageId("impact");
    setPageIds(defaultReport().pages.map((p) => p.id));
  };

  const pages = pageIds.map((id, i) => ({ id, title: PAGE_TITLES[id] ?? `Page ${i + 1}` }));

  return (
    // Studio needs a fixed-height box; below the header it fills the rest of the window.
    <div className="flex min-h-[calc(100svh-4rem)] flex-1 flex-col">
      <div className="border-b bg-surface">
        <div className="mx-auto flex w-full max-w-300 flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div>
            <h1 className="text-2xl font-extrabold tracking-[-0.03em]">
              {orgName ? `${orgName}: impact` : "Where the money went"}
            </h1>
            <p className="text-sm text-muted-foreground">
              Every donation and every item, live from NeedGrid. No donor names or payment details are in here.
              {aiEnabled ? " Ask the AI a question, or switch to Edit to build your own charts." : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <nav aria-label="Dashboard pages" className="flex gap-1">
              {pages.map((p) => (
                <Button
                  key={p.id}
                  size="sm"
                  variant={p.id === selectedPageId ? "secondary" : "ghost"}
                  aria-current={p.id === selectedPageId ? "page" : undefined}
                  onClick={() => selectPage(p.id)}
                >
                  {p.title}
                </Button>
              ))}
            </nav>
            <Button
              size="sm"
              variant={mode === "edit" ? "default" : "outline"}
              aria-pressed={mode === "edit"}
              onClick={() => changeMode(mode === "edit" ? "view" : "edit")}
            >
              {mode === "edit" ? "Done editing" : "Edit / explore"}
            </Button>
            {edited ? (
              <Button size="sm" variant="ghost" onClick={reset}>
                Reset
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="relative min-h-180 flex-1">
        <div className="absolute inset-0">
          <AgStudioProvider licenseKey={LICENSE} modules={aiSetup ? [AgStudioAiModule] : undefined}>
            <AgStudio
              key={aiSetup ? "ai" : "plain"}
              style={{ height: "100%", width: "100%" }}
              theme={needGridStudioTheme}
              layout={{ widgetBorderEnabled: true }}
              data={studioData}
              ai={aiSetup}
              initialState={initialState}
              mode={mode}
              onApiReady={(event) => {
                apiRef.current = event.api;
              }}
              onStateUpdated={(event) => {
                // Page switches and new pages (from Studio or the AI) keep our page buttons in step.
                setSelectedPageId(event.state.selectedPageId);
                setPageIds(event.state.pages.map((p) => p.id));
                if (mode === "edit" || event.state.pages.length !== initialState.pages.length) {
                  save(event.state);
                  setEdited(true);
                }
              }}
            />
          </AgStudioProvider>
        </div>
      </div>
    </div>
  );
}
