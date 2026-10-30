/**
 * Feature flags for P1 work that hasn't shipped yet. UI behind a flag stays hidden until its task
 * turns the flag on: flyers in C-11, the Match me box once B's `POST /api/match` exists.
 */
export type FeatureFlag = "flyers" | "matchMe";

export const features: Readonly<Record<FeatureFlag, boolean>> = {
  flyers: false,
  matchMe: false,
};
