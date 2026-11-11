import test from "node:test";
import assert from "node:assert/strict";
import {
  addMonths,
  debitWallet,
  emptyWallet,
  normalizeWallet,
  refundWallet,
  units,
  type Wallet,
} from "../src/lib/credits";
import { cancellationQuote, type RefundInvoice } from "../src/lib/refunds";
const start = Date.UTC(2026, 0, 31, 14),
  end = addMonths(start, 12);
const invoice: RefundInvoice = {
  id: "annual",
  cadence: "annual",
  amount: 75000,
  currency: "SAR",
  displayAmount: 20000,
  monthlyCredits: 4000,
  paidAllocationMonths: 10,
  termStart: start,
  termEnd: end,
};
function annual(at = start): Wallet {
  return normalizeWallet(
    {
      ...emptyWallet(start),
      dailyRemaining: 0,
      entitlement: {
        paymentId: invoice.id,
        cadence: "annual",
        termStart: start,
        termEnd: end,
        monthlyCredits: 4000,
        paidAllocationMonths: 10,
      },
    },
    at,
  );
}
test("annual refund includes future paid months but excludes two promotional allocations", () => {
  const quote = cancellationQuote(annual(), invoice, start);
  assert.equal(quote.currentPaidCredits, 4000);
  assert.equal(quote.futurePaidCredits, 36000);
  assert.equal(quote.refundableCredits, 40000);
  assert.equal(quote.usdCents, 20000);
  assert.equal(quote.settlementAmount, 75000);
});
test("rollover is spendable but never included in cancellation refunds", () => {
  const at = addMonths(start, 1),
    wallet = annual(at);
  let quote = cancellationQuote(wallet, invoice, at);
  assert.equal(quote.excludedRolloverCredits, 4000);
  assert.equal(quote.currentPaidCredits, 4000);
  assert.equal(quote.futurePaidCredits, 32000);
  assert.equal(quote.refundDollars, 180);
  const paidOnly = { ...wallet, dailyRemaining: 0 };
  const spent = debitWallet(paidOnly, units(1000));
  quote = cancellationQuote(spent.wallet, invoice, at);
  assert.equal(quote.excludedRolloverCredits, 3000);
  assert.equal(quote.refundDollars, 180);
  const spentMore = debitWallet(paidOnly, units(4500));
  quote = cancellationQuote(spentMore.wallet, invoice, at);
  assert.equal(quote.excludedRolloverCredits, 0);
  assert.equal(quote.currentPaidCredits, 3500);
  assert.equal(quote.refundDollars, 177.5);
});
test("failed jobs restore the original allocation even after the month rolls over", () => {
  const original = debitWallet(annual(), units(160));
  const at = addMonths(start, 1);
  const rolled = normalizeWallet(original.wallet, at);
  const restored = refundWallet(rolled, original.debit);
  const quote = cancellationQuote(restored, invoice, at);
  assert.equal(quote.excludedRolloverCredits, 4000);
  assert.equal(quote.currentPaidCredits, 4000);
  assert.equal(quote.refundDollars, 180);
});
test("refunds use whole blocks of 100 and never refund daily or promotional balances", () => {
  const spent = debitWallet(annual(), units(50.01));
  const quote = cancellationQuote(spent.wallet, invoice, start);
  assert.equal(quote.refundableCredits, 39900);
  assert.equal(quote.refundDollars, 199.5);
  assert.equal(quote.settlementAmount, 74813);
  const promoAt = addMonths(start, 10),
    promo = cancellationQuote(annual(promoAt), invoice, promoAt);
  assert.equal(promo.currentPaidCredits, 0);
  assert.equal(promo.futurePaidCredits, 0);
  assert.equal(promo.excludedRolloverCredits, 40000);
  assert.equal(promo.refundDollars, 0);
  assert.equal(cancellationQuote(annual(), invoice, end).refundDollars, 0);
});
test("monthly refunds round down and SAR amounts use integer halalas", () => {
  const monthly: RefundInvoice = {
    ...invoice,
    id: "month",
    cadence: "monthly",
    amount: 7500,
    displayAmount: 2000,
    paidAllocationMonths: 1,
    termEnd: addMonths(start, 1),
  };
  let wallet = normalizeWallet(
    {
      ...emptyWallet(start),
      dailyRemaining: 0,
      entitlement: {
        paymentId: "month",
        cadence: "monthly",
        termStart: start,
        termEnd: monthly.termEnd!,
        monthlyCredits: 4000,
        paidAllocationMonths: 1,
      },
    },
    start,
  );
  wallet = debitWallet(wallet, units(3850)).wallet;
  const quote = cancellationQuote(wallet, monthly, start);
  assert.equal(quote.refundableCredits, 100);
  assert.equal(quote.usdCents, 50);
  assert.equal(quote.settlementAmount, 188);
});
test("queued paid terms refund future paid allocations without including active-plan credits", () => {
  const wallet = {
    ...annual(),
    queuedEntitlements: [
      {
        paymentId: "queued",
        cadence: "annual" as const,
        termStart: end,
        termEnd: addMonths(end, 12),
        monthlyCredits: 4000,
        paidAllocationMonths: 10,
      },
    ],
  };
  const quote = cancellationQuote(
    wallet,
    { ...invoice, id: "queued", termStart: end, termEnd: addMonths(end, 12) },
    start,
  );
  assert.equal(quote.currentPaidCredits, 0);
  assert.equal(quote.futurePaidCredits, 40000);
  assert.equal(quote.refundDollars, 200);
});

test("fewer than 100 eligible credits have no cash refund", () => {
  const monthly: RefundInvoice = {
    ...invoice,
    id: "tiny-month",
    cadence: "monthly",
    amount: 7500,
    displayAmount: 2000,
    paidAllocationMonths: 1,
    termEnd: addMonths(start, 1),
  };
  const wallet = normalizeWallet(
    {
      ...emptyWallet(start),
      dailyRemaining: 0,
      entitlement: {
        paymentId: monthly.id,
        cadence: "monthly",
        termStart: start,
        termEnd: monthly.termEnd!,
        monthlyCredits: 4000,
        paidAllocationMonths: 1,
      },
    },
    start,
  );
  const spent = debitWallet(wallet, units(3900.01));
  assert.equal(cancellationQuote(spent.wallet, monthly, start).usdCents, 0);
});
