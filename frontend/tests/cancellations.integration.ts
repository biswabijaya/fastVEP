import test from "node:test";
import assert from "node:assert/strict";
import { accountRef, database } from "../src/server/admin";
import { newAccount, getAccount, reserveBatch } from "../src/server/wallet";
import { normalizeWallet, addMonths, units } from "../src/lib/credits";
import {
  cancelSubscription,
  getCancellationQuote,
  prepareCancellation,
  type RefundGateway,
} from "../src/server/cancellations";
import { applyCapturedInvoice, type Invoice } from "../src/server/payments";
if (
  !process.env.FIRESTORE_EMULATOR_HOST ||
  process.env.GOOGLE_CLOUD_PROJECT !== "demo-fastvep"
)
  throw new Error("Demo emulator required");
const user = {
  uid: "cancel-owner",
  email: "cancel@example.invalid",
  name: "Cancel Test",
};
let sequence = 1;
async function seed() {
  const id = `fv-${(sequence++).toString(16).padStart(32, "0")}`,
    u = { ...user, uid: `${user.uid}-${sequence}` },
    now = Date.now(),
    account = newAccount(u, now);
  const invoice: Invoice = {
    id,
    uid: u.uid,
    cadence: "annual",
    planId: "clinical-200",
    tier: "clinical",
    monthlyCredits: 40000,
    paidAllocationMonths: 10,
    amount: 750000,
    currency: "SAR",
    displayAmount: 200000,
    status: "paid",
    createdAt: now,
    paidAt: now,
    fortId: `123456789${sequence}`,
    termStart: now,
    termEnd: addMonths(now, 12),
  };
  account.wallet = normalizeWallet(
    {
      ...account.wallet,
      entitlement: {
        paymentId: id,
        cadence: "annual",
        tier: "clinical",
        monthlyCredits: 40000,
        paidAllocationMonths: 10,
        termStart: now,
        termEnd: invoice.termEnd!,
      },
    },
    now,
  );
  await accountRef(u.uid).set(account);
  await database().collection("payments").doc(id).set(invoice);
  await accountRef(u.uid).collection("payments").doc(id).set(invoice);
  return { id, u, invoice };
}
function fakeProvider(invoice: Invoice, timeout = false) {
  let refunded = 0,
    calls = 0;
  const provider: RefundGateway = {
    check: async () => ({
      response_code: "12000",
      transaction_code: refunded ? "06000" : "14000",
      fort_id: invoice.fortId!,
      captured_amount: String(invoice.amount),
      refunded_amount: String(refunded),
    }),
    refund: async (_invoice, record) => {
      calls++;
      refunded = record.amount;
      if (timeout)
        throw new Error("Synthetic timeout after provider accepted refund");
    },
  };
  return { provider, count: () => calls };
}
test("cancellation is atomic, removes Clinical inclusions and sends one refund for concurrent retries", async () => {
  const { id, u, invoice } = await seed(),
    fake = fakeProvider(invoice);
  const quote = await getCancellationQuote(u, id);
  assert.equal("usdCents" in quote ? quote.usdCents : null, 200000);
  const results = await Promise.all([
    cancelSubscription(u, id, 200000, fake.provider),
    cancelSubscription(u, id, 200000, fake.provider),
  ]);
  assert.equal(fake.count(), 1);
  assert.ok(results.every((r) => r.status === "complete"));
  const view = await getAccount(u);
  assert.equal(view.subscriptionCredits, 0);
  assert.equal(view.dailyCredits, 300);
  assert.deepEqual(view.includedServices, {
    clinical: false,
    reporting: false,
    ai: false,
  });
  await cancelSubscription(u, id, 200000, fake.provider);
  assert.equal(fake.count(), 1);
  assert.equal(await applyCapturedInvoice(id, invoice.fortId!), false);
  assert.equal((await getAccount(u)).subscriptionCredits, 0);
});
test("ambiguous provider timeouts reconcile without sending a second refund", async () => {
  const { id, u, invoice } = await seed(),
    fake = fakeProvider(invoice, true);
  const result = await cancelSubscription(u, id, 200000, fake.provider);
  assert.equal(result.status, "complete");
  await cancelSubscription(u, id, 200000, fake.provider);
  assert.equal(fake.count(), 1);
});
test("owner checks, an active job and stale refund confirmation prevent cancellation", async () => {
  const { id, u } = await seed();
  await assert.rejects(
    getCancellationQuote({ ...u, uid: "someone-else" }, id),
    /not found/,
  );
  await assert.rejects(prepareCancellation(u, id, 1), /amount changed/);
  await reserveBatch(u, {
    id: "cancel-blocking-job-1111",
    fingerprint: "test",
    variants: 1,
    records: 1,
    genome: null,
    charge: units(150.01),
  });
  await assert.rejects(prepareCancellation(u, id, 200000), /batch to finish/);
  assert.equal(
    (await database().collection("payments").doc(id).get()).data()?.status,
    "paid",
  );
});
test.after(async () => {
  await database().terminate();
});

test("a late concurrent capture check reuses a completed cancellation", async () => {
  const { id, u, invoice } = await seed();
  const fake = fakeProvider(invoice);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let first = true;
  const delayed: RefundGateway = {
    ...fake.provider,
    check: async (inv) => {
      if (first) {
        first = false;
        entered();
        await held;
      }
      return fake.provider.check(inv);
    },
  };
  const second = cancelSubscription(u, id, 200000, delayed);
  await started;
  await cancelSubscription(u, id, 200000, fake.provider);
  release();
  assert.equal((await second).status, "complete");
  assert.equal(fake.count(), 1);
});

test("a cancellation with no refundable paid allocations ends access without a refund request", async () => {
  const { id, u, invoice } = await seed(),
    fake = fakeProvider(invoice);
  const snapshot = await accountRef(u.uid).get();
  const account = snapshot.data()!;
  const date = new Date();
  const start = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 10, 1),
    end = addMonths(start, 12);
  const updated = { ...invoice, termStart: start, termEnd: end };
  account.wallet = normalizeWallet(
    {
      ...account.wallet,
      paidWindow: null,
      paidRemaining: 0,
      paidAllocationCount: 0,
      creditBuckets: [],
      bucketPaymentId: "",
      entitlement: {
        ...account.wallet.entitlement,
        termStart: start,
        termEnd: end,
      },
    },
    Date.now(),
  );
  await accountRef(u.uid).set(account);
  await database().collection("payments").doc(id).set(updated);
  const result = await cancelSubscription(u, id, 0, fake.provider);
  assert.equal(result.usdCents, 0);
  assert.equal(result.status, "complete");
  assert.equal(fake.count(), 0);
  assert.equal((await getAccount(u)).plan, "free");
});
