import { type Cadence, ServiceError } from "../lib/credits";
import { findPlan, planDollars } from "../lib/plans";
// Fixed SAR/USD peg. The server owns both the plan catalog and settlement amount.
export function paymentPrice(cadence: Cadence, planId: unknown) {
  const plan = findPlan(planId);
  if (!plan)
    throw new ServiceError(
      400,
      "Choose a valid plan and monthly credit allowance.",
    );
  const dollars = planDollars(plan, cadence);
  return {
    amount: dollars * 375,
    currency: "SAR" as const,
    displayAmount: dollars * 100,
    displayCurrency: "USD" as const,
  };
}
export function displayPayment(invoice: {
  cadence: Cadence;
  amount: number;
  currency: string;
  displayAmount?: number;
}) {
  return {
    amount:
      invoice.displayAmount ??
      (invoice.currency === "USD"
        ? invoice.amount
        : Math.round((invoice.amount * 4) / 15)),
    currency: "USD",
  };
}
