import { Menu, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Link, NavLink, useLocation, type To } from "react-router";
import { LogoMark } from "@/components/LogoMark";
import { Button } from "@/components/ui/button";
import { LANDING_HOW_IT_WORKS, LANDING_ORGS } from "@/lib/links";
import { STAFF_LOGIN_PATH } from "@/lib/unauthorized";

/** Landing sections are hash links; only real pages (`/dashboard`) can be the current page. */
const NAV: ReadonlyArray<{ label: string; to: To }> = [
  { label: "Charities", to: LANDING_ORGS },
  { label: "How it works", to: LANDING_HOW_IT_WORKS },
  { label: "Impact", to: "/dashboard" },
];

// The current page is bold as well as darker, so it never relies on colour alone.
const desktopLink =
  "inline-flex h-11 items-center rounded-md px-3 text-sm font-medium whitespace-nowrap text-soft no-underline hover:text-foreground aria-[current=page]:font-bold aria-[current=page]:text-foreground";
const panelBase = "flex min-h-12 items-center rounded-md px-3 text-base no-underline hover:bg-placeholder";
const panelLink = `${panelBase} font-semibold text-foreground hover:text-foreground aria-[current=page]:bg-primary-soft aria-[current=page]:text-primary`;
const panelQuietLink = `${panelBase} font-medium text-soft hover:text-foreground`;

type SiteLinkProps = { to: To; className: string; onClick?: () => void; children: string };

/** `NavLink` for pages (so it gets `aria-current="page"`), a plain `Link` for landing sections. */
function SiteLink({ to, className, onClick, children }: SiteLinkProps) {
  if (typeof to === "string") {
    return (
      <NavLink to={to} className={className} onClick={onClick}>
        {children}
      </NavLink>
    );
  }
  return (
    <Link to={to} className={className} onClick={onClick}>
      {children}
    </Link>
  );
}

/**
 * The public site header: logo, the three main links, "For charities" and "Give an item". Sticky. On
 * phones the links move into a menu that opens under the bar (a disclosure: Esc or a link closes it and
 * focus goes back to the menu button).
 */
export function SiteHeader() {
  const panelId = useId();
  const location = useLocation();
  const menuButton = useRef<HTMLButtonElement>(null);
  // The menu belongs to the page it was opened on, so any navigation (a link, Back) closes it.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === location.key;

  function closeMenu() {
    setOpenOn(null);
    menuButton.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpenOn(null);
      menuButton.current?.focus();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <header className="sticky top-0 z-30 border-b bg-surface/95 backdrop-blur-sm">
      <div className="mx-auto flex h-16 max-w-300 items-center gap-4 px-4 sm:px-6">
        <Link
          to="/"
          className="flex min-h-11 shrink-0 items-center gap-2.5 text-foreground no-underline hover:text-foreground"
        >
          <LogoMark />
          <span className="text-lg font-extrabold tracking-[-0.02em]">NeedGrid</span>
        </Link>

        <nav aria-label="Main" className="ml-auto hidden items-center gap-0.5 md:flex">
          {NAV.map((item) => (
            <SiteLink key={item.label} to={item.to} className={desktopLink}>
              {item.label}
            </SiteLink>
          ))}
        </nav>
        <div className="hidden shrink-0 items-center gap-2 md:flex">
          <SiteLink to={STAFF_LOGIN_PATH} className={desktopLink}>
            For charities
          </SiteLink>
          <Button asChild>
            <Link to={LANDING_ORGS}>Give an item</Link>
          </Button>
        </div>

        <Button
          ref={menuButton}
          type="button"
          variant="ghost"
          size="icon"
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpenOn(open ? null : location.key)}
          className="ml-auto md:hidden"
        >
          {open ? <X aria-hidden="true" className="size-6" /> : <Menu aria-hidden="true" className="size-6" />}
        </Button>
      </div>

      <div id={panelId} hidden={!open} className="border-t bg-surface md:hidden">
        <nav aria-label="Menu" className="mx-auto flex max-w-300 flex-col gap-1 px-4 pt-2 pb-4 sm:px-6">
          <ul className="flex flex-col gap-1">
            {NAV.map((item) => (
              <li key={item.label}>
                <SiteLink to={item.to} className={panelLink} onClick={closeMenu}>
                  {item.label}
                </SiteLink>
              </li>
            ))}
            <li>
              <SiteLink to={STAFF_LOGIN_PATH} className={panelQuietLink} onClick={closeMenu}>
                For charities
              </SiteLink>
            </li>
          </ul>
          <Button asChild size="lg" className="mt-2 w-full">
            <Link to={LANDING_ORGS} onClick={closeMenu}>
              Give an item
            </Link>
          </Button>
        </nav>
      </div>
    </header>
  );
}
