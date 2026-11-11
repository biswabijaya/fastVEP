import type { CancellationRecord } from "../lib/refunds";
import { findPlan, type PaidTier } from "../lib/plans";
import { paymentPrice } from "./payment-pricing";
import { randomUUID } from "node:crypto";
import { accountRef, database } from "./admin";
import { newAccount, type Account, type Identity } from "./wallet";
import {
  addMonths,
  normalizeWallet,
  ServiceError,
  type Cadence,
  type Entitlement,
} from "../lib/credits";
import {
  apsConfig,
  canonicalOrigin,
  capturedPayment,
  checkPayment,
  checkoutUrl,
  signedRequest,
  verifySignature,
  type Fields,
} from "./aps";
export type Invoice = {
  id: string;
  uid: string;
  cadence: Cadence;
  planId?: string;
  tier?: PaidTier;
  monthlyCredits?: number;
  paidAllocationMonths?: number;
  cancellation?: CancellationRecord;
  amount: number;
  currency: "USD" | "SAR";
  displayAmount?: number;
  displayCurrency?: "USD";
  status: "pending" | "paid" | "refunded" | "cancelled";
  createdAt: number;
  fortId?: string;
  paidAt?: number;
  termStart?: number;
  termEnd?: number;
};
const invoices = () => database().collection("payments");
export async function prepareCheckout(
  user: Identity,
  cadence: Cadence,
  planId: unknown,
) {
  const plan = findPlan(planId);
  if (!plan)
    throw new ServiceError(400, "Choose a valid plan and credit allowance.");
  const config = await apsConfig();
  const invoice = await database().runTransaction(async (tx) => {
    const ref = accountRef(user.uid),
      snapshot = await tx.get(ref);
    const account = snapshot.exists
      ? (snapshot.data() as Account)
      : newAccount(user, Date.now());
    account.wallet = normalizeWallet(account.wallet, Date.now());
    if (account.wallet.paidWindow)
      throw new ServiceError(
        409,
        "Your paid term is active. Renew after it expires; no payment was taken.",
      );
    if (account.pendingInvoice) {
      const prior = await tx.get(invoices().doc(account.pendingInvoice));
      const previous = prior.data() as Invoice | undefined;
      if (
        previous?.status === "pending" &&
        previous.cadence === cadence &&
        previous.currency === "SAR" &&
        previous.planId === plan.id &&
        previous.displayAmount === paymentPrice(cadence, plan.id).displayAmount
      )
        return previous;
      if (
        previous?.status === "pending" &&
        Date.now() - previous.createdAt < 60000
      )
        throw new ServiceError(
          429,
          "Wait one minute before changing your payment term.",
        );
    }
    const id = `fv-${randomUUID().replaceAll("-", "")}`,
      invoice: Invoice = {
        id,
        uid: user.uid,
        cadence,
        planId: plan.id,
        tier: plan.tier,
        monthlyCredits: plan.monthlyCredits,
        paidAllocationMonths: cadence === "annual" ? 10 : 1,
        ...paymentPrice(cadence, plan.id),
        status: "pending",
        createdAt: Date.now(),
      };
    account.pendingInvoice = id;
    tx.create(invoices().doc(id), invoice);
    tx.set(ref.collection("payments").doc(id), invoice);
    tx.set(ref, account);
    return invoice;
  });
  return {
    url: checkoutUrl(),
    invoiceId: invoice.id,
    fields: signedRequest(
      {
        command: "PURCHASE",
        merchant_reference: invoice.id,
        amount: String(invoice.amount),
        currency: invoice.currency,
        customer_email: user.email,
        return_url: `${canonicalOrigin}/api/billing/callback`,
        order_description: `VEP ${plan.name} ${plan.monthlyCredits} credits monthly - ${cadence} manual renewal`,
      },
      config,
    ),
  };
}
/** Internal accounting: callers must verify APS status before attributing a capture. */
export async function applyCapturedInvoice(
  id: string,
  fortId: string,
  now = Date.now(),
) {
  return database().runTransaction(async (tx) => {
    const invoiceRef = invoices().doc(id),
      snapshot = await tx.get(invoiceRef);
    if (!snapshot.exists)
      throw new ServiceError(404, "Payment reference not found.");
    const invoice = snapshot.data() as Invoice;
    const ref = accountRef(invoice.uid),
      accountSnapshot = await tx.get(ref);
    const account = accountSnapshot.data() as Account;
    const captureRef = database().collection("paymentCaptures").doc(fortId);
    const capture = await tx.get(captureRef);
    if (invoice.status === "paid" || invoice.status === "cancelled") {
      if (invoice.fortId !== fortId)
        throw new ServiceError(409, "Payment reference conflict.");
      return false;
    }
    if (invoice.status === "refunded" || !account)
      throw new ServiceError(409, "Payment requires reconciliation.");
    if (capture.exists)
      throw new ServiceError(
        409,
        "This captured payment has already been assigned.",
      );
    account.wallet = normalizeWallet(account.wallet, now);
    const future = account.wallet.queuedEntitlements || [];
    const start = Math.max(
      now,
      account.wallet.entitlement?.termEnd || 0,
      ...future.map((e) => e.termEnd),
    );
    const entitlement: Entitlement = {
      paymentId: id,
      cadence: invoice.cadence,
      termStart: start,
      termEnd: addMonths(start, invoice.cadence === "annual" ? 12 : 1),
      planId: invoice.planId || "research-20",
      tier: invoice.tier || "research",
      monthlyCredits: invoice.monthlyCredits ?? 4000,
      paidAllocationMonths:
        invoice.paidAllocationMonths ??
        Math.min(
          invoice.cadence === "annual" ? 12 : 1,
          Math.round(
            ((invoice.displayAmount ??
              (invoice.currency === "USD"
                ? invoice.amount
                : (invoice.amount * 4) / 15)) *
              2) /
              (invoice.monthlyCredits ?? 4000),
          ),
        ),
    };
    if (start > now)
      account.wallet.queuedEntitlements = [...future, entitlement];
    else account.wallet.entitlement = entitlement;
    account.wallet = normalizeWallet(account.wallet, now);
    if (account.pendingInvoice === id) delete account.pendingInvoice;
    const paid = {
      status: "paid",
      fortId,
      paidAt: now,
      termStart: start,
      termEnd: entitlement.termEnd,
    };
    tx.update(invoiceRef, paid);
    tx.set(ref.collection("payments").doc(id), { ...invoice, ...paid });
    tx.create(captureRef, { invoiceId: id, uid: invoice.uid, at: now });
    tx.set(ref, account);
    tx.create(ref.collection("ledger").doc(`payment_${id}`), {
      kind: "subscription",
      planId: entitlement.planId,
      tier: entitlement.tier,
      monthlyCredits: entitlement.monthlyCredits,
      paymentId: id,
      cadence: invoice.cadence,
      amount: invoice.amount,
      currency: invoice.currency,
      termStart: start,
      termEnd: entitlement.termEnd,
      at: now,
    });
    return true;
  });
}
async function revokeRefundedInvoice(id: string) {
  return database().runTransaction(async (tx) => {
    const invoiceRef = invoices().doc(id),
      snapshot = await tx.get(invoiceRef);
    if (!snapshot.exists) return;
    const invoice = snapshot.data() as Invoice;
    const ref = accountRef(invoice.uid),
      accountSnapshot = await tx.get(ref);
    const account = accountSnapshot.data() as Account;
    if (invoice.status !== "paid" || !account) return;
    if (account.wallet.entitlement?.paymentId === id)
      account.wallet.entitlement = null;
    account.wallet.queuedEntitlements = (
      account.wallet.queuedEntitlements || []
    ).filter((e) => e.paymentId !== id);
    account.wallet = normalizeWallet(account.wallet, Date.now());
    tx.set(ref, account);
    tx.update(invoiceRef, { status: "refunded" });
    tx.set(ref.collection("payments").doc(id), {
      ...invoice,
      status: "refunded",
    });
    tx.set(ref.collection("ledger").doc(`revoke_${id}`), {
      kind: "subscription_revoked",
      paymentId: id,
      at: Date.now(),
    });
  });
}
export async function confirmPayment(fields: Fields) {
  const config = await apsConfig();
  if (!verifySignature(fields, config.responsePhrase))
    throw new ServiceError(400, "Payment signature is invalid.");
  if (
    fields.merchant_identifier !== config.merchant ||
    !["PURCHASE", "REFUND"].includes(fields.command) ||
    !/^fv-[a-f0-9]{32}$/.test(fields.merchant_reference || "")
  )
    throw new ServiceError(
      400,
      "Payment response does not match this service.",
    );
  const snapshot = await invoices().doc(fields.merchant_reference).get();
  if (!snapshot.exists)
    throw new ServiceError(404, "Payment reference not found.");
  const invoice = snapshot.data() as Invoice;
  if (invoice.status === "cancelled") {
    const { reconcileCancellation } = await import("./cancellations");
    const result = await reconcileCancellation(invoice.id);
    return result.status === "complete"
      ? "cancelled"
      : result.status === "review"
        ? "refund_review"
        : "refund_pending";
  }
  if (
    fields.currency !== invoice.currency ||
    !/^\d+$/.test(fields.amount || "") ||
    (fields.command === "PURCHASE" && Number(fields.amount) !== invoice.amount)
  )
    throw new ServiceError(400, "Payment amount or currency does not match.");
  const check = await checkPayment(invoice.id, config);
  if (Number(check.refunded_amount || 0) > 0) {
    await revokeRefundedInvoice(invoice.id);
    return "refunded";
  }
  if (fields.command !== "PURCHASE" || !capturedPayment(check, invoice.amount))
    return "pending";
  if (check.fort_id !== fields.fort_id)
    throw new ServiceError(400, "Payment transaction does not match.");
  await applyCapturedInvoice(invoice.id, check.fort_id);
  return "paid";
}

export async function reconcileInvoice(user: Identity, id: string) {
  if (!/^fv-[a-f0-9]{32}$/.test(id))
    throw new ServiceError(404, "Payment not found.");
  const snapshot = await invoices().doc(id).get();
  const invoice = snapshot.data() as Invoice | undefined;
  if (!invoice || invoice.uid !== user.uid)
    throw new ServiceError(404, "Payment not found.");
  if (invoice.status === "cancelled") {
    const { reconcileCancellation } = await import("./cancellations");
    const result = await reconcileCancellation(id);
    return result.status === "complete"
      ? "cancelled"
      : result.status === "review"
        ? "refund_review"
        : "refund_pending";
  }
  const config = await apsConfig(),
    check = await checkPayment(id, config);
  if (Number(check.refunded_amount || 0) > 0) {
    await revokeRefundedInvoice(id);
    return "refunded";
  }
  if (check.currency && check.currency !== invoice.currency)
    throw new ServiceError(400, "Payment currency does not match.");
  if (capturedPayment(check, invoice.amount)) {
    await applyCapturedInvoice(id, check.fort_id);
    return "paid";
  }
  return "pending";
}
