import test from "node:test";
import assert from "node:assert/strict";
import {
  addMonths,
  debitWallet,
  emptyWallet,
  inspectVcf,
  normalizeWallet,
  quoteUnits,
  refundWallet,
  units,
  walletView,
} from "../src/lib/credits";
const now = Date.UTC(2026, 10, 11, 23, 59, 59);
const line = "17\t43124025\t.\tA\tG\t.\tPASS\t.";
test("quotes round to whole credits with no batch fee and count alternate alleles", () => {
  assert.equal(quoteUnits(1000), units(1));
  assert.equal(quoteUnits(1), units(1));
  assert.equal(inspectVcf(line.replace("\tG\t", "\tG,T\t")).variantCount, 2);
  assert.throws(() => inspectVcf(line.replaceAll("\t", " ")), /tab-separated/);
  assert.throws(() => inspectVcf(Array(1001).fill(line).join("\n")), /1,000/);
  assert.throws(
    () => inspectVcf(line.replace("\tG\t", "\t<NON_REF>\t")),
    /reference blocks/,
  );
});
test("daily credits are spent before subscription credits, including split debits", () => {
  const wallet = {
    ...emptyWallet(now),
    dailyRemaining: units(30),
    paidWindow: "paid",
    paidRemaining: units(4000),
  };
  const result = debitWallet(wallet, units(110));
  assert.equal(result.debit.freeUnits, units(30));
  assert.equal(result.debit.paidUnits, units(80));
  assert.equal(result.wallet.paidRemaining, units(3920));
  assert.equal(wallet.paidRemaining, units(4000));
});
test("insufficient credits do not change either balance", () => {
  const wallet = { ...emptyWallet(now), dailyRemaining: 1 };
  assert.throws(() => debitWallet(wallet, 2), /Not enough credits/);
  assert.equal(wallet.dailyRemaining, 1);
});
test("daily refresh expires unused credits without accumulating them", () => {
  const wallet = { ...emptyWallet(now), dailyRemaining: units(80) };
  assert.equal(normalizeWallet(wallet, now + 2000).dailyRemaining, units(300));
  assert.equal(walletView(wallet, now).dailyRefreshAt, Date.UTC(2026, 10, 12));
});
test("annual plans release credits monthly and preserve unused credits until term expiry", () => {
  const start = Date.UTC(2026, 0, 31, 14);
  const entitlement = {
    paymentId: "p",
    cadence: "annual" as const,
    termStart: start,
    termEnd: addMonths(start, 12),
  };
  const wallet = normalizeWallet({ ...emptyWallet(start), entitlement }, start);
  assert.equal(wallet.paidRemaining, units(4000));
  assert.equal(wallet.paidExpiresAt, entitlement.termEnd);
  const spent = { ...wallet, paidRemaining: units(3000) };
  const feb = normalizeWallet(spent, Date.UTC(2026, 1, 28, 14));
  assert.equal(feb.paidRemaining, units(7000));
  assert.equal(
    normalizeWallet(feb, Date.UTC(2026, 1, 28, 14)).paidRemaining,
    units(7000),
  );
  assert.equal(
    normalizeWallet(feb, Date.UTC(2026, 3, 30, 14)).paidRemaining,
    units(15000),
  );
  assert.equal(feb.paidExpiresAt, entitlement.termEnd);
  assert.equal(normalizeWallet(feb, entitlement.termEnd).paidRemaining, 0);
});
test("refunds return only credits that have not expired", () => {
  const wallet = {
    ...emptyWallet(now),
    paidWindow: "old",
    paidRemaining: units(100),
  };
  const result = debitWallet(wallet, units(350));
  const later = normalizeWallet(result.wallet, now + 2000);
  assert.equal(refundWallet(later, result.debit).dailyRemaining, units(300));
  assert.equal(refundWallet(later, result.debit).paidRemaining, 0);
  assert.equal(
    refundWallet(result.wallet, result.debit).dailyRemaining,
    units(300),
  );
  assert.equal(
    refundWallet(result.wallet, result.debit).paidRemaining,
    units(100),
  );
});

test("annual refunds survive monthly allocation boundaries but not annual expiry", () => {
  const start = Date.UTC(2026, 0, 31, 14),
    end = addMonths(start, 12);
  const wallet = normalizeWallet(
    {
      ...emptyWallet(start),
      dailyRemaining: 0,
      entitlement: {
        paymentId: "annual-refund",
        cadence: "annual",
        termStart: start,
        termEnd: end,
      },
    },
    start,
  );
  const spent = debitWallet(wallet, units(160));
  const nextMonth = normalizeWallet(spent.wallet, addMonths(start, 1));
  assert.equal(refundWallet(nextMonth, spent.debit).paidRemaining, units(8000));
  assert.equal(
    refundWallet(normalizeWallet(spent.wallet, end), spent.debit).paidRemaining,
    0,
  );
});
test("monthly credits expire and a new annual term does not inherit the previous year's credits", () => {
  const start = Date.UTC(2026, 0, 1),
    end = addMonths(start, 1);
  const monthly = normalizeWallet(
    {
      ...emptyWallet(start),
      entitlement: {
        paymentId: "monthly",
        cadence: "monthly",
        termStart: start,
        termEnd: end,
      },
    },
    start,
  );
  assert.equal(monthly.paidExpiresAt, end);
  assert.equal(normalizeWallet(monthly, end).paidRemaining, 0);
  const annual = normalizeWallet(
    {
      ...emptyWallet(start),
      entitlement: {
        paymentId: "year1",
        cadence: "annual",
        termStart: start,
        termEnd: addMonths(start, 12),
      },
    },
    addMonths(start, 11),
  );
  assert.equal(annual.paidRemaining, units(48000));
  const renewed = normalizeWallet(
    {
      ...annual,
      entitlement: {
        paymentId: "year2",
        cadence: "annual",
        termStart: addMonths(start, 12),
        termEnd: addMonths(start, 24),
      },
    },
    addMonths(start, 12),
  );
  assert.equal(renewed.paidRemaining, units(4000));
});

test("increasing the daily allowance tops up old wallets once without resetting usage", () => {
  const old = {
    ...emptyWallet(now),
    dailyAllowance: undefined,
    dailyRemaining: units(40),
  };
  const updated = normalizeWallet(old, now);
  assert.equal(updated.dailyRemaining, units(140));
  assert.equal(normalizeWallet(updated, now).dailyRemaining, units(140));
  assert.equal(normalizeWallet(updated, now + 2000).dailyRemaining, units(300));
});
