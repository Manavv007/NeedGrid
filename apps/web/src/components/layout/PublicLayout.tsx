import { Outlet } from "react-router";
import { useIsBigScreen } from "@/features/bigscreen/bigScreenMode";
import { SiteFooter } from "./SiteFooter";
import { SiteHeader } from "./SiteHeader";

/**
 * Donor-facing pages: sticky site header, content, site footer.
 * The big-screen wall (`/o/:slug?display=1`) has no header or footer.
 */
export function PublicLayout() {
  const bigScreen = useIsBigScreen();
  if (bigScreen) {
    return (
      <main id="main" className="flex min-h-svh flex-col">
        <Outlet />
      </main>
    );
  }

  return (
    <div className="flex min-h-svh flex-col">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-surface px-4 py-2 font-bold focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <SiteHeader />

      <main id="main" tabIndex={-1} className="flex flex-1 scroll-mt-16 flex-col outline-none">
        <Outlet />
      </main>

      <SiteFooter />
    </div>
  );
}
