/** Monetary arithmetic uses integer hundredths of a credit. */
export const UNITS_PER_CREDIT = 100;
export const DAILY_CREDITS = 200;
export const MONTHLY_CREDITS = 4000;
export const CREDITS_PER_USD = 200;
export const BATCH_CREDITS = 150;
export const VARIANT_UNITS = 1;
export const MAX_VARIANTS = 1000;
export const RESULT_TTL_MS = 24 * 60 * 60 * 1000;
export type Cadence = "monthly" | "annual";
export const PLANS = {
  monthly: { dollars: 20, months: 1, monthlyCredits: MONTHLY_CREDITS },
  annual: { dollars: 240, months: 12, monthlyCredits: MONTHLY_CREDITS },
} as const;
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
  return units(BATCH_CREDITS) + variantCount * VARIANT_UNITS;
}
export type Entitlement = {
  paymentId: string;
  cadence: Cadence;
  termStart: number;
  termEnd: number;
};
export type Wallet = {
  dailyDate: string;
  dailyRemaining: number;
  paidWindow: string | null;
  paidRemaining: number;
  paidExpiresAt: number | null;
  entitlement: Entitlement | null;
  queuedEntitlements?: Entitlement[];
};
export function emptyWallet(now: number): Wallet {
  return {
    dailyDate: utcDay(now),
    dailyRemaining: units(DAILY_CREDITS),
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
  if (next.paidWindow !== key) {
    next.paidWindow = key;
    next.paidRemaining = units(MONTHLY_CREDITS);
  }
  next.paidExpiresAt = end;
  return next;
}
export type Debit = {
  dailyDate: string;
  paidWindow: string | null;
  freeUnits: number;
  paidUnits: number;
  totalUnits: number;
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
  return {
    wallet: {
      ...wallet,
      dailyRemaining: wallet.dailyRemaining - freeUnits,
      paidRemaining: wallet.paidRemaining - paidUnits,
    },
    debit: {
      dailyDate: wallet.dailyDate,
      paidWindow: wallet.paidWindow,
      freeUnits,
      paidUnits,
      totalUnits: amount,
    },
  };
}
export function refundWallet(wallet: Wallet, debit: Debit): Wallet {
  return {
    ...wallet,
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
    plan: current.paidWindow ? "pro" : "free",
    cadence: current.entitlement?.cadence || null,
    paidThrough: current.entitlement?.termEnd || null,
  };
}
