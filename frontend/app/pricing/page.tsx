"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "../../src/components/Session";
export default function Pricing() {
  const [annual, setAnnual] = useState(false),
    [count, setCount] = useState(1000),
    [message, setMessage] = useState(""),
    [accept, setAccept] = useState(false),
    [enabled, setEnabled] = useState(false);
  useEffect(() => {
    fetch("/api/billing/status")
      .then((r) => r.json())
      .then((d) => setEnabled(d.enabled))
      .catch(() => {});
  }, []);
  const { user, api } = useSession();
  async function subscribe() {
    try {
      const r = await api("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cadence: annual ? "annual" : "monthly",
          acceptTerm: accept,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Unable to open checkout.");
      const allowed = [
        "https://checkout.payfort.com/FortAPI/paymentPage",
        "https://sbcheckout.payfort.com/FortAPI/paymentPage",
      ];
      if (!allowed.includes(d.url))
        throw new Error("Invalid checkout destination.");
      const form = document.createElement("form");
      form.method = "POST";
      form.action = d.url;
      for (const [name, value] of Object.entries(d.fields)) {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = name;
        input.value = String(value);
        form.appendChild(input);
      }
      document.body.appendChild(form);
      form.submit();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Unable to open checkout.");
    }
  }
  return (
    <>
      <div className="pricing-heading">
        <span className="eyebrow">SIMPLE, TRANSPARENT PRICING</span>
        <h1>Choose your annotation plan</h1>
        <p>Start with daily free credits. Subscribe when you need more.</p>
        <div className="segmented" aria-label="Billing period">
          <button
            aria-pressed={!annual}
            onClick={() => {
              setAnnual(false);
              setAccept(false);
            }}
          >
            Monthly
          </button>
          <button
            aria-pressed={annual}
            onClick={() => {
              setAnnual(true);
              setAccept(false);
            }}
          >
            Annually
          </button>
        </div>
      </div>
      <div className="plans">
        <section className="panel plan">
          <span className="eyebrow">FOR EVERYDAY EXPLORATION</span>
          <h2>Free</h2>
          <div className="price">
            $0<small> / forever</small>
          </div>
          <p>300 credits every day</p>
          <Link className="button secondary" href={user ? "/" : "/login"}>
            {user ? "Open workspace" : "Get started"}
          </Link>
          <ul>
            <li>Free annotation credits refreshed daily</li>
            <li>Resets at 00:00 UTC; unused credits expire</li>
            <li>Up to 1,000 alternate alleles per batch</li>
            <li>Private JSON results available for 24 hours</li>
          </ul>
        </section>
        <section className="panel plan featured">
          <span className="eyebrow">FOR REGULAR ANNOTATION</span>
          <h2>Pro</h2>
          <div className="price">
            ${annual ? "240" : "20"}
            <small> / {annual ? "year" : "month"}</small>
          </div>
          <p>4,000 subscription credits each month</p>
          {user ? (
            <>
              <label className="term-consent">
                <input
                  type="checkbox"
                  checked={accept}
                  onChange={(e) => setAccept(e.target.checked)}
                />{" "}
                I agree to pay ${annual ? "240" : "20"} for one{" "}
                {annual ? "year" : "month"}. Renew manually;{" "}
                {annual
                  ? "unused credits roll over until your annual term ends."
                  : "unused credits expire when your monthly term ends."}
              </label>
              <button
                className="primary"
                disabled={!enabled || !accept}
                onClick={subscribe}
              >
                Choose Pro →
              </button>
            </>
          ) : (
            <Link className="button primary" href="/login">
              Sign in to choose Pro →
            </Link>
          )}
          <ul>
            <li>
              {annual
                ? "$240 billed annually · $20/month equivalent"
                : "$20 billed monthly"}
            </li>
            <li>4,000 credits released monthly, including annual plans</li>
            <li>
              {annual
                ? "Unused credits roll over each month until your annual term ends"
                : "Unused credits expire at the end of your monthly term"}
            </li>
            <li>300 daily free credits included and used first</li>
          </ul>
          <small>
            {enabled
              ? "Secure payment with Amazon Payment Services. Your term does not renew automatically."
              : "Paid checkout is not available yet. Daily free credits are available."}
          </small>
        </section>
      </div>
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      <section className="panel calculator">
        <div>
          <span className="eyebrow">KNOW YOUR COST</span>
          <h2>One batch fee. One variant fee.</h2>
          <p>
            150 credits per batch + 0.01 credit per alternate allele.
            <br />
            Each batch supports up to 1,000 alternate alleles.
          </p>
        </div>
        <label>
          Variants in your batch
          <input
            type="number"
            min={1}
            max={1000}
            value={count}
            onChange={(e) =>
              setCount(Math.max(1, Math.min(1000, Number(e.target.value) || 1)))
            }
          />
        </label>
        <div className="estimate">
          <strong>{(150 + count * 0.01).toFixed(2)} credits</strong>
          <span>Daily free credits are used first</span>
        </div>
      </section>
      <section className="faq">
        <h2>How credits work</h2>
        <p>
          Daily free credits are consumed first, then your current subscription
          allocation. Credits cannot be redeemed for cash. Annual subscriptions
          release credits monthly rather than all at once. Unused annual credits
          roll over until the annual term ends. Monthly-plan credits expire each
          term, and daily free credits expire each day.
        </p>
        <p>
          Credits are reserved when a batch starts. If annotation fails, credits
          that have not expired are returned. Reopening a completed batch within
          24 hours does not charge again.
        </p>
      </section>
    </>
  );
}
