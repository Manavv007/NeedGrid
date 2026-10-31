/**
 * Feature flags for P1 work that hasn't shipped yet. UI behind a flag stays hidden until its task
 * turns the flag on: flyers in C-11 and the Match me box once B's `POST /api/match` exists. The
 * console's "money action to approve" card is on since C-9 (it counts the pending approvals list).
 */
export type FeatureFlag = "flyers" | "matchMe" | "moneyActions";

export const features: Readonly<Record<FeatureFlag, boolean>> = {
  flyers: false,
  matchMe: false,
  moneyActions: true,
};
