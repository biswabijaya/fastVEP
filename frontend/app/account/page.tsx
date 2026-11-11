"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "../../src/components/Session";
type Payment = {
  id: string;
  cadence: string;
  amount: number;
  currency: string;
  status: string;
  createdAt: number;
  termEnd: number | null;
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
      a.download = `fastvep-${id}.json`;
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
          <strong>{account?.plan === "pro" ? "Pro" : "Free"}</strong>
          <small>
            {account?.paidThrough
              ? `Paid through ${new Date(account.paidThrough).toLocaleDateString()} · manual renewal`
              : "Daily credits included"}
          </small>
        </div>
      </div>
      {(message || error) && (
        <p className="notice" role="status">
          {message || error}
        </p>
      )}
      <section className="panel">
        <h2>Subscription payments</h2>
        <p>
          Each purchase covers one term. Annual terms release credits monthly.
          Renew manually after your term expires.
        </p>
        {payments.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
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
                    <td>{p.cadence}</td>
                    <td>
                      ${(p.amount / 100).toFixed(2)} {p.currency}
                    </td>
                    <td>{p.status}</td>
                    <td>
                      <button
                        className="quiet"
                        onClick={() => checkPayment(p.id)}
                      >
                        Check payment
                      </button>
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
