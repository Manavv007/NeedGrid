import {
  ImpactRes,
  NeedDetailRes,
  OrgListRes,
  OrgPageRes,
  paths,
  type AGENT_ACTION_STATUSES,
  type NeedStatus,
} from "@needgrid/shared";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "./api";

type AgentActionStatus = (typeof AGENT_ACTION_STATUSES)[number];

/** Query keys (brief §7.5). Mutations and live updates invalidate or patch exactly these. */
export const queryKeys = {
  orgs: () => ["orgs"] as const,
  org: (slug: string) => ["org", slug] as const,
  need: (id: string) => ["need", id] as const,
  impact: (token: string) => ["impact", token] as const,
  staffNeeds: (status?: NeedStatus) => ["staffNeeds", status ?? null] as const,
  staffNeed: (id: string) => ["staffNeed", id] as const,
  actions: (status?: AgentActionStatus) => ["actions", status ?? null] as const,
  invoices: () => ["invoices"] as const,
};

export function useOrgs() {
  return useQuery({
    queryKey: queryKeys.orgs(),
    queryFn: ({ signal }) => apiGet(paths.orgs, OrgListRes, { signal }),
  });
}

export function useOrg(slug: string) {
  return useQuery({
    queryKey: queryKeys.org(slug),
    queryFn: ({ signal }) => apiGet(paths.org(slug), OrgPageRes, { signal }),
  });
}

export function useNeed(id: string) {
  return useQuery({
    queryKey: queryKeys.need(id),
    queryFn: ({ signal }) => apiGet(paths.need(id), NeedDetailRes, { signal }),
  });
}

export function useImpact(token: string) {
  return useQuery({
    queryKey: queryKeys.impact(token),
    queryFn: ({ signal }) => apiGet(paths.impact(token), ImpactRes, { signal }),
  });
}
