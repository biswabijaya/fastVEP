import { CREDITS_PER_USD, type Cadence } from "./credits";
export type PaidTier = "research" | "clinical";
export type PaidPlan = {
  id: string;
  tier: PaidTier;
  name: string;
  monthlyDollars: number;
  monthlyCredits: number;
};
const options = (tier: PaidTier, prices: number[]): PaidPlan[] =>
  prices.map((monthlyDollars) => ({
    id: `${tier}-${monthlyDollars}`,
    tier,
    name: tier === "clinical" ? "Clinical" : "Research",
    monthlyDollars,
    monthlyCredits: monthlyDollars * CREDITS_PER_USD,
  }));
export const RESEARCH_PLANS = options(
  "research",
  [20, 40, 60, 80, 100, 150, 200],
);
export const CLINICAL_PLANS = options(
  "clinical",
  [200, 500, 1000, 2000, 5000, 10000, 20000],
);
export const PAID_PLANS = [...RESEARCH_PLANS, ...CLINICAL_PLANS];
export const findPlan = (id: unknown) =>
  typeof id === "string" ? PAID_PLANS.find((p) => p.id === id) : undefined;
export const planDollars = (plan: PaidPlan, cadence: Cadence) =>
  plan.monthlyDollars * (cadence === "annual" ? 10 : 1);
export const INCLUDED_CLINICAL_SERVICES = {
  clinical: "https://clinical.enigmagenomics.com",
  reporting: "https://reporting.enigmagenomics.com",
} as const;
