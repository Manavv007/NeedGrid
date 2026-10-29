import { NavLink, Outlet, useNavigate } from "react-router";
import { clearStaffKey } from "@/lib/staffKey";
import { STAFF_LOGIN_PATH } from "@/lib/unauthorized";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/staff", label: "Needs", end: true },
  { to: "/staff/assistant", label: "Assistant", end: false },
  { to: "/staff/invoices", label: "Invoices", end: false },
] as const;

// White focus ring: the default teal ring is invisible on the dark staff header.
const headerItem = "inline-flex min-h-11 items-center rounded-md px-3 text-sm no-underline focus-visible:outline-white";

/**
 * Staff shell (StaffConsole.dc.html): dark teal header so staff always know they're on the admin side.
 * The org name and the "Public page" link need `GET /api/staff/me`, which StaffGate adds in C-4.
 */
export function StaffLayout() {
  const navigate = useNavigate();

  function signOut() {
    clearStaffKey();
    void navigate(STAFF_LOGIN_PATH, { replace: true });
  }

  return (
    <div className="flex min-h-svh flex-col bg-staff-bg">
      <header className="bg-staff-header text-primary-foreground">
        <div className="mx-auto flex max-w-300 flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="text-base font-extrabold">NeedGrid</span>
            <span className="rounded-full bg-white/14 px-2.5 py-1 text-[13px]">Staff</span>
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
                      : "text-staff-header-link hover:text-primary-foreground",
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
            <button
              type="button"
              onClick={signOut}
              className={cn(headerItem, "cursor-pointer text-staff-header-link hover:text-primary-foreground")}
            >
              Sign out
            </button>
          </nav>
        </div>
      </header>
      <main id="main" className="flex flex-1 flex-col">
        <Outlet />
      </main>
    </div>
  );
}
