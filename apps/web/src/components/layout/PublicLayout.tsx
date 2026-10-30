import { Link, Outlet } from "react-router";
import { LogoMark } from "@/components/LogoMark";
import { useIsBigScreen } from "@/features/bigscreen/bigScreenMode";

const GITHUB_URL = "https://github.com/Manavv007/NeedGrid";

const navLink = "inline-flex min-h-11 items-center text-muted-foreground no-underline hover:text-foreground";

/**
 * Donor-facing pages: header with the sandbox pill, content, footer (Main.dc.html / Landing.dc.html).
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
      <header className="border-b bg-surface">
        <div className="mx-auto flex max-w-300 flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2.5 sm:px-6">
          <Link
            to="/"
            className="flex min-h-11 items-center gap-2.5 text-foreground no-underline hover:text-foreground"
          >
            <LogoMark />
            <span className="text-lg font-extrabold tracking-[-0.02em]">NeedGrid</span>
          </Link>
          <nav aria-label="Main" className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
            <Link to={{ pathname: "/", hash: "#orgs" }} className={navLink}>
              Charities
            </Link>
            <Link to="/dashboard" className={navLink}>
              See the impact
            </Link>
            <span className="rounded-full bg-badge-warning-bg px-2.5 py-1 text-xs font-semibold text-badge-warning-text">
              Sandbox demo, no real money
            </span>
          </nav>
        </div>
      </header>

      <main id="main" tabIndex={-1} className="flex flex-1 flex-col outline-none">
        <Outlet />
      </main>

      <footer className="border-t bg-surface">
        <div className="mx-auto flex max-w-300 flex-wrap justify-between gap-4 px-4 py-5 text-[13px] text-muted-foreground sm:px-6">
          <span>PayPal sandbox demo. No real money moves.</span>
          <span className="flex flex-wrap gap-x-4.5">
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 min-w-11 items-center justify-center"
            >
              GitHub
            </a>
            <Link to="/staff/login" className="inline-flex min-h-11 items-center">
              Try the staff console
            </Link>
          </span>
        </div>
      </footer>
    </div>
  );
}
