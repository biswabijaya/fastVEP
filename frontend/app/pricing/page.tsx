"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "../../src/components/Session";
import {
  BATCH_CREDITS,
  DAILY_CREDITS,
  MAX_VARIANTS,
  type Cadence,
} from "../../src/lib/credits";
import {
  RESEARCH_PLANS,
  CLINICAL_PLANS,
  INCLUDED_CLINICAL_SERVICES,
  planDollars,
  type PaidPlan,
} from "../../src/lib/plans";
const dollars = (amount: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: Number.isInteger(amount) ? 0 : 2,
  }).format(amount);
export default function Pricing() {
  const [annual, setAnnual] = useState(false),
    [research, setResearch] = useState(RESEARCH_PLANS[0].id),
    [clinical, setClinical] = useState(CLINICAL_PLANS[0].id),
    [count, setCount] = useState(1000),
    [message, setMessage] = useState(""),
    [accepted, setAccepted] = useState<string | null>(null),
    [enabled, setEnabled] = useState(false),
    [busy, setBusy] = useState(false);
  const { user, api } = useSession(),
    cadence: Cadence = annual ? "annual" : "monthly";
  useEffect(() => {
    fetch("/api/billing/status")
      .then((r) => r.json())
      .then((d) => setEnabled(d.enabled))
      .catch(() => {});
  }, []);
  function changeCadence(value: boolean) {
    setAnnual(value);
    setAccepted(null);
    setMessage("");
  }
  async function subscribe(plan: PaidPlan) {
    setBusy(true);
    setMessage("");
    try {
      const r = await api("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cadence,
          planId: plan.id,
          acceptTerm: accepted === plan.id,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Unable to open checkout.");
      if (
        ![
          "https://checkout.payfort.com/FortAPI/paymentPage",
          "https://sbcheckout.payfort.com/FortAPI/paymentPage",
        ].includes(d.url)
      )
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
    } finally {
      setBusy(false);
    }
  }
  function paidCard(tier: "research" | "clinical") {
    const isClinical = tier === "clinical",
      options = isClinical ? CLINICAL_PLANS : RESEARCH_PLANS,
      id = isClinical ? clinical : research,
      plan = options.find((p) => p.id === id)!;
    const billed = planDollars(plan, cadence),
      equivalent = annual ? billed / 12 : billed;
    return (
      <section
        className={`panel plan ${isClinical ? "clinical-plan" : "featured"}`}
      >
        <div className="plan-top">
          <span className="eyebrow">
            {isClinical ? "FOR CLINICAL TEAMS" : "FOR VARIANT RESEARCH"}
          </span>
          {isClinical && (
            <span className="bundle-badge">Clinical + Reporting + AI</span>
          )}
          <h2>{plan.name}</h2>
          <p>
            {isClinical
              ? "Annotation and your clinical toolkit, together."
              : "Choose the credits that fit your research."}
          </p>
        </div>
        <div className="price">
          {dollars(equivalent)}
          <small> / month</small>
        </div>
        <p className="billing-detail">
          {annual
            ? `${dollars(billed)} paid annually · 2 months free`
            : `${dollars(billed)} paid monthly`}
        </p>
        <label className="credit-selector" htmlFor={`${tier}-credits`}>
          Monthly credit allowance
          <select
            id={`${tier}-credits`}
            value={id}
            onChange={(e) => {
              isClinical
                ? setClinical(e.target.value)
                : setResearch(e.target.value);
              setAccepted(null);
              setMessage("");
            }}
          >
            {options.map((p) => (
              <option value={p.id} key={p.id}>
                {p.monthlyCredits.toLocaleString()} credits / month —{" "}
                {dollars(
                  annual ? planDollars(p, "annual") / 12 : p.monthlyDollars,
                )}
                /month
              </option>
            ))}
          </select>
        </label>
        <p className="credit-count">
          <strong>{plan.monthlyCredits.toLocaleString()}</strong> subscription
          credits each month
        </p>
        {user ? (
          <>
            <label className="term-consent">
              <input
                type="checkbox"
                checked={accepted === plan.id}
                onChange={(e) => setAccepted(e.target.checked ? plan.id : null)}
              />
              I agree to pay {dollars(billed)} for one{" "}
              {annual ? "year" : "month"}. Renew manually.
            </label>
            <button
              className="primary"
              disabled={!enabled || accepted !== plan.id || busy}
              onClick={() => subscribe(plan)}
            >
              {busy ? "Opening checkout…" : `Choose ${plan.name} →`}
            </button>
          </>
        ) : (
          <Link className="button primary" href="/login">
            Get started →
          </Link>
        )}
        <ul>
          <li>{DAILY_CREDITS} daily refresh credits, used first</li>
          <li>
            {plan.monthlyCredits.toLocaleString()} subscription credits released
            monthly
          </li>
          <li>
            {annual
              ? "Unused paid credits roll over monthly; all expire at the end of your annual term"
              : "Unused paid credits expire at the end of your monthly term"}
          </li>
          <li>Private annotation results and usage history</li>
          {isClinical ? (
            <>
              <li>
                <a
                  href={INCLUDED_CLINICAL_SERVICES.clinical}
                  target="_blank"
                  rel="noreferrer"
                >
                  Enigma Clinical
                </a>{" "}
                included at no extra charge
              </li>
              <li>
                <a
                  href={INCLUDED_CLINICAL_SERVICES.reporting}
                  target="_blank"
                  rel="noreferrer"
                >
                  Enigma Reporting
                </a>{" "}
                included at no extra charge
              </li>
              <li>
                <strong>AI included at no extra charge</strong>
              </li>
            </>
          ) : (
            <li>Flexible allowance from 4,000 to 40,000 credits per month</li>
          )}
        </ul>
        <small>
          Manual renewal.{" "}
          {enabled
            ? "Secure payment with Amazon Payment Services."
            : "Paid checkout is not available yet."}
        </small>
      </section>
    );
  }
  return (
    <>
      <div className="pricing-heading">
        <span className="eyebrow">FASTVEP / ENIGMA GENOMICS</span>
        <h1>A plan for every stage of discovery</h1>
        <p>
          Start free, scale your research, or bring your clinical workflow
          together.
        </p>
        <div className="segmented" aria-label="Billing period">
          <button aria-pressed={!annual} onClick={() => changeCadence(false)}>
            Monthly
          </button>
          <button aria-pressed={annual} onClick={() => changeCadence(true)}>
            Annually <span>· 2 months free</span>
          </button>
        </div>
        {annual && (
          <p className="annual-note">
            Pay for 10 months. Get a full year. Credits are released each month.
          </p>
        )}
      </div>
      <div className="plans plans-three">
        <section className="panel plan free-plan">
          <div className="plan-top">
            <span className="eyebrow">FOR EVERYDAY EXPLORATION</span>
            <h2>Free</h2>
            <p>Get started with variant annotation.</p>
          </div>
          <div className="price">
            $0<small> / forever</small>
          </div>
          <p className="billing-detail">No payment required</p>
          <div className="free-credit-summary">
            <strong>{DAILY_CREDITS}</strong>
            <span>refresh credits every day</span>
          </div>
          <Link className="button secondary" href={user ? "/" : "/login"}>
            {user ? "Open workspace" : "Get started"} →
          </Link>
          <ul>
            <li>{DAILY_CREDITS} free credits refreshed daily</li>
            <li>Resets at 00:00 UTC; unused free credits expire daily</li>
            <li>
              Up to {MAX_VARIANTS.toLocaleString()} alternate alleles per batch
            </li>
            <li>Private JSON results available for 24 hours</li>
            <li>Track your credit usage and annotation history</li>
          </ul>
        </section>
        {paidCard("research")}
        {paidCard("clinical")}
      </div>
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      <section className="included-banner">
        <div>
          <span className="eyebrow">ONE CLINICAL SUBSCRIPTION</span>
          <h2>Clinical. Reporting. AI.</h2>
          <p>
            All three are included with every Clinical plan, from $200 to
            $20,000 per month.
          </p>
        </div>
        <div className="included-links">
          <a
            href={INCLUDED_CLINICAL_SERVICES.clinical}
            target="_blank"
            rel="noreferrer"
          >
            clinical.enigmagenomics.com ↗
          </a>
          <a
            href={INCLUDED_CLINICAL_SERVICES.reporting}
            target="_blank"
            rel="noreferrer"
          >
            reporting.enigmagenomics.com ↗
          </a>
          <span>AI · included</span>
        </div>
      </section>
      <section className="panel calculator">
        <div>
          <span className="eyebrow">KNOW YOUR COST</span>
          <h2>One batch fee. One variant fee.</h2>
          <p>
            {BATCH_CREDITS} credits per batch + 0.01 credit per alternate
            allele.
            <br />
            Each batch supports up to {MAX_VARIANTS.toLocaleString()} alternate
            alleles.
          </p>
        </div>
        <label>
          Variants in your batch
          <input
            type="number"
            min={1}
            max={MAX_VARIANTS}
            value={count}
            onChange={(e) =>
              setCount(
                Math.max(
                  1,
                  Math.min(MAX_VARIANTS, Number(e.target.value) || 1),
                ),
              )
            }
          />
        </label>
        <div className="estimate">
          <strong>{(BATCH_CREDITS + count * 0.01).toFixed(2)} credits</strong>
          <span>Daily free credits are used first</span>
        </div>
      </section>
      <section className="faq">
        <h2>How credits and billing work</h2>
        <p>
          Daily free credits are consumed first, then your paid credits.
          Monthly-plan credits expire at the end of the monthly term. Annual
          plans release credits monthly; unused paid credits roll over between
          months, and all expire together when the purchased annual term ends.
        </p>
        <p>
          Annual plans cost ten monthly payments for twelve months of access and
          credit allocations. All subscriptions renew manually. Credits cannot
          be redeemed for cash.
        </p>
        <p>
          Credits are reserved when a batch starts. If annotation fails,
          unexpired credits are returned. Reopening a completed batch within 24
          hours does not charge again.
        </p>
      </section>
    </>
  );
}
