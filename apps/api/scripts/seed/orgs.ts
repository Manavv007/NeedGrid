/** The three demo charities (made up). Passcodes are public by design: judges use them, sandbox only. */
export interface SeedOrg {
  slug: string;
  name: string;
  city: string;
  description: string;
  causeTags: string[];
  staffPasscode: string;
  /** Pet products are only searched for the animal rescue; other orgs exclude Channel3's pet category. */
  allowPetProducts: boolean;
  /** Donor-facing arrival notes; {title} is replaced with the need title. */
  arrivalMessages: string[];
}

export const SEED_ORGS: SeedOrg[] = [
  {
    slug: "harbor-food-bank",
    name: "Harbor Food Bank",
    city: "Portland, OR",
    description:
      "A neighborhood food bank on the east side of Portland. We pack weekly family boxes with food, baby supplies and hygiene basics.",
    causeTags: ["food", "baby", "hygiene"],
    staffPasscode: "harbor-demo-2026",
    allowPetProducts: false,
    arrivalMessages: [
      "{title} arrived this week and went straight into our family boxes. Thank you for helping parents in our neighborhood.",
      "Your gift is here: {title} are on our shelves now. Families picked them up on Saturday.",
      "{title} came in today. Thank you for making sure no family leaves without the basics.",
    ],
  },
  {
    slug: "second-chance-paws",
    name: "Second Chance Paws",
    city: "Austin, TX",
    description:
      "A volunteer-run rescue that fosters dogs and cats until they find a home. Everything we use comes from donors.",
    causeTags: ["pet", "medical", "bedding"],
    staffPasscode: "paws-demo-2026",
    allowPetProducts: true,
    arrivalMessages: [
      "{title} arrived and are already in use in our foster homes. Thank you for looking after our animals.",
      "Your gift is here: {title} came in this week. The dogs and cats thank you too.",
      "{title} arrived today. Thank you for helping our animals get ready for their new homes.",
    ],
  },
  {
    slug: "room-12-readers",
    name: "Room 12 Readers",
    city: "Columbus, OH",
    description:
      "A third-grade classroom at a Columbus public school. We collect school supplies, books and warm clothes for 26 students.",
    causeTags: ["school", "clothing"],
    staffPasscode: "room12-demo-2026",
    allowPetProducts: false,
    arrivalMessages: [
      "{title} arrived in Room 12 today. The students say thank you.",
      "Your gift is here: {title} are already being used in class. Thank you for supporting our readers.",
      "{title} came in this week. Thank you for helping every student start the day ready to learn.",
    ],
  },
];
