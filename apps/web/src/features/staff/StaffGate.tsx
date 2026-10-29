import { Navigate, useLocation } from "react-router";
import { ErrorState } from "@/components/ErrorState";
import { StaffLayout } from "@/components/layout/StaffLayout";
import { PageSkeleton } from "@/components/PageSkeleton";
import { WakingUp } from "@/components/WakingUp";
import { ApiClientError } from "@/lib/api";
import { useStaffMe } from "@/lib/queries";
import { getStaffKey } from "@/lib/staffKey";
import { loginPathFor } from "@/lib/unauthorized";

/**
 * Wraps every /staff route except the login page. No passcode in this tab: go sign in and come back
 * (`?next=`). Otherwise `GET /api/staff/me` runs once for the whole console; a 401 there clears the key
 * and sends the user to the login page (lib/api.ts), so the gate only has to wait.
 */
export function StaffGate() {
  const location = useLocation();
  if (getStaffKey() === null) return <Navigate to={loginPathFor(location)} replace />;
  return <StaffSession />;
}

function StaffSession() {
  const me = useStaffMe();

  if (me.data) return <StaffLayout org={me.data.org} />;

  const signedOut = me.error instanceof ApiClientError && me.error.status === 401;
  if (me.isError && !signedOut) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-staff-bg p-4">
        <ErrorState
          title="We couldn't open the staff console"
          message={me.error.message}
          onRetry={() => void me.refetch()}
        />
      </div>
    );
  }

  return (
    <div className="min-h-svh bg-staff-bg">
      <PageSkeleton label={signedOut ? "Signing you out…" : "Opening the staff console…"} />
      <WakingUp />
    </div>
  );
}
