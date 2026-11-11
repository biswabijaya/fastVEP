import { PLANS, type Cadence } from "../lib/credits";
// Fixed SAR/USD peg: SAR 3.75 per USD. Keep the catalog/display in USD.
export function paymentPrice(cadence: Cadence) {
  return {
    amount: PLANS[cadence].dollars * 375,
    currency: "SAR" as const,
    displayAmount: PLANS[cadence].dollars * 100,
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
        : PLANS[invoice.cadence].dollars * 100),
    currency: "USD",
  };
}
