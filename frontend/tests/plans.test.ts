import test from "node:test";
import assert from "node:assert/strict";
import {
  RESEARCH_PLANS,
  CLINICAL_PLANS,
  PAID_PLANS,
  findPlan,
  planDollars,
} from "../src/lib/plans";
import { paymentPrice, displayPayment } from "../src/server/payment-pricing";
import {
  addMonths,
  emptyWallet,
  normalizeWallet,
  units,
  walletView,
} from "../src/lib/credits";
test("tier ranges and every annual price come from the trusted catalog", () => {
  assert.equal(RESEARCH_PLANS[0].monthlyDollars, 20);
  assert.equal(RESEARCH_PLANS.at(-1)?.monthlyDollars, 200);
  assert.equal(CLINICAL_PLANS[0].monthlyDollars, 200);
  assert.equal(CLINICAL_PLANS.at(-1)?.monthlyDollars, 20000);
  for (const plan of PAID_PLANS) {
    assert.equal(plan.monthlyCredits, plan.monthlyDollars * 200);
    assert.equal(planDollars(plan, "annual"), plan.monthlyDollars * 10);
    const settlement = paymentPrice("annual", plan.id);
    assert.equal(settlement.amount, plan.monthlyDollars * 10 * 375);
    assert.equal(settlement.displayAmount, plan.monthlyDollars * 10 * 100);
    assert.equal(settlement.currency, "SAR");
  }
  assert.equal(findPlan("clinical-1"), undefined);
  assert.throws(
    () => paymentPrice("monthly", { id: "clinical-20000", amount: 1 }),
    /valid plan/,
  );
  assert.throws(() => paymentPrice("monthly", "research-21"), /valid plan/);
  assert.deepEqual(
    displayPayment({ cadence: "annual", currency: "SAR", amount: 90000 }),
    { amount: 24000, currency: "USD" },
  );
});
test("annual selected allowances roll over and Clinical inclusions expire with the paid term", () => {
  const start = Date.UTC(2026, 0, 31),
    end = addMonths(start, 12);
  const entitlement = {
    paymentId: "clinical-year",
    cadence: "annual" as const,
    tier: "clinical" as const,
    planId: "clinical-200",
    monthlyCredits: 40000,
    termStart: start,
    termEnd: end,
  };
  const first = normalizeWallet({ ...emptyWallet(start), entitlement }, start);
  assert.equal(first.paidRemaining, units(40000));
  const second = normalizeWallet(
    { ...first, paidRemaining: units(35000) },
    addMonths(start, 1),
  );
  assert.equal(second.paidRemaining, units(75000));
  const view = walletView(second, addMonths(start, 1));
  assert.equal(view.plan, "clinical");
  assert.equal(view.monthlyCreditAllocation, 40000);
  assert.deepEqual(view.includedServices, {
    clinical: true,
    reporting: true,
    ai: true,
  });
  const expired = walletView(second, end);
  assert.equal(expired.subscriptionCredits, 0);
  assert.deepEqual(expired.includedServices, {
    clinical: false,
    reporting: false,
    ai: false,
  });
  assert.equal(expired.dailyCredits, 300);
  const research = walletView(
    {
      ...first,
      entitlement: { ...entitlement, tier: "research", planId: "research-200" },
    },
    start,
  );
  assert.deepEqual(research.includedServices, {
    clinical: false,
    reporting: false,
    ai: false,
  });
});
