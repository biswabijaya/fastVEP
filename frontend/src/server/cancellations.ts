import { accountRef, database } from "./admin";
import { type Account, type Identity, getAccount } from "./wallet";
import { type Invoice } from "./payments";
import { cancellationQuote, type CancellationRecord } from "../lib/refunds";
import { normalizeWallet, ServiceError } from "../lib/credits";
import {
  apsConfig,
  capturedPayment,
  checkPayment,
  refundPayment,
  type Fields,
} from "./aps";
const payments = () => database().collection("payments");
export type RefundGateway = {
  check: (invoice: Invoice) => Promise<Fields>;
  refund: (invoice: Invoice, cancellation: CancellationRecord) => Promise<void>;
};
const gateway: RefundGateway = {
  check: async (invoice) => checkPayment(invoice.id, await apsConfig()),
  refund: async (invoice, record) =>
    refundPayment(
      invoice.id,
      invoice.fortId!,
      record.amount,
      record.currency,
      record.maintenanceReference,
      await apsConfig(),
    ),
};
function validId(id: string) {
  if (!/^fv-[a-f0-9]{32}$/.test(id))
    throw new ServiceError(404, "Payment not found.");
}
async function ownedInvoice(user: Identity, id: string) {
  validId(id);
  const snapshot = await payments().doc(id).get();
  const invoice = snapshot.data() as Invoice | undefined;
  if (!invoice || invoice.uid !== user.uid)
    throw new ServiceError(404, "Payment not found.");
  return invoice;
}
export async function getCancellationQuote(user: Identity, id: string) {
  const invoice = await ownedInvoice(user, id);
  if (invoice.status === "cancelled")
    return { alreadyCancelled: true, cancellation: invoice.cancellation };
  if (invoice.status !== "paid")
    throw new ServiceError(
      409,
      "Only a confirmed paid subscription can be cancelled.",
    );
  await getAccount(user);
  const snapshot = await accountRef(user.uid).get();
  const account = snapshot.data() as Account;
  if (account.activeJob)
    throw new ServiceError(
      409,
      "Wait for your annotation batch to finish before cancelling.",
    );
  return {
    alreadyCancelled: false,
    id,
    ...cancellationQuote(account.wallet, invoice, Date.now()),
  };
}
export async function prepareCancellation(
  user: Identity,
  id: string,
  expectedUsdCents: number,
) {
  validId(id);
  return database().runTransaction(async (tx) => {
    const invoiceRef = payments().doc(id),
      snapshot = await tx.get(invoiceRef);
    const invoice = snapshot.data() as Invoice | undefined;
    if (!invoice || invoice.uid !== user.uid)
      throw new ServiceError(404, "Payment not found.");
    const ref = accountRef(user.uid),
      accountSnapshot = await tx.get(ref);
    const account = accountSnapshot.data() as Account;
    if (invoice.status === "cancelled" && invoice.cancellation)
      return invoice.cancellation;
    if (invoice.status !== "paid" || !account)
      throw new ServiceError(409, "This subscription cannot be cancelled.");
    if (account.activeJob)
      throw new ServiceError(
        409,
        "Wait for your annotation batch to finish before cancelling.",
      );
    const now = Date.now(),
      quote = cancellationQuote(account.wallet, invoice, now);
    if (quote.usdCents !== expectedUsdCents)
      throw new ServiceError(
        409,
        "Your refund amount changed. Review the updated quote before confirming.",
        "refund_quote_changed",
      );
    const record: CancellationRecord = {
      at: now,
      refundableCredits: quote.refundableCredits,
      usdCents: quote.usdCents,
      amount: quote.settlementAmount,
      currency: quote.currency,
      maintenanceReference: `rv-${id.slice(3)}`,
      status: quote.usdCents ? "pending" : "complete",
      ...(quote.usdCents ? {} : { confirmedAt: now }),
    };
    if (account.wallet.entitlement?.paymentId === id)
      account.wallet.entitlement = null;
    account.wallet.queuedEntitlements = (
      account.wallet.queuedEntitlements || []
    ).filter((e) => e.paymentId !== id);
    account.wallet = normalizeWallet(account.wallet, now);
    tx.set(ref, account);
    tx.update(invoiceRef, { status: "cancelled", cancellation: record });
    tx.set(ref.collection("payments").doc(id), {
      ...invoice,
      status: "cancelled",
      cancellation: record,
    });
    tx.create(ref.collection("ledger").doc(`cancel_${id}`), {
      kind: "cancellation",
      paymentId: id,
      refundUsdCents: record.usdCents,
      refundableCredits: record.refundableCredits,
      excludedRolloverCredits: quote.excludedRolloverCredits,
      at: now,
    });
    return record;
  });
}
async function claimRefund(id: string) {
  return database().runTransaction(async (tx) => {
    const ref = payments().doc(id),
      snapshot = await tx.get(ref),
      invoice = snapshot.data() as Invoice;
    if (!invoice.cancellation || invoice.cancellation.status !== "pending")
      return false;
    const cancellation = {
      ...invoice.cancellation,
      status: "processing" as const,
    };
    tx.update(ref, { cancellation });
    tx.update(accountRef(invoice.uid).collection("payments").doc(id), {
      cancellation,
    });
    return true;
  });
}
async function updateRefund(id: string, status: CancellationRecord["status"]) {
  return database().runTransaction(async (tx) => {
    const ref = payments().doc(id),
      snapshot = await tx.get(ref),
      invoice = snapshot.data() as Invoice;
    if (!invoice.cancellation) return;
    if (invoice.cancellation.status === "complete") return;
    const cancellation = {
      ...invoice.cancellation,
      status,
      ...(status === "complete" ? { confirmedAt: Date.now() } : {}),
    };
    tx.update(ref, { cancellation });
    tx.update(accountRef(invoice.uid).collection("payments").doc(id), {
      cancellation,
    });
    if (status === "complete")
      tx.set(
        accountRef(invoice.uid).collection("ledger").doc(`cash_refund_${id}`),
        {
          kind: "payment_refund",
          paymentId: id,
          usdCents: cancellation.usdCents,
          amount: cancellation.amount,
          currency: cancellation.currency,
          at: Date.now(),
        },
      );
  });
}
export async function reconcileCancellation(
  id: string,
  provider: RefundGateway = gateway,
) {
  const snapshot = await payments().doc(id).get(),
    invoice = snapshot.data() as Invoice | undefined;
  if (!invoice?.cancellation)
    throw new ServiceError(404, "Cancellation not found.");
  if (invoice.cancellation.status !== "complete") {
    const check = await provider.check(invoice);
    if (
      check.response_code === "12000" &&
      check.fort_id === invoice.fortId &&
      /^\d+$/.test(check.refunded_amount || "") &&
      Number(check.refunded_amount) >= invoice.cancellation.amount
    )
      await updateRefund(id, "complete");
  }
  const latest = (await payments().doc(id).get()).data() as Invoice;
  return latest.cancellation!;
}
export async function cancelSubscription(
  user: Identity,
  id: string,
  expectedUsdCents: number,
  provider: RefundGateway = gateway,
) {
  let invoice = await ownedInvoice(user, id);
  if (invoice.status !== "cancelled") {
    const check = await provider.check(invoice);
    if (
      !capturedPayment(check, invoice.amount) ||
      check.fort_id !== invoice.fortId ||
      (check.currency && check.currency !== invoice.currency)
    ) {
      // Another concurrent request may have completed cancellation while this check was in flight.
      invoice = await ownedInvoice(user, id);
      if (invoice.status !== "cancelled")
        throw new ServiceError(
          409,
          "The original payment must be confirmed before cancellation. Check payment status and try again.",
        );
    } else await prepareCancellation(user, id, expectedUsdCents);
  }
  invoice = (await payments().doc(id).get()).data() as Invoice;
  if (invoice.cancellation?.status === "pending" && (await claimRefund(id))) {
    try {
      await provider.refund(invoice, invoice.cancellation);
    } catch {
      console.error("vep_refund_review_required", { paymentId: id });
      await updateRefund(id, "review");
    }
  }
  // Once submitted, retries only check provider state; they never send another refund.
  try {
    return await reconcileCancellation(id, provider);
  } catch {
    return ((await payments().doc(id).get()).data() as Invoice).cancellation!;
  }
}
