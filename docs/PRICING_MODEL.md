# fastVEP accounts, pricing and payment launch

Confirmed terms (2026-11-11): $1 = 200 credits; Free has 200 credits per UTC day; Pro costs $20/month or $240/year, with 4,000 subscription credits released monthly. Annual billing has no discount at the requested exchange rate. Daily credits expire at 00:00 UTC. Subscription credits expire at each monthly allocation boundary; neither balance rolls over. Free credits are spent first and can combine with subscription credits. Credits are a service allowance, not redeemable cash.

## Annotation charge

Proposed margin-aware tariff: **150 credits per batch + 0.01 credit per alternate allele**. Interactive jobs are limited to 1,000 alternate alleles and 1 MiB request size. Multi-allelic VCF rows count each ALT allele. The price includes all returned transcripts and ClinVar evidence. ACMG remains unavailable until the evidence stack is complete.

| Variants | Batches of 1,000 | Credits | Service value before free credits |
| --- | ---: | ---: | ---: |
| 1,000 | 1 | 160 | $0.80 |
| 10,000 | 10 | 1,600 | $8.00 |
| 100,000 | 100 | 16,000 | $80.00 |

Smaller batches pay the fixed fee each time. These are usage prices, not separate checkout amounts; customers buy the confirmed monthly or annual plan. The browser shows the total before submission, and the server recomputes it. Keeping these amounts in one shared pricing module prevents client/server drift.

## Margin model, not a guarantee

Google lists request-based Cloud Run us-central1 active CPU at $0.000024/vCPU-second and memory at $0.0000025/GiB-second. At the deployed 4-vCPU / 16-GiB engine configuration, active runtime costs approximately $0.000136/second. Startup CPU boost, loading references, frontend runtime, result storage/downloads and Firestore add cost. Rates and free tiers are shared across the billing account; this model does **not** rely on free tiers.

Planning allowance: $0.03 per successful batch, including an isolated cold start. This is an assumption to validate against billing exports, not a measured upper bound. For example, 120 seconds at 8 boosted vCPU / 16 GiB alone is about $0.02784, before other work. Concurrent warm requests may cost considerably less; repeated failures or long starts may cost more.

A maximally used 31-day account receives 6,200 daily credits plus 4,000 paid credits. Because balances combine, do not count only one daily batch plus the paid batches. The smallest charge is 150.01 credits, so 10,200 credits permit at most 67 successful batches in aggregate (daily expiry may lower this). At $0.03/batch this costs $2.01. Add an **illustrative, unverified** payment fee of 2.9% + $0.30 ($0.88 on $20), and $0.10/account of operational overhead: modeled cost $2.99 on $20 revenue, or **85.05% contribution margin**. Actual Amazon Payment Services merchant pricing is not yet established. This model excludes taxes, engineering/support payroll, chargebacks and refunds.

To remain between 80% and 90% contribution margin on $20, total allocated cost must be $2–$4. A target does not imply a hard floor or ceiling: warm usage may yield >90%; expensive cold starts, fraud, retries or free-user acquisition may produce <80%. Instrument actual engine CPU/memory/startup, frontend runtime, Firestore operations, storage/egress, payment fees and failed work before promising a margin. Free-only accounts have no revenue; their subsidy is a separate acquisition budget and cannot have a positive per-account margin. Verified email and one in-flight batch per account reduce misuse but do not prevent multi-account abuse.

## Server accounting and data access

Money-like credit arithmetic uses integer hundredths of a credit. Firestore transactions reserve daily first, then subscription credits. A persistent idempotency key binds a request to its normalized payload; the same job cannot be charged twice. Only one job may be pending per account. Success settles the reservation; failure returns only unexpired credits. A five-minute lease enables reconciliation after a crashed request. A retry after failure must explicitly start a new batch; a network retry of the same completed request reuses its existing result.

Results are private in the US-central1 result bucket and available through an authenticated, account-owned endpoint for exactly 24 hours. GCS lifecycle deletion is asynchronous and can occur later; API expiry is enforced separately. Input VCFs are not stored as separate uploads. Returned annotation JSON can contain identifying input-derived fields and remains sensitive. Usage metadata stores counts, dates, genome and charges, not VCF content. Client Firestore access to the named `fastvep` database is denied. Firebase Admin verifies both token revocation and email verification.

## Payment provider

The existing Enigma provider is Amazon Payment Services (Payfort). Merchant ID, access code and SHA request phrase were copied directly into Google Secret Manager without adding values to source control. The current production request and response phrases were retrieved from the signed-in APS dashboard and stored directly in Secret Manager. A no-purchase production CHECK_STATUS probe returned the expected 12036 (nonexistent order), with a valid response signature. No signing values appear in source control or reports. The PHP repository contained only request phrases; its production/test conditional had to be interpreted explicitly. The dashboard reveal controls must be used to retrieve actual values rather than the initial password placeholders.

**Checkout is enabled in the proposed App Hosting configuration**, with production APS credentials. No live purchase has been attempted. Local development and other environments remain disabled unless `FASTVEP_PAYMENTS_ENABLED=true` is explicitly set. The changes are not yet promoted to production. Hosted checkout, signed callbacks/webhooks, independent CHECK_STATUS verification, payment reconciliation, idempotent capture attribution, refund revocation and monthly/annual entitlement accounting are implemented. Checkout gates on the server configuration flag. Signature verification has passed against APS, but actual card payments and SAR settlement have not been exercised. Terms renew manually; automatic renewal is not offered.

Remaining payment validation before promoting a paid launch:

1. Confirm SAR acceptance and test a customer-approved purchase. Production request and response signature verification already passes a read-only check.
2. The signed hosted request sets its own return URL to `/api/billing/callback`. `/api/billing/webhook` is also implemented, but the shared merchant-wide notification destination has not been changed because it serves existing Enigma payments. If per-application notifications are available, configure that separately. Customers can use authenticated “Check payment” reconciliation if a return is interrupted. Invoice amounts/currency come from the server catalog. Payment success in the UI does not grant credits. Confirmation requires a valid signed callback and an independently signed CHECK_STATUS response, or an authenticated server reconciliation of the server-owned invoice.
3. Current terms renew manually, with explicit consent at checkout. If automatic renewals are later requested, verify save-card and recurring support. APS requires `token_name` and `agreement_id` from an initial successful transaction; a one-off PURCHASE is not an automatic subscription. Implement explicit recurring consent, cancellation, renewal scheduling, failed-payment handling and reconciliation before advertising auto-renewal.
4. Exercise approved sandbox credentials and signed callbacks, including duplicates, invalid signatures, mismatched amounts/currency, abandoned checkout, late success, refunded payments and renewal retries. No live charge without authorization.
5. Frontend server access is restricted to the four APS secrets. Secret Manager supplies them at runtime and caches for five minutes. No signing phrases are shipped to browser code. Only signed hosted-checkout fields are returned to the customer.

## Release boundary

Development commits go to `biswa`. Production remains on `prod-enigma` until an intentional promotion. App Hosting and the engine remain in `us-central1` in `enigmagenomics`, using fastvep.enigmagenomics.com. New named Firestore database and result bucket are isolated from existing Enigma application data. Test infrastructure uses the `demo-fastvep` emulators and synthetic records.

Sources checked 2026-11-11:
- https://cloud.google.com/run/pricing
- https://paymentservices.amazon.com/docs/developer-resources/signature
- https://paymentservices.amazon.com/docs/managing-payments/recurring-payments
- https://paymentservices.amazon.com/docs/api/managing-payments/check-status

## SAR settlement, USD display

APS checkout submits SAR at the fixed 3.75 SAR/USD peg: $20 -> SAR 75.00 (7500 halalas), $240 -> SAR 900.00 (90000 halalas). Invoice records retain both settlement and display amounts. fastVEP pricing, credit values and payment history remain in USD. Signed checkout, callback validation, captured-amount checks, reconciliation and ledger entries use the invoice's actual settlement currency/amount. Existing USD invoices remain verifiable; pending USD invoices are not reused for new SAR checkouts. APS's own hosted payment page and the customer's bank may display the actual SAR charge; fastVEP does not control those screens.

Exchange-rate source: https://www.sama.gov.sa/en-US/MediaCenter/News/Pages/news-557.aspx
