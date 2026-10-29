import { Outlet, ScrollRestoration } from "react-router";

/** Top of the route tree: scroll to top on navigation, or to the #hash target when there is one. */
export function RootLayout() {
  return (
    <>
      <Outlet />
      <ScrollRestoration />
    </>
  );
}
