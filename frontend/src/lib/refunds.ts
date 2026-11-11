import {
  addMonths,
  credits,
  MONTHLY_CREDITS,
  normalizeWallet,
  ServiceError,
  units,
  type Cadence,
  type Wallet,
} from "./credits";
export type RefundInvoice = {
  id: string;
  cadence: Cadence;
  amount: number;
  currency: "USD" | "SAR";
  displayAmount?: number;
  monthlyCredits?: number;
  paidAllocationMonths?: number;
  termStart?: number;
  termEnd?: number;
};
export type CancellationRecord = {
  at: number;
  refundableCredits: number;
  usdCents: number;
  amount: number;
  currency: "USD" | "SAR";
  maintenanceReference: string;
  status: "pending" | "processing" | "complete" | "review";
  confirmedAt?: number;
};
export function cancellationQuote(
  wallet: Wallet,
  invoice: RefundInvoice,
  now: number,
) {
  const current = normalizeWallet(wallet, now);
  const entitlement =
    current.entitlement?.paymentId === invoice.id
      ? current.entitlement
      : current.queuedEntitlements?.find((e) => e.paymentId === invoice.id);
  const dollarsCents =
    invoice.displayAmount ??
    (invoice.currency === "USD"
      ? invoice.amount
      : Math.round((invoice.amount * 4) / 15));
  const quota =
    invoice.monthlyCredits ?? entitlement?.monthlyCredits ?? MONTHLY_CREDITS;
  const paidMonths =
    invoice.paidAllocationMonths ??
    entitlement?.paidAllocationMonths ??
    Math.min(
      invoice.cadence === "annual" ? 12 : 1,
      Math.round((dollarsCents * 2) / quota),
    );
  const start = invoice.termStart ?? entitlement?.termStart,
    end = invoice.termEnd ?? entitlement?.termEnd;
  let index = -1,
    currentUnits = 0,
    rolloverUnits = 0,
    futureMonths = 0;
  if (entitlement && start !== undefined && end !== undefined && now < end) {
    if (now >= start) {
      index = 0;
      while (index < 11 && addMonths(start, index + 1) <= now) index++;
    }
    const buckets =
      current.bucketPaymentId === invoice.id ? current.creditBuckets || [] : [];
    if (index >= 0 && index < paidMonths)
      currentUnits =
        buckets.find((b) => b.index === index)?.remainingUnits || 0;
    rolloverUnits = buckets
      .filter((b) => b.index < index)
      .reduce((sum, b) => sum + b.remainingUnits, 0);
    futureMonths = Math.max(0, paidMonths - (index + 1));
  }
  const eligibleUnits = currentUnits + futureMonths * units(quota);
  const blocks = Math.min(
    Math.floor(eligibleUnits / units(100)),
    Math.floor(dollarsCents / 50),
  );
  const usdCents = blocks * 50;
  const settlementAmount = Math.min(
    invoice.amount,
    Math.round((usdCents * invoice.amount) / Math.max(1, dollarsCents)),
  );
  return {
    currentPaidCredits: credits(currentUnits),
    futurePaidCredits: futureMonths * quota,
    excludedRolloverCredits: credits(rolloverUnits),
    refundableCredits: blocks * 100,
    usdCents,
    refundDollars: usdCents / 100,
    settlementAmount,
    currency: invoice.currency,
  };
}
export function assertCancellationAmount(value: unknown) {
  if (!Number.isSafeInteger(value) || Number(value) < 0)
    throw new ServiceError(
      400,
      "Review the refund amount before confirming cancellation.",
    );
  return Number(value);
}
