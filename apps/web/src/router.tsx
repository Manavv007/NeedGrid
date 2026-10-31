import { createBrowserRouter, type RouteObject } from "react-router";
import { PublicLayout } from "@/components/layout/PublicLayout";
import { RootLayout } from "@/components/layout/RootLayout";
import { PageSkeleton } from "@/components/PageSkeleton";
import { StaffGate } from "@/features/staff/StaffGate";
import { AssistantPage } from "@/pages/AssistantPage";
import { ImpactPage } from "@/pages/ImpactPage";
import { IntakePage } from "@/pages/IntakePage";
import { LandingPage } from "@/pages/LandingPage";
import { NeedPage } from "@/pages/NeedPage";
import { NotFoundPage } from "@/pages/NotFoundPage";
import { OrgPage } from "@/pages/OrgPage";
import { PlaceholderPage } from "@/pages/PlaceholderPage";
import { RouteErrorPage } from "@/pages/RouteErrorPage";
import { StaffConsolePage } from "@/pages/StaffConsolePage";
import { StaffLoginPage } from "@/pages/StaffLoginPage";
import { StaffNeedPage } from "@/pages/StaffNeedPage";
import { ThankYouPage } from "@/pages/ThankYouPage";

/** Every route from brief §9. Placeholders name the task that builds the real screen. */
export const routes: RouteObject[] = [
  {
    Component: RootLayout,
    ErrorBoundary: RouteErrorPage,
    HydrateFallback: PageSkeleton,
    children: [
      {
        Component: PublicLayout,
        children: [
          { index: true, Component: LandingPage },
          { path: "o/:slug", Component: OrgPage },
          { path: "o/:slug/n/:needId", Component: NeedPage },
          { path: "thanks/:token", Component: ThankYouPage },
          { path: "impact/:token", Component: ImpactPage },
          {
            // B owns src/dashboard/**; this route only lazy-loads its default export.
            path: "dashboard",
            lazy: async () => {
              const { default: Component } = await import("./dashboard/DashboardPage");
              return { Component };
            },
          },
          { path: "*", Component: NotFoundPage },
        ],
      },
      // Printable flyers have no site chrome (P1).
      { path: "o/:slug/flyer", element: <PlaceholderPage title="Flyer" task="C-11" /> },
      { path: "o/:slug/n/:needId/flyer", element: <PlaceholderPage title="Need flyer" task="C-11" /> },
      // A standalone staff page: outside the public layout and outside the gate.
      { path: "staff/login", Component: StaffLoginPage },
      {
        // No passcode → /staff/login?next=…; otherwise GET /api/staff/me once, then the staff shell.
        path: "staff",
        Component: StaffGate,
        children: [
          { index: true, Component: StaffConsolePage },
          { path: "intake", Component: IntakePage },
          { path: "needs/:id", Component: StaffNeedPage },
          { path: "assistant", Component: AssistantPage },
          { path: "invoices", element: <PlaceholderPage title="Invoices" task="C-10" /> },
        ],
      },
    ],
  },
];

export function createAppRouter() {
  return createBrowserRouter(routes);
}
