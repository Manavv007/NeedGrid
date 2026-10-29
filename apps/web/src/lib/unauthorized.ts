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
