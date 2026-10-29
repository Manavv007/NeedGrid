import type { OrgPublic } from "@needgrid/shared";
import { Link, NavLink, Outlet, useNavigate } from "react-router";
import type { StaffOutletContext } from "@/features/staff/useStaffOrg";
import { orgPath } from "@/lib/links";
import { SIGN_OUT_STATE } from "@/lib/staffSession";
import { STAFF_LOGIN_PATH } from "@/lib/unauthorized";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/staff", label: "Needs", end: true },
  { to: "/staff/assistant", label: "Assistant", end: false },
  { to: "/staff/invoices", label: "Invoices", end: false },
] as const;

// White focus ring: the default teal ring is invisible on the dark staff header.
const headerItem = "inline-flex min-h-11 items-center rounded-md px-3 text-sm no-underline focus-visible:outline-white";
const headerLink = "text-staff-header-link hover:text-primary-foreground";

type StaffLayoutProps = { org: OrgPublic };

/**
 * Staff shell (StaffConsole.dc.html): dark teal header so staff always know they're on the admin side,
 * with the signed-in charity's name. StaffGate renders it once `GET /api/staff/me` has answered.
 */
export function StaffLayout({ org }: StaffLayoutProps) {
  const navigate = useNavigate();
  const context: StaffOutletContext = { org };

  // The login page clears the key and the staff cache once it is showing (lib/staffSession.ts), so a
  // page with unsaved drafts can still ask first, and nothing on screen refetches with no key.
  function signOut() {
    void navigate(STAFF_LOGIN_PATH, { replace: true, state: SIGN_OUT_STATE });
  }

  return (
    <div className="flex min-h-svh flex-col bg-staff-bg">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-surface px-4 py-2 font-bold focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <header className="bg-staff-header text-primary-foreground">
        <div className="mx-auto flex max-w-300 flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <span className="text-base font-extrabold">NeedGrid</span>
            <span className="min-w-0 truncate rounded-full bg-white/14 px-2.5 py-1 text-[13px]">
              Staff <span aria-hidden="true">·</span> {org.name}
            </span>
          </div>
          <nav aria-label="Staff" className="flex flex-wrap items-center gap-1.5">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    headerItem,
                    isActive
                      ? "bg-white/14 font-bold text-primary-foreground hover:text-primary-foreground"
                      : headerLink,
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
            <Link to={orgPath(org.slug)} className={cn(headerItem, headerLink)}>
              Public page
            </Link>
            <button type="button" onClick={signOut} className={cn(headerItem, "cursor-pointer", headerLink)}>
              Sign out
            </button>
          </nav>
        </div>
      </header>
      <main id="main" tabIndex={-1} className="flex flex-1 flex-col outline-none">
        <Outlet context={context} />
      </main>
    </div>
  );
}
