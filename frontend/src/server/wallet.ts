import { createHash } from "node:crypto";
import type { Transaction } from "firebase-admin/firestore";
import { accountRef, database } from "./admin";
import {
  credits,
  debitWallet,
  emptyWallet,
  normalizeWallet,
  refundWallet,
  ServiceError,
  walletView,
  type Debit,
  type Wallet,
} from "../lib/credits";
export type Identity = { uid: string; email: string; name: string };
export type Account = {
  uid: string;
  email: string;
  name: string;
  createdAt: number;
  wallet: Wallet;
  activeJob: string | null;
  renewAutomatically?: boolean;
  paymentToken?: string;
  agreementId?: string;
  nextChargeAt?: number;
  cadence?: "monthly" | "annual";
  pendingInvoice?: string;
};
export type Batch = {
  id: string;
  fingerprint: string;
  variants: number;
  records: number;
  genome: string | null;
  status: "pending" | "complete" | "refunded";
  debit: Debit;
  createdAt: number;
  leaseUntil: number;
  completedAt?: number;
  resultExpiresAt?: number;
  resultPath?: string;
  failure?: string;
};
export function newAccount(user: Identity, now: number): Account {
  return { ...user, createdAt: now, wallet: emptyWallet(now), activeJob: null };
}
async function reconcile(tx: Transaction, user: Identity, now: number) {
  const ref = accountRef(user.uid),
    snapshot = await tx.get(ref);
  const account: Account = snapshot.exists
    ? (snapshot.data() as Account)
    : newAccount(user, now);
  account.wallet = normalizeWallet(account.wallet, now);
  if (account.activeJob) {
    const jobRef = ref.collection("jobs").doc(account.activeJob),
      jobSnapshot = await tx.get(jobRef);
    const job = jobSnapshot.data() as Batch | undefined;
    if (!job || job.status !== "pending") account.activeJob = null;
    else if (job.leaseUntil < now) {
      account.wallet = refundWallet(account.wallet, job.debit);
      account.activeJob = null;
      tx.update(jobRef, {
        status: "refunded",
        failure:
          "This batch did not finish in time. Its unexpired credits were returned.",
        completedAt: now,
      });
      tx.set(ref.collection("ledger").doc(`refund_${job.id}`), {
        kind: "refund",
        jobId: job.id,
        units: job.debit.totalUnits,
        at: now,
      });
    }
  }
  return { ref, account };
}
export async function getAccount(user: Identity) {
  return database().runTransaction(async (tx) => {
    const now = Date.now(),
      { ref, account } = await reconcile(tx, user, now);
    tx.set(ref, account);
    return {
      ...walletView(account.wallet, now),
      email: user.email,
      name: user.name || account.name,
      renewAutomatically: account.renewAutomatically || false,
      activeJob: account.activeJob,
    };
  });
}
export async function reserveBatch(
  user: Identity,
  input: {
    id: string;
    fingerprint: string;
    variants: number;
    records: number;
    genome: string | null;
    charge: number;
  },
) {
  if (!/^[a-zA-Z0-9_-]{16,80}$/.test(input.id))
    throw new ServiceError(400, "A valid request identifier is required.");
  return database().runTransaction(async (tx) => {
    const now = Date.now();
    const ref = accountRef(user.uid),
      jobRef = ref.collection("jobs").doc(input.id);
    const previous = await tx.get(jobRef);
    if (previous.exists) {
      const job = previous.data() as Batch;
      if (job.fingerprint !== input.fingerprint)
        throw new ServiceError(
          409,
          "This request identifier belongs to a different batch.",
        );
      return { replay: true, job };
    }
    const { account } = await reconcile(tx, user, now);
    if (account.activeJob)
      throw new ServiceError(
        409,
        "Another batch is still processing. Wait for it to finish before starting a new one.",
        "batch_in_progress",
      );
    const deduction = debitWallet(account.wallet, input.charge);
    account.wallet = deduction.wallet;
    account.activeJob = input.id;
    const job: Batch = {
      id: input.id,
      fingerprint: input.fingerprint,
      variants: input.variants,
      records: input.records,
      genome: input.genome,
      status: "pending",
      debit: deduction.debit,
      createdAt: now,
      leaseUntil: now + 5 * 60 * 1000,
    };
    tx.set(ref, account);
    tx.create(jobRef, job);
    tx.create(ref.collection("ledger").doc(`reserve_${input.id}`), {
      kind: "reserve",
      jobId: input.id,
      units: input.charge,
      freeUnits: job.debit.freeUnits,
      paidUnits: job.debit.paidUnits,
      at: now,
    });
    return { replay: false, job };
  });
}
export async function settleBatch(
  uid: string,
  id: string,
  result: { path: string; expiresAt: number } | { failure: string },
) {
  return database().runTransaction(async (tx) => {
    const ref = accountRef(uid),
      jobRef = ref.collection("jobs").doc(id);
    const [accountSnapshot, jobSnapshot] = await Promise.all([
      tx.get(ref),
      tx.get(jobRef),
    ]);
    const account = accountSnapshot.data() as Account,
      job = jobSnapshot.data() as Batch;
    if (!account || !job || job.status !== "pending") return false;
    const now = Date.now();
    account.wallet = normalizeWallet(account.wallet, now);
    if ("failure" in result) {
      account.wallet = refundWallet(account.wallet, job.debit);
      tx.update(jobRef, {
        status: "refunded",
        failure: result.failure,
        completedAt: now,
      });
      tx.set(ref.collection("ledger").doc(`refund_${id}`), {
        kind: "refund",
        jobId: id,
        units: job.debit.totalUnits,
        at: now,
      });
    } else {
      tx.update(jobRef, {
        status: "complete",
        resultPath: result.path,
        resultExpiresAt: result.expiresAt,
        completedAt: now,
      });
      tx.set(ref.collection("ledger").doc(`charge_${id}`), {
        kind: "charge",
        jobId: id,
        units: job.debit.totalUnits,
        at: now,
      });
    }
    if (account.activeJob === id) account.activeJob = null;
    tx.set(ref, account);
    return true;
  });
}
export function fingerprint(uid: string, body: unknown) {
  return createHash("sha256")
    .update(`${uid}:${JSON.stringify(body)}`)
    .digest("hex");
}
export function batchView(job: Batch) {
  return {
    id: job.id,
    variants: job.variants,
    records: job.records,
    genome: job.genome,
    status: job.status,
    credits: credits(job.debit.totalUnits),
    freeCredits: credits(job.debit.freeUnits),
    subscriptionCredits: credits(job.debit.paidUnits),
    createdAt: job.createdAt,
    completedAt: job.completedAt || null,
    resultExpiresAt: job.resultExpiresAt || null,
    failure: job.failure || null,
  };
}
