import test from "node:test";
import assert from "node:assert/strict";
import { accountRef, database, requireUser } from "../src/server/admin";
import {
  getAccount,
  reserveBatch,
  settleBatch,
  newAccount,
} from "../src/server/wallet";
import { emptyWallet, addMonths, units } from "../src/lib/credits";
if (
  !process.env.FIRESTORE_EMULATOR_HOST ||
  process.env.GOOGLE_CLOUD_PROJECT !== "demo-fastvep"
)
  throw new Error("Integration tests require the demo emulator.");
const user = {
  uid: "test-wallet",
  email: "test@example.invalid",
  name: "Test",
};
const input = (id: string) => ({
  id,
  fingerprint: id,
  variants: 1000,
  records: 1000,
  genome: "GRCh38",
  charge: units(110),
});
const a = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  b = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
test("wallet transactions serialize concurrent jobs, replay once, and refund once", async () => {
  await accountRef(user.uid).delete();
  const outcomes = await Promise.allSettled([
    reserveBatch(user, input(a)),
    reserveBatch(user, input(b)),
  ]);
  assert.equal(outcomes.filter((x) => x.status === "fulfilled").length, 1);
  const winner = outcomes[0].status === "fulfilled" ? a : b;
  assert.equal((await getAccount(user)).dailyCredits, 190);
  assert.equal((await reserveBatch(user, input(winner))).replay, true);
  assert.equal((await getAccount(user)).dailyCredits, 190);
  await assert.rejects(
    reserveBatch(user, { ...input(winner), fingerprint: "different" }),
    /different batch/,
  );
  await settleBatch(user.uid, winner, { failure: "Test failure" });
  await settleBatch(user.uid, winner, { failure: "Test failure" });
  assert.equal((await getAccount(user)).dailyCredits, 300);
});
test("expired leases return credits and release the batch lock", async () => {
  const u = { ...user, uid: "expired-job" };
  await reserveBatch(u, input(a));
  await accountRef(u.uid)
    .collection("jobs")
    .doc(a)
    .update({ leaseUntil: Date.now() - 1 });
  assert.equal((await getAccount(u)).dailyCredits, 300);
  await reserveBatch(u, input(b));
  assert.equal((await getAccount(u)).dailyCredits, 190);
});
test("paid reservations consume daily first and successful settlement does not double debit", async () => {
  const u = { ...user, uid: "paid-wallet" },
    now = Date.now(),
    account = newAccount(u, now);
  account.wallet = {
    ...emptyWallet(now),
    dailyRemaining: units(30),
    entitlement: {
      paymentId: "verified-test-payment",
      cadence: "annual",
      termStart: now - 1000,
      termEnd: addMonths(now - 1000, 12),
    },
  };
  await accountRef(u.uid).set(account);
  const { job } = await reserveBatch(u, input(a));
  assert.equal(job.debit.freeUnits, units(30));
  assert.equal(job.debit.paidUnits, units(80));
  await settleBatch(u.uid, a, {
    path: "test-only.json",
    expiresAt: now + 1000,
  });
  await settleBatch(u.uid, a, {
    path: "test-only.json",
    expiresAt: now + 1000,
  });
  const view = await getAccount(u);
  assert.equal(view.dailyCredits, 0);
  assert.equal(view.subscriptionCredits, 3920);
});
test("API identity requires a verified, valid Firebase token", async () => {
  await assert.rejects(requireUser(new Request("http://localhost")), /Sign in/);
  await assert.rejects(
    requireUser(
      new Request("http://localhost", {
        headers: { Authorization: "Bearer invalid" },
      }),
    ),
    /session expired/,
  );
  const base = "http://" + process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const r = await fetch(
    `${base}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "unverified@example.invalid",
        password: "test-long-password",
        returnSecureToken: true,
      }),
    },
  );
  const data = await r.json();
  assert.ok(data.idToken);
  await assert.rejects(
    requireUser(
      new Request("http://localhost", {
        headers: { Authorization: `Bearer ${data.idToken}` },
      }),
    ),
    /Verify your email/,
  );
});
test.after(async () => {
  await database().terminate();
});

test("verified annual payments are granted once, not as an upfront annual credit lump sum", async () => {
  const { applyCapturedInvoice } = await import("../src/server/payments");
  const u = { ...user, uid: "payment-owner" },
    now = Date.now(),
    id = "fv-test-annual";
  await accountRef(u.uid).set(newAccount(u, now));
  await database().collection("payments").doc(id).set({
    id,
    uid: u.uid,
    cadence: "annual",
    amount: 90000,
    displayAmount: 24000,
    currency: "SAR",
    status: "pending",
    createdAt: now,
  });
  const results = await Promise.all([
    applyCapturedInvoice(id, "123456789", now),
    applyCapturedInvoice(id, "123456789", now),
  ]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal((await getAccount(u)).subscriptionCredits, 4000);
  await assert.rejects(
    applyCapturedInvoice(id, "different-capture", now),
    /conflict/,
  );
  const duplicate = "fv-test-duplicate";
  await database().collection("payments").doc(duplicate).set({
    id: duplicate,
    uid: u.uid,
    cadence: "monthly",
    amount: 7500,
    displayAmount: 2000,
    currency: "SAR",
    status: "pending",
    createdAt: now,
  });
  await assert.rejects(
    applyCapturedInvoice(duplicate, "123456789", now),
    /already been assigned/,
  );
});

test("annual rollover persists through repeated account reads without duplicate allocations", async () => {
  const { normalizeWallet } = await import("../src/lib/credits");
  const today = new Date();
  const start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 2, 1);
  const u = { ...user, uid: "annual-rollover-persisted" },
    account = newAccount(u, start);
  account.wallet = normalizeWallet(
    {
      ...account.wallet,
      entitlement: {
        paymentId: "rollover-year",
        cadence: "annual",
        termStart: start,
        termEnd: addMonths(start, 12),
      },
    },
    start,
  );
  account.wallet.paidRemaining = units(3000);
  await accountRef(u.uid).set(account);
  assert.equal((await getAccount(u)).subscriptionCredits, 11000);
  assert.equal((await getAccount(u)).subscriptionCredits, 11000);
  const saved = await accountRef(u.uid).get();
  assert.equal(saved.data()?.wallet.paidAllocationCount, 3);
});
