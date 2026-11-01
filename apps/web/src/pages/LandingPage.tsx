import { Hero } from "@/features/landing/Hero";
import { HowItWorks } from "@/features/landing/HowItWorks";
import { OrgList } from "@/features/landing/OrgList";
import { MatchMeBox } from "@/features/match/MatchMeBox";
import { features } from "@/lib/features";

/** `/` (brief §9.1). The Match me box (P1) shows only while the `matchMe` flag is on. */
export function LandingPage() {
  return (
    <>
      <Hero />
      <HowItWorks />
      {features.matchMe ? <MatchMeBox /> : null}
      <OrgList />
    </>
  );
}
