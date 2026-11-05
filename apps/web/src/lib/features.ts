/**
 * Feature flags for P1 work. UI behind a flag stays hidden until the flag is on. The console's "money
 * action to approve" card is on since C-9 (it counts the pending approvals list); flyers since C-10;
 * Match me since B shipped POST /api/match (PR #36, live Nov 5).
 */
export type FeatureFlag = "flyers" | "matchMe" | "moneyActions";

export const features: Readonly<Record<FeatureFlag, boolean>> = {
  flyers: true,
  matchMe: true,
  moneyActions: true,
};
