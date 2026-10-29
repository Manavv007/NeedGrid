export const STAFF_LOGIN_PATH = "/staff/login";

type Handler = () => void;

// Until the router registers a client-side handler (main.tsx), fall back to a full navigation.
let handler: Handler = () => window.location.assign(STAFF_LOGIN_PATH);

/** Called by main.tsx so a 401 navigates inside the SPA instead of reloading the page. */
export function setUnauthorizedHandler(next: Handler): void {
  handler = next;
}

/** A staff request came back 401: the key has already been cleared; send the user to sign in. */
export function notifyUnauthorized(): void {
  handler();
}

type PageLocation = { pathname: string; search: string };

const isStaffPath = (pathname: string) => pathname === "/staff" || pathname.startsWith("/staff/");
const isLoginPath = (pathname: string) => pathname === STAFF_LOGIN_PATH;

/**
 * Where to send someone who has to sign in: the login page, remembering the staff page they were
 * on (`?next=`) so signing in brings them back. Already on the login page, stay exactly there.
 */
export function loginPathFor(location: PageLocation): string {
  if (isLoginPath(location.pathname)) return `${location.pathname}${location.search}`;
  if (!isStaffPath(location.pathname)) return STAFF_LOGIN_PATH;
  return `${STAFF_LOGIN_PATH}?next=${encodeURIComponent(`${location.pathname}${location.search}`)}`;
}

/** Where sign-in goes by default. */
export const STAFF_HOME_PATH = "/staff";

/**
 * The `?next=` value after sign-in. Only same-site paths inside /staff are followed, so a crafted
 * login link can't send staff to another site. Anything else (and the login page itself) → /staff.
 */
export function safeStaffNext(raw: string | null): string {
  if (raw === null || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return STAFF_HOME_PATH;
  let url: URL;
  try {
    url = new URL(raw, "http://needgrid.invalid");
  } catch {
    return STAFF_HOME_PATH;
  }
  if (url.origin !== "http://needgrid.invalid") return STAFF_HOME_PATH;
  if (!isStaffPath(url.pathname) || isLoginPath(url.pathname)) return STAFF_HOME_PATH;
  return `${url.pathname}${url.search}${url.hash}`;
}
