import { Hero } from "@/features/landing/Hero";
import { HowItWorks } from "@/features/landing/HowItWorks";
import { OrgList } from "@/features/landing/OrgList";

/** `/` (brief §9.1). The Match me box is P1 and not built yet. */
export function LandingPage() {
  return (
    <>
      <Hero />
      <HowItWorks />
      <OrgList />
    </>
  );
}
