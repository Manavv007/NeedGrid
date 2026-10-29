import type { OrgPublic } from "@needgrid/shared";
import { useOutletContext } from "react-router";

/** What StaffLayout hands to every staff page through the router's outlet. */
export type StaffOutletContext = { org: OrgPublic };

/** The signed-in charity. Only valid inside the staff routes, where StaffGate has already loaded it. */
export function useStaffOrg(): OrgPublic {
  return useOutletContext<StaffOutletContext>().org;
}
