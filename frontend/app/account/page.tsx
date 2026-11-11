"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { INCLUDED_CLINICAL_SERVICES } from "../../src/lib/plans";
import { useSession } from "../../src/components/Session";
type Payment = {
  id: string;
  cadence: string;
  tier: string;
  monthlyCredits: number;
  amount: number;
  currency: string;
  status: string;
  createdAt: number;
  termEnd: number | null;
  cancellation?: {
    status: string;
    refundDollars: number;
    refundableCredits: number;
  } | null;
};
type Job = {
  id: string;
  status: string;
  variants: number;
  credits: number;
  freeCredits: number;
  subscriptionCredits: number;
  createdAt: number;
  resultExpiresAt: number | null;
  failure: string | null;
};
export default function Usage() {
  const { user, loading, account, api, refresh, error } = useSession();
  const [payments, setPayments] = useState<Payment[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]),
    [message, setMessage] = useState("");
  const [cancelQuote, setCancelQuote] = useState<{
    id: string;
    currentPaidCredits: number;
    futurePaidCredits: number;
    excludedRolloverCredits: number;
    refundableCredits: number;
    usdCents: number;
    refundDollars: number;
  } | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  useEffect(() => {
    if (user?.emailVerified)
      api("/api/account")
        .then(async (r) => {
          const d = await r.json();
          if (!r.ok) throw new Error(d.error);
          setJobs(d.jobs);
          setPayments(d.payments || []);
        })
        .catch((e) => setMessage(e.message));
  }, [user, api]);
  async function reviewCancellation(id: string) {
    setCancelBusy(true);
    setMessage("");
    try {
      const r = await api(`/api/billing/cancel?id=${encodeURIComponent(id)}`);
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      if (data.alreadyCancelled) {
        setMessage("This subscription has already been cancelled.");
        return;
      }
      setCancelQuote(data);
    } catch (e) {
      setMessage(
        e instanceof Error ? e.message : "Unable to calculate the refund.",
      );
    } finally {
      setCancelBusy(false);
    }
  }
  async function confirmCancellation() {
    if (!cancelQuote) return;
    setCancelBusy(true);
    try {
      const r = await api("/api/billing/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: cancelQuote.id,
          expectedUsdCents: cancelQuote.usdCents,
          confirm: true,
        }),
      });
      const data = await r.json();
      if (!r.ok) {
        if (data.code === "refund_quote_changed")
          await reviewCancellation(cancelQuote.id);
        throw new Error(data.error);
      }
      setMessage(
        data.cancellation.status === "complete"
          ? `Subscription cancelled. Refund confirmed: $${(data.cancellation.usdCents / 100).toFixed(2)}.`
          : data.cancellation.status === "review"
            ? "Subscription cancelled. Your refund requires payment review and has not yet been confirmed."
            : "Subscription cancelled. Your refund is awaiting payment-provider confirmation. Use Check payment to refresh its status.",
      );
      setCancelQuote(null);
      const latest = await api("/api/account").then((r) => r.json());
      setPayments(latest.payments || []);
      await refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Unable to cancel.");
    } finally {
      setCancelBusy(false);
    }
  }
  async function checkPayment(id: string) {
    try {
      const r = await api("/api/billing/reconcile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setMessage(
        d.status === "paid"
          ? "Payment confirmed. Refresh to see your subscription credits."
          : d.status === "cancelled"
            ? "Cancellation refund confirmed. Refresh to see the latest payment details."
            : d.status === "refund_review"
              ? "Your cancellation refund requires payment review. No refund has been confirmed yet."
              : d.status === "refund_pending"
                ? "Cancellation confirmed. The payment provider has not confirmed the refund yet."
                : "Payment is not confirmed yet. No credits have been granted.",
      );
      await refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Unable to check payment.");
    }
  }
  async function download(id: string) {
    try {
      const r = await api(`/api/jobs/${id}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      if (!d.results)
        throw new Error("This batch is still processing. Refresh shortly.");
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(d, null, 2)], { type: "application/json" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = `vep-${id}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Unable to download.");
    }
  }
  if (loading) return <p>Loading account…</p>;
  if (!user?.emailVerified)
    return (
      <section className="panel">
        <h1>Your usage, in one place</h1>
        <p>Sign in with a verified email to view credits and results.</p>
        <Link className="button primary" href="/login">
          Sign in →
        </Link>
      </section>
    );
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">YOUR ACCOUNT</span>
          <h1>Credits & usage</h1>
          <p>{user.email}</p>
        </div>
        <Link className="button secondary" href="/pricing">
          View plans →
        </Link>
      </div>
      <div className="wallet-strip">
        <div>
          <span>Daily free</span>
          <strong>{account?.dailyCredits ?? "—"}</strong>
          <small>Refreshes at 00:00 UTC</small>
        </div>
        <div>
          <span>Subscription</span>
          <strong>{account?.subscriptionCredits ?? "—"}</strong>
          <small>
            {account?.subscriptionCreditsExpireAt
              ? `Expires ${new Date(account.subscriptionCreditsExpireAt).toLocaleString()}`
              : "No active subscription"}
          </small>
        </div>
        <div>
          <span>Current plan</span>
          <strong>
            {account?.plan === "clinical"
              ? "Clinical"
              : account?.plan === "research"
                ? "Research"
                : "Free"}
          </strong>
          <small>
            {account?.paidThrough
              ? `Paid through ${new Date(account.paidThrough).toLocaleDateString()} · manual renewal`
              : "Daily credits included"}
          </small>
        </div>
      </div>
      {account?.plan !== "free" && account?.monthlyCreditAllocation ? (
        <p className="allocation-note">
          {account.monthlyCreditAllocation.toLocaleString()} subscription
          credits released monthly.
        </p>
      ) : null}
      {account?.includedServices?.clinical && (
        <section className="panel included-services">
          <h2>Included with Clinical</h2>
          <p>
            No additional subscription charge for these services during your
            paid term.
          </p>
          <div className="included-links">
            <a
              href={INCLUDED_CLINICAL_SERVICES.clinical}
              target="_blank"
              rel="noreferrer"
            >
              Enigma Clinical ↗
            </a>
            <a
              href={INCLUDED_CLINICAL_SERVICES.reporting}
              target="_blank"
              rel="noreferrer"
            >
              Enigma Reporting ↗
            </a>
            <span>AI included</span>
          </div>
        </section>
      )}
      {(message || error) && (
        <p className="notice" role="status">
          {message || error}
        </p>
      )}
      <section className="panel">
        <h2>Subscription payments</h2>
        <p>
          Each purchase covers one term. Annual terms release credits monthly;
          unused credits roll over until the annual term ends. Renew manually
          after your term expires. You can cancel anytime and request an
          eligible paid-credit refund.
        </p>
        {cancelQuote && (
          <div
            className="cancel-review"
            role="region"
            aria-label="Review cancellation"
          >
            <h3>Cancel subscription & review refund</h3>
            <dl>
              <div>
                <dt>Unused current paid allocation</dt>
                <dd>
                  {cancelQuote.currentPaidCredits.toLocaleString()} credits
                </dd>
              </div>
              <div>
                <dt>Future paid allocations</dt>
                <dd>
                  {cancelQuote.futurePaidCredits.toLocaleString()} credits
                </dd>
              </div>
              <div>
                <dt>Rollover credits excluded</dt>
                <dd>
                  {cancelQuote.excludedRolloverCredits.toLocaleString()} credits
                </dd>
              </div>
              <div>
                <dt>Refundable credits, rounded down</dt>
                <dd>
                  {cancelQuote.refundableCredits.toLocaleString()} credits
                </dd>
              </div>
              <div>
                <dt>Refund to original payment method</dt>
                <dd>${cancelQuote.refundDollars.toFixed(2)}</dd>
              </div>
            </dl>
            <p>
              Refunds use complete blocks of 100 eligible credits at $0.50 per
              block, capped at the payment. Daily free, promotional and
              rolled-over credits are excluded. Cancelling ends this paid term
              and its remaining credits immediately. Daily free credits
              continue.
            </p>
            <div className="cancel-actions">
              <button
                className="danger-button"
                disabled={cancelBusy}
                onClick={confirmCancellation}
              >
                {cancelBusy
                  ? "Cancelling…"
                  : `Confirm cancellation · $${cancelQuote.refundDollars.toFixed(2)} refund`}
              </button>
              <button
                className="quiet"
                disabled={cancelBusy}
                onClick={() => setCancelQuote(null)}
              >
                Keep subscription
              </button>
            </div>
          </div>
        )}
        {payments.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Plan</th>
                  <th>Term</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Confirmation</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td>{new Date(p.createdAt).toLocaleString()}</td>
                    <td>
                      {p.tier === "clinical" ? "Clinical" : "Research"}
                      <small>
                        {p.monthlyCredits?.toLocaleString()} credits/month
                      </small>
                    </td>
                    <td>{p.cadence}</td>
                    <td>
                      ${(p.amount / 100).toFixed(2)} {p.currency}
                    </td>
                    <td>
                      {p.status}
                      {p.cancellation && (
                        <small>
                          ${p.cancellation.refundDollars.toFixed(2)} refund ·{" "}
                          {p.cancellation.status}
                        </small>
                      )}
                    </td>
                    <td>
                      <button
                        className="quiet"
                        onClick={() => checkPayment(p.id)}
                      >
                        Check payment
                      </button>
                      {p.status === "paid" && (
                        <button
                          className="quiet cancel-link"
                          disabled={cancelBusy}
                          onClick={() => reviewCancellation(p.id)}
                        >
                          Cancel & refund
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>No subscription payments yet.</p>
        )}
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Recent annotation batches</h2>
            <p>Private downloads expire 24 hours after completion.</p>
          </div>
          <button
            className="quiet"
            onClick={() => {
              void refresh();
              window.location.reload();
            }}
          >
            Refresh
          </button>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Submitted</th>
                <th>Variants</th>
                <th>Credits</th>
                <th>Daily / subscription</th>
                <th>Status</th>
                <th>Results</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id}>
                  <td>{new Date(j.createdAt).toLocaleString()}</td>
                  <td>{j.variants.toLocaleString()}</td>
                  <td>{j.credits}</td>
                  <td>
                    {j.freeCredits} / {j.subscriptionCredits}
                  </td>
                  <td>
                    <span className="badge">{j.status}</span>
                    {j.failure && <small>{j.failure}</small>}
                  </td>
                  <td>
                    {j.status === "complete" &&
                    j.resultExpiresAt &&
                    j.resultExpiresAt > Date.now() ? (
                      <button className="quiet" onClick={() => download(j.id)}>
                        Download JSON ↓
                      </button>
                    ) : j.status === "complete" ? (
                      "Expired"
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!jobs.length && (
          <div className="empty">
            <h3>No batches yet</h3>
            <p>Your annotation history will appear here.</p>
            <Link href="/">Start annotating →</Link>
          </div>
        )}
      </section>
    </>
  );
}
