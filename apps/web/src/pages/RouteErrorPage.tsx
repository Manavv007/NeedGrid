import { isRouteErrorResponse, useLocation, useRouteError } from "react-router";
import { ErrorState } from "@/components/ErrorState";
import { audienceForPath, reloadCopy } from "@/lib/errorCopy";
import { NotFoundPage } from "./NotFoundPage";

/** Root route ErrorBoundary: a 404 response shows the not-found page, anything else the ErrorState. */
export function RouteErrorPage() {
  const error = useRouteError();
  const { pathname } = useLocation();
  if (isRouteErrorResponse(error) && error.status === 404) return <NotFoundPage />;
  if (import.meta.env.DEV) console.error("[router] route error", error);
  return (
    <div className="flex min-h-svh items-center justify-center p-4">
      <ErrorState
        title="Something went wrong"
        message={reloadCopy(audienceForPath(pathname))}
        onRetry={() => window.location.reload()}
      />
    </div>
  );
}
