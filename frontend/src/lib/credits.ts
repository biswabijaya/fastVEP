/** Monetary arithmetic uses integer hundredths of a credit. */
export const UNITS_PER_CREDIT = 100;
export const DAILY_CREDITS = 300;
export const MONTHLY_CREDITS = 4000;
export const CREDITS_PER_USD = 200;
export const BATCH_CREDITS = 0;
export const VARIANTS_PER_CREDIT = 5000;
export function annotationCredits(variantCount: number) {
  if (!Number.isSafeInteger(variantCount) || variantCount < 1)
    throw new ServiceError(400, "Invalid variant count.");
  return Math.ceil(variantCount / VARIANTS_PER_CREDIT);
}
export const MAX_VARIANTS = 1000;
export const RESULT_TTL_MS = 24 * 60 * 60 * 1000;
export type Cadence = "monthly" | "annual";
export class ServiceError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = "request_error",
  ) {
    super(message);
  }
}
export const credits = (units: number) => units / UNITS_PER_CREDIT;
export const units = (creditAmount: number) =>
  Math.round(creditAmount * UNITS_PER_CREDIT);
export const utcDay = (now: number) => new Date(now).toISOString().slice(0, 10);
export function addMonths(anchor: number, months: number) {
  const date = new Date(anchor);
  const first = new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth() + months,
      1,
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds(),
    ),
  );
  const lastDay = new Date(
    Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0),
  ).getUTCDate();
  first.setUTCDate(Math.min(date.getUTCDate(), lastDay));
  return first.getTime();
}
export function inspectVcf(vcf: unknown) {
  if (typeof vcf !== "string" || !vcf.trim())
    throw new ServiceError(400, "Add VCF records before starting a batch.");
  let recordCount = 0,
    variantCount = 0;
  for (const [index, line] of vcf.split(/\r?\n/).entries()) {
    if (!line.trim() || line.startsWith("#")) continue;
    const fields = line.split("\t");
    if (
      fields.length < 8 ||
      !/^[A-Za-z0-9_.:-]+$/.test(fields[0]) ||
      !/^\d+$/.test(fields[1]) ||
      Number(fields[1]) < 1 ||
      Number(fields[1]) > 4294967295 ||
      !/^[ACGTN]+$/i.test(fields[3])
    )
      throw new ServiceError(
        400,
        `Line ${index + 1}: check the eight tab-separated VCF columns, position and reference allele.`,
      );
    const alleles = fields[4].split(",");
    if (
      alleles.length > 256 ||
      alleles.some(
        (a) =>
          !a || /\s/.test(a) || a === "." || a === "<NON_REF>" || a === "<*>",
      )
    )
      throw new ServiceError(
        400,
        `Line ${index + 1}: provide variant alternate alleles rather than gVCF reference blocks.`,
      );
    recordCount++;
    variantCount += alleles.length;
    if (variantCount > MAX_VARIANTS)
      throw new ServiceError(
        400,
        `Each batch supports up to ${MAX_VARIANTS.toLocaleString()} alternate alleles. Split this VCF into smaller batches.`,
      );
  }
  if (!variantCount)
    throw new ServiceError(400, "Add at least one variant record.");
  return { recordCount, variantCount };
}
export function quoteUnits(variantCount: number) {
  if (
    !Number.isSafeInteger(variantCount) ||
    variantCount < 1 ||
    variantCount > MAX_VARIANTS
  )
    throw new ServiceError(400, "Invalid variant count.");
  return units(annotationCredits(variantCount));
}
export type Entitlement = {
  paymentId: string;
  cadence: Cadence;
  termStart: number;
  termEnd: number;
  planId?: string;
  tier?: "research" | "clinical";
  monthlyCredits?: number;
  paidAllocationMonths?: number;
};
export type CreditBucket = { index: number; remainingUnits: number };
export type Wallet = {
  dailyDate: string;
  dailyRemaining: number;
  dailyAllowance?: number;
  paidWindow: string | null;
  paidRemaining: number;
  paidExpiresAt: number | null;
  paidAllocationCount?: number;
  creditBuckets?: CreditBucket[];
  bucketPaymentId?: string;
  entitlement: Entitlement | null;
  queuedEntitlements?: Entitlement[];
};
export function emptyWallet(now: number): Wallet {
  return {
    dailyDate: utcDay(now),
    dailyRemaining: units(DAILY_CREDITS),
    dailyAllowance: units(DAILY_CREDITS),
    paidWindow: null,
    paidRemaining: 0,
    paidExpiresAt: null,
    entitlement: null,
  };
}
export function normalizeWallet(wallet: Wallet, now: number): Wallet {
  const next = { ...wallet };
  if (next.dailyDate !== utcDay(now)) {
    next.dailyDate = utcDay(now);
    next.dailyRemaining = units(DAILY_CREDITS);
    next.dailyAllowance = units(DAILY_CREDITS);
  } else {
    // Existing wallets received 200 credits before the allowance was tracked.
    const previousAllowance = next.dailyAllowance ?? units(200);
    next.dailyRemaining += Math.max(
      0,
      units(DAILY_CREDITS) - previousAllowance,
    );
    next.dailyAllowance = Math.max(previousAllowance, units(DAILY_CREDITS));
  }
  if (!next.entitlement || now >= next.entitlement.termEnd) {
    const queue = [...(next.queuedEntitlements || [])].sort(
      (a, b) => a.termStart - b.termStart,
    );
    const current = queue.find((e) => e.termStart <= now && now < e.termEnd);
    if (current) next.entitlement = current;
    next.queuedEntitlements = queue.filter((e) => e.termStart > now);
  }
  const entitlement = next.entitlement;
  if (
    !entitlement ||
    now < entitlement.termStart ||
    now >= entitlement.termEnd
  ) {
    next.paidWindow = null;
    next.paidRemaining = 0;
    next.paidExpiresAt = null;
    next.paidAllocationCount = 0;
    next.creditBuckets = [];
    next.bucketPaymentId = "";
    return next;
  }
  let offset = 0;
  while (addMonths(entitlement.termStart, offset + 1) <= now && offset < 12)
    offset++;
  const start = addMonths(entitlement.termStart, offset);
  const end = Math.min(
    addMonths(entitlement.termStart, offset + 1),
    entitlement.termEnd,
  );
  const key = `${entitlement.paymentId}:${start}`;
  if (entitlement.cadence === "annual") {
    const sameTerm =
      next.paidWindow?.startsWith(`${entitlement.paymentId}:`) || false;
    // Infer the last issued allocation for wallets written before rollover support.
    let previousCount = 0;
    if (sameTerm) {
      if (next.paidAllocationCount !== undefined)
        previousCount = next.paidAllocationCount;
      else {
        const previousStart = Number(
          next.paidWindow!.slice(entitlement.paymentId.length + 1),
        );
        while (
          previousCount < 12 &&
          addMonths(entitlement.termStart, previousCount) <= previousStart
        )
          previousCount++;
      }
    }
    const issuedCount = offset + 1;
    next.paidRemaining =
      (sameTerm ? next.paidRemaining : 0) +
      units(entitlement.monthlyCredits ?? MONTHLY_CREDITS) *
        Math.max(0, issuedCount - previousCount);
    next.paidAllocationCount = issuedCount;
    // Annual credits share one expiry and refund window for the whole purchased year.
    next.paidWindow = `${entitlement.paymentId}:${entitlement.termStart}`;
    next.paidExpiresAt = entitlement.termEnd;
  } else {
    if (next.paidWindow !== key) {
      next.paidWindow = key;
      next.paidRemaining = units(entitlement.monthlyCredits ?? MONTHLY_CREDITS);
    }
    next.paidAllocationCount = 1;
    next.paidExpiresAt = end;
  }
  const quota = units(entitlement.monthlyCredits ?? MONTHLY_CREDITS);
  const issued = entitlement.cadence === "annual" ? offset + 1 : 1;
  let buckets =
    next.bucketPaymentId === entitlement.paymentId
      ? (next.creditBuckets || []).map((b) => ({ ...b }))
      : [];
  for (let index = buckets.length; index < issued; index++)
    buckets.push({ index, remainingUnits: quota });
  if (
    buckets.reduce((sum, b) => sum + b.remainingUnits, 0) !== next.paidRemaining
  ) {
    // Preserve existing aggregate usage when migrating older wallets to allocation buckets.
    let spent = Math.max(0, quota * issued - next.paidRemaining);
    buckets = Array.from({ length: issued }, (_, index) => {
      const used = Math.min(quota, spent);
      spent -= used;
      return { index, remainingUnits: quota - used };
    });
  }
  next.creditBuckets = buckets;
  next.bucketPaymentId = entitlement.paymentId;
  return next;
}
export type Debit = {
  dailyDate: string;
  paidWindow: string | null;
  freeUnits: number;
  paidUnits: number;
  totalUnits: number;
  buckets?: { index: number; units: number }[];
};
export function debitWallet(
  wallet: Wallet,
  amount: number,
): { wallet: Wallet; debit: Debit } {
  if (!Number.isSafeInteger(amount) || amount <= 0)
    throw new ServiceError(400, "Invalid credit charge.");
  if (wallet.dailyRemaining + wallet.paidRemaining < amount)
    throw new ServiceError(
      402,
      "Not enough credits. Wait for the daily refresh or choose a subscription.",
      "insufficient_credits",
    );
  const freeUnits = Math.min(wallet.dailyRemaining, amount),
    paidUnits = amount - freeUnits;
  let remaining = paidUnits;
  const bucketDebits: { index: number; units: number }[] = [];
  const buckets = wallet.creditBuckets?.map((bucket) => {
    const used = Math.min(bucket.remainingUnits, remaining);
    remaining -= used;
    if (used) bucketDebits.push({ index: bucket.index, units: used });
    return { ...bucket, remainingUnits: bucket.remainingUnits - used };
  });
  return {
    wallet: {
      ...wallet,
      dailyRemaining: wallet.dailyRemaining - freeUnits,
      paidRemaining: wallet.paidRemaining - paidUnits,
      ...(buckets ? { creditBuckets: buckets } : {}),
    },
    debit: {
      dailyDate: wallet.dailyDate,
      paidWindow: wallet.paidWindow,
      freeUnits,
      paidUnits,
      totalUnits: amount,
      buckets: bucketDebits,
    },
  };
}
export function refundWallet(wallet: Wallet, debit: Debit): Wallet {
  const restorePaid =
    !!wallet.paidWindow && wallet.paidWindow === debit.paidWindow;
  const buckets = wallet.creditBuckets?.map((bucket) => ({
    ...bucket,
    remainingUnits:
      bucket.remainingUnits +
      (restorePaid
        ? debit.buckets?.find((b) => b.index === bucket.index)?.units || 0
        : 0),
  }));
  return {
    ...wallet,
    ...(buckets ? { creditBuckets: buckets } : {}),
    dailyRemaining:
      wallet.dailyRemaining +
      (wallet.dailyDate === debit.dailyDate ? debit.freeUnits : 0),
    paidRemaining:
      wallet.paidRemaining +
      (wallet.paidWindow && wallet.paidWindow === debit.paidWindow
        ? debit.paidUnits
        : 0),
  };
}
export function walletView(wallet: Wallet, now: number) {
  const current = normalizeWallet(wallet, now);
  const midnight = new Date(now);
  midnight.setUTCHours(24, 0, 0, 0);
  return {
    dailyCredits: credits(current.dailyRemaining),
    subscriptionCredits: credits(current.paidRemaining),
    totalCredits: credits(current.dailyRemaining + current.paidRemaining),
    dailyRefreshAt: midnight.getTime(),
    subscriptionCreditsExpireAt: current.paidExpiresAt,
    plan: current.paidWindow ? current.entitlement?.tier || "research" : "free",
    planId: current.paidWindow
      ? current.entitlement?.planId || "research-20"
      : null,
    monthlyCreditAllocation: current.paidWindow
      ? (current.entitlement?.monthlyCredits ?? MONTHLY_CREDITS)
      : 0,
    includedServices: {
      clinical:
        !!current.paidWindow && current.entitlement?.tier === "clinical",
      reporting:
        !!current.paidWindow && current.entitlement?.tier === "clinical",
      ai: !!current.paidWindow && current.entitlement?.tier === "clinical",
    },
    cadence: current.entitlement?.cadence || null,
    paidThrough: current.entitlement?.termEnd || null,
  };
}
