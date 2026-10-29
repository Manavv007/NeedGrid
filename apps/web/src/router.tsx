import { createBrowserRouter, type RouteObject } from "react-router";
import { PublicLayout } from "@/components/layout/PublicLayout";
import { RootLayout } from "@/components/layout/RootLayout";
import { StaffLayout } from "@/components/layout/StaffLayout";
import { PageSkeleton } from "@/components/PageSkeleton";
import { LandingPage } from "@/pages/LandingPage";
import { NotFoundPage } from "@/pages/NotFoundPage";
import { OrgPage } from "@/pages/OrgPage";
import { PlaceholderPage } from "@/pages/PlaceholderPage";
import { RouteErrorPage } from "@/pages/RouteErrorPage";

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
          { path: "o/:slug/n/:needId", element: <PlaceholderPage title="Need" task="C-3" /> },
          { path: "thanks/:token", element: <PlaceholderPage title="Thank you" task="C-3" /> },
          { path: "impact/:token", element: <PlaceholderPage title="Your impact" task="C-8" /> },
          {
            // B owns src/dashboard/**; this route only lazy-loads its default export.
            path: "dashboard",
            lazy: async () => {
              const { default: Component } = await import("./dashboard/DashboardPage");
              return { Component };
            },
          },
          { path: "staff/login", element: <PlaceholderPage title="Staff sign in" task="C-4" /> },
          { path: "*", Component: NotFoundPage },
        ],
      },
      // Printable flyers have no site chrome (P1).
      { path: "o/:slug/flyer", element: <PlaceholderPage title="Flyer" task="C-11" /> },
      { path: "o/:slug/n/:needId/flyer", element: <PlaceholderPage title="Need flyer" task="C-11" /> },
      {
        // StaffGate (C-4) will wrap these: no key → /staff/login.
        path: "staff",
        Component: StaffLayout,
        children: [
          { index: true, element: <PlaceholderPage title="Needs" task="C-4" /> },
          { path: "intake", element: <PlaceholderPage title="Add needs" task="C-4" /> },
          { path: "needs/:id", element: <PlaceholderPage title="Manage need" task="C-6" /> },
          { path: "assistant", element: <PlaceholderPage title="Assistant" task="C-9" /> },
          { path: "invoices", element: <PlaceholderPage title="Invoices" task="C-10" /> },
        ],
      },
    ],
  },
];

export function createAppRouter() {
  return createBrowserRouter(routes);
}
