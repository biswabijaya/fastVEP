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
test("quotes include a fixed batch fee and charge each alternate allele", () => {
  assert.equal(quoteUnits(1000), units(160));
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
  assert.equal(normalizeWallet(wallet, now + 2000).dailyRemaining, units(200));
  assert.equal(walletView(wallet, now).dailyRefreshAt, Date.UTC(2026, 10, 12));
});
test("annual plans release credits monthly rather than upfront, with no rollover", () => {
  const start = Date.UTC(2026, 0, 31, 14);
  const entitlement = {
    paymentId: "p",
    cadence: "annual" as const,
    termStart: start,
    termEnd: addMonths(start, 12),
  };
  const wallet = normalizeWallet({ ...emptyWallet(start), entitlement }, start);
  assert.equal(wallet.paidRemaining, units(4000));
  assert.equal(wallet.paidExpiresAt, Date.UTC(2026, 1, 28, 14));
  const spent = { ...wallet, paidRemaining: units(3000) };
  const feb = normalizeWallet(spent, Date.UTC(2026, 1, 28, 14));
  assert.equal(feb.paidRemaining, units(4000));
  assert.equal(feb.paidExpiresAt, Date.UTC(2026, 2, 31, 14));
  assert.equal(normalizeWallet(feb, entitlement.termEnd).paidRemaining, 0);
});
test("refunds return only credits that have not expired", () => {
  const wallet = {
    ...emptyWallet(now),
    paidWindow: "old",
    paidRemaining: units(100),
  };
  const result = debitWallet(wallet, units(250));
  const later = normalizeWallet(result.wallet, now + 2000);
  assert.equal(refundWallet(later, result.debit).dailyRemaining, units(200));
  assert.equal(refundWallet(later, result.debit).paidRemaining, 0);
  assert.equal(
    refundWallet(result.wallet, result.debit).dailyRemaining,
    units(200),
  );
  assert.equal(
    refundWallet(result.wallet, result.debit).paidRemaining,
    units(100),
  );
});
