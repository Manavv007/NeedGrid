import type { QueryClient } from "@tanstack/react-query";
import type { DataRouter } from "react-router";
import { clearStaffQueries } from "./queries";
import { clearStaffKey } from "./staffKey";
import { loginPathFor, setUnauthorizedHandler, STAFF_LOGIN_PATH } from "./unauthorized";

/**
 * Router state for "Sign out": StaffLayout navigates to the login page with it, and the login page
 * finishes signing out. Going through a navigation first lets a page with unsaved work (intake)
 * ask before anything is forgotten.
 */
export const SIGN_OUT_STATE = { signOut: true } as const;

export function isSignOutState(state: unknown): boolean {
  return typeof state === "object" && state !== null && "signOut" in state && state.signOut === true;
}

/** Forget the passcode and everything loaded with it. */
export function endStaffSession(queryClient: QueryClient): void {
  clearStaffKey();
  clearStaffQueries(queryClient);
}

/**
 * A staff request came back 401 (lib/api.ts has already cleared the key): go to the login page,
 * remembering where staff were, then drop the staff data. On the login page itself nothing moves.
 */
export function registerUnauthorizedRedirect(router: DataRouter, queryClient: QueryClient): void {
  setUnauthorizedHandler(() => {
    const { location } = router.state;
    if (location.pathname === STAFF_LOGIN_PATH) {
      clearStaffQueries(queryClient);
      return;
    }
    void router.navigate(loginPathFor(location), { replace: true }).then(() => clearStaffQueries(queryClient));
  });
}
