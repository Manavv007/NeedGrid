import { paths, StaffMeRes } from "@needgrid/shared";
import { useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from "react-router";
import { LogoMark } from "@/components/LogoMark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { env } from "@/env";
import { ApiClientError, apiGet } from "@/lib/api";
import { clearStaffQueries, queryKeys } from "@/lib/queries";
import { clearStaffKey, getStaffKey, setStaffKey } from "@/lib/staffKey";
import { endStaffSession, isSignOutState } from "@/lib/staffSession";
import { safeStaffNext } from "@/lib/unauthorized";
import { useDocumentTitle } from "@/lib/useDocumentTitle";

const WRONG_PASSCODE = "That passcode didn't work. Check it and try again.";
const EMPTY_PASSCODE = "Enter your passcode.";
const GENERIC_FAILURE = "We couldn't sign you in just now. Please try again in a moment.";

/** Public by design (judges use them) and only ever open the PayPal sandbox. */
const DEMO_PASSCODES = [
  { org: "Harbor Food Bank", passcode: "harbor-demo-2026" },
  { org: "Second Chance Paws", passcode: "paws-demo-2026" },
  { org: "Room 12 Readers", passcode: "room12-demo-2026" },
] as const;

/**
 * `/staff/login` (StaffLogin.dc.html). The passcode goes to sessionStorage and an `x-staff-key` header,
 * never into a URL, a log or the page. `?next=` brings staff back to the page they wanted.
 */
export function StaffLoginPage() {
  useDocumentTitle("Staff sign in · NeedGrid");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const location = useLocation();
  const [params] = useSearchParams();
  const next = safeStaffNext(params.get("next"));
  const signingOut = isSignOutState(location.state);

  // Read once: signing in stores a key while this page is still showing. Signing out never counts.
  const [alreadySignedIn] = useState(() => !signingOut && getStaffKey() !== null);
  const [passcode, setPasscode] = useState("");
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);

  // "Sign out" lands here (StaffLayout): the staff pages are gone now, so forget the key and their data.
  useEffect(() => {
    if (signingOut) endStaffSession(queryClient);
  }, [signingOut, queryClient]);

  if (alreadySignedIn) return <Navigate to={next} replace />;

  async function signIn(key: string) {
    const trimmed = key.trim();
    if (trimmed === "") {
      setError(EMPTY_PASSCODE);
      return;
    }
    if (submitting.current) return;
    submitting.current = true;
    setPending(true);
    setError(null);
    setStaffKey(trimmed);
    try {
      const me = await apiGet(paths.staff.me, StaffMeRes, { staff: true });
      clearStaffQueries(queryClient);
      queryClient.setQueryData(queryKeys.staffMe(), me);
      void navigate(next, { replace: true });
    } catch (caught) {
      clearStaffKey();
      setError(failureMessage(caught));
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void signIn(passcode);
  }

  const demoKey = env.VITE_DEMO_STAFF_KEY;

  return (
    <div className="flex min-h-svh flex-col bg-staff-bg">
      <header className="bg-staff-header text-primary-foreground">
        <div className="mx-auto flex max-w-300 items-center gap-2.5 px-4 py-3 sm:px-6">
          <LogoMark />
          <span className="text-base font-extrabold">NeedGrid staff</span>
        </div>
      </header>

      <main id="main" tabIndex={-1} className="flex flex-1 flex-col items-center px-4 py-10 outline-none sm:py-16">
        <div className="w-full max-w-md rounded-2xl border bg-surface p-6 sm:p-8">
          <h1 className="text-2xl font-extrabold tracking-[-0.02em]">Sign in to your charity</h1>
          <p className="mt-1.5 text-sm text-soft">Use the staff passcode your charity was given.</p>

          {demoKey ? (
            <div className="mt-6">
              <Button size="lg" className="w-full" disabled={pending} onClick={() => void signIn(demoKey)}>
                Try the staff console
              </Button>
              <p className="mt-2 text-center text-[13px] text-muted-foreground">
                For judges: signs in to Harbor Food Bank with the demo passcode.
              </p>
              <div aria-hidden="true" className="mt-5 flex items-center gap-3 text-xs text-muted-foreground">
                <span className="h-px flex-1 bg-border-strong" />
                or use a passcode
                <span className="h-px flex-1 bg-border-strong" />
              </div>
            </div>
          ) : null}

          <form onSubmit={onSubmit} noValidate className="mt-6 flex flex-col gap-3">
            <label htmlFor="passcode" className="text-sm font-bold">
              Passcode
            </label>
            <div className="relative">
              <Input
                id="passcode"
                name="passcode"
                type={visible ? "text" : "password"}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                value={passcode}
                onChange={(event) => setPasscode(event.target.value)}
                aria-invalid={error !== null}
                aria-describedby={error ? "passcode-error" : undefined}
                className="pr-12"
              />
              <button
                type="button"
                aria-label="Show passcode"
                aria-pressed={visible}
                onClick={() => setVisible((v) => !v)}
                className="absolute inset-y-0 right-0 flex w-11 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
              >
                {visible ? (
                  <EyeOff aria-hidden="true" className="size-4.5" />
                ) : (
                  <Eye aria-hidden="true" className="size-4.5" />
                )}
              </button>
            </div>
            {error ? (
              <p id="passcode-error" role="alert" className="text-sm font-medium text-danger">
                {error}
              </p>
            ) : null}
            <Button type="submit" size="lg" disabled={pending}>
              {pending ? "Signing in…" : "Sign in"}
            </Button>
          </form>

          <details className="mt-5 text-sm">
            <summary className="flex min-h-11 cursor-pointer items-center font-medium text-primary">
              Demo passcodes (sandbox only)
            </summary>
            <ul className="mt-1 flex flex-col gap-1 text-soft">
              {DEMO_PASSCODES.map((demo) => (
                <li key={demo.org}>
                  {demo.org}: <code className="font-mono text-[13px]">{demo.passcode}</code>
                </li>
              ))}
            </ul>
          </details>
        </div>

        <Link to="/" className="mt-6 inline-flex min-h-11 items-center text-sm">
          Back to NeedGrid
        </Link>
      </main>
    </div>
  );
}

/** 401 = wrong passcode; no connection keeps the API client's explanation; anything else is generic. */
function failureMessage(error: unknown): string {
  if (!(error instanceof ApiClientError)) return GENERIC_FAILURE;
  if (error.status === 401) return WRONG_PASSCODE;
  return error.code === "NETWORK" ? error.message : GENERIC_FAILURE;
}
