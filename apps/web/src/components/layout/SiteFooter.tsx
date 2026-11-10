import { useId, type ReactNode } from "react";
import { Link, type To } from "react-router";
import { LogoMark } from "@/components/LogoMark";
import { features } from "@/lib/features";
import { GITHUB_REPO_URL, LANDING_HOW_IT_WORKS, LANDING_MATCH, LANDING_ORGS } from "@/lib/links";
import { STAFF_LOGIN_PATH } from "@/lib/unauthorized";

const footerLink = "inline-flex min-h-11 items-center text-sm text-soft no-underline hover:text-foreground";

/** The public site footer: brand line, three link columns, and the small print. Only links to pages that exist. */
export function SiteFooter() {
  return (
    <footer className="border-t bg-surface">
      <div className="mx-auto max-w-300 px-4 pt-10 pb-6 sm:px-6">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,3fr)]">
          <div className="flex flex-col gap-3">
            <Link
              to="/"
              className="flex min-h-11 items-center gap-2.5 self-start text-foreground no-underline hover:text-foreground"
            >
              <LogoMark />
              <span className="text-lg font-extrabold tracking-[-0.02em]">NeedGrid</span>
            </Link>
            <p className="max-w-80 text-sm leading-normal text-soft">
              Fund the exact items charities need, and see them arrive.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3 md:gap-8">
            <FooterColumn title="Give">
              <FooterLink to={LANDING_ORGS}>Charities</FooterLink>
              {features.matchMe ? <FooterLink to={LANDING_MATCH}>Find a match</FooterLink> : null}
              <FooterLink to="/dashboard">Impact dashboard</FooterLink>
            </FooterColumn>
            <FooterColumn title="For charities">
              <FooterLink to={STAFF_LOGIN_PATH}>Staff sign in</FooterLink>
              <FooterLink to={LANDING_HOW_IT_WORKS}>How it works</FooterLink>
            </FooterColumn>
            <FooterColumn title="Project">
              <li>
                <a
                  href={GITHUB_REPO_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Source code (opens in a new tab)"
                  className={footerLink}
                >
                  Source code
                </a>
              </li>
              <li className="py-3 text-sm leading-snug text-soft">Built for the PayPal AI Hackathon 2026</li>
            </FooterColumn>
          </div>
        </div>
        <div className="mt-8 flex flex-wrap justify-between gap-x-6 gap-y-2 border-t pt-5 text-[13px] text-muted-foreground">
          <p>© 2026 NeedGrid</p>
          <p>Payments by PayPal · Every dollar is tracked to an item.</p>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <h2 id={id} className="text-sm font-bold text-foreground">
        {title}
      </h2>
      <ul aria-labelledby={id} className="flex flex-col">
        {children}
      </ul>
    </div>
  );
}

function FooterLink({ to, children }: { to: To; children: string }) {
  return (
    <li>
      <Link to={to} className={footerLink}>
        {children}
      </Link>
    </li>
  );
}
