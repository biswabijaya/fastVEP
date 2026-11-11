# fastVEP pricing, credits and payment launch

Current terms, 2026-11-11. All subscriptions are paid manually for one purchased term. No automatic renewal, stored-card billing or recurring charges are enabled. Customer-facing prices and payment history remain USD; Amazon Payment Services receives SAR settlement at 3.75 SAR/USD. No live card purchase has been attempted.

## Three tiers

| Tier | Monthly subscription | Annual subscription | Monthly paid credit allocation |
| --- | ---: | ---: | ---: |
| Free | $0 | $0 | No paid allocation; 300 free credits each UTC day |
| Research | $20–$200 | $200–$2,000 | 4,000–40,000 credits |
| Clinical | $200–$20,000 | $2,000–$200,000 | 40,000–4,000,000 credits |

Annual subscriptions charge **ten times the monthly price** for twelve months of access and twelve monthly credit allocations: pay for ten months, get two months free (16.67% off twelve monthly payments). The page shows a monthly equivalent and the full annual payment, so no monthly collection is implied. All selected options use the existing base rate of 200 credits per monthly-plan dollar; annual subscribers receive the same monthly credit allocation during the two free months.

Research monthly options: $20 / $40 / $60 / $80 / $100 / $150 / $200, corresponding to 4,000 / 8,000 / 12,000 / 16,000 / 20,000 / 30,000 / 40,000 credits.

Clinical monthly options: $200 / $500 / $1,000 / $2,000 / $5,000 / $10,000 / $20,000, corresponding to 40,000 / 100,000 / 200,000 / 400,000 / 1,000,000 / 2,000,000 / 4,000,000 credits.

The shared catalog is `frontend/src/lib/plans.ts`. The server accepts a catalog plan ID, never a client-supplied amount or credit grant. The invoice freezes the plan ID, tier, monthly allowance, charged amount and display amount. Pending invoices are reused only for the same plan, cadence and current price. Existing invoices and purchased terms keep their original amount and allowance; the former $240 annual purchase is not retroactively repriced. New purchases use the ten-month annual tariff. Mid-term upgrades/proration are not offered; users renew manually when their current term ends.

## Clinical bundle and access boundary

Every Clinical plan includes, at no additional subscription charge:

- https://clinical.enigmagenomics.com
- https://reporting.enigmagenomics.com
- AI

The authenticated account response derives `includedServices.clinical`, `.reporting` and `.ai` from the active paid Clinical entitlement. These are false for Free/Research and after expiry or subscription revocation. The account page shows the bundle and links for active Clinical subscribers. Inclusion is a billing entitlement, not an administrator role or a promise of unlimited compute.

**Cross-application onboarding is not automated by this change.** The linked services retain their existing authentication and approval controls. The SGP AI copilot currently requires approved accounts and has per-account budgets; these controls have not been removed or bypassed. The other applications do not yet consume fastVEP's billing entitlement automatically. Before selling Clinical as an automatically activated bundle, connect their approval/provisioning workflow to the paid entitlement (with expiry/revocation) or provision through the existing approved onboarding process. No unrelated application's access rules or deployment were changed.

## Credit expiry and consumption

- All users receive **300 daily free credits**, shown only as credits without dollar-equivalent messaging. They reset at 00:00 UTC, expire daily, do not accumulate and are consumed first.
- Monthly paid credits expire at the end of their purchased monthly term.
- Annual paid credits are released monthly. Unused balances roll over between months; **all remaining annual paid credits expire together at the annual term end**. They do not roll into a new annual term.
- Inactive months are credited on the next visit without releasing future allocations early. Persistent allocation counters prevent duplicate monthly issues.
- An old wallet under the former 200/day policy receives its additional 100 credits once, preserving prior usage; it then follows the 300/day policy.

Credits are a service allowance, not redeemable cash. Annual allocation and refund keys persist for the complete annual term, so a failed job crossing a monthly allocation boundary can return unexpired annual credits. Credits already expired at daily or term boundaries are not revived.

## Annotation tariff

150 credits per batch + 0.01 credit per alternate allele. Interactive input remains limited to 1,000 alternate alleles and 1 MiB per request. Multi-allelic rows count every ALT. Transcript selection and ClinVar evidence do not add a separate charge. ACMG classification remains unavailable until its evidence stack is complete.

| Variants | Batches of 1,000 | Credits |
| --- | ---: | ---: |
| 1,000 | 1 | 160 |
| 10,000 | 10 | 1,600 |
| 100,000 | 100 | 16,000 |

The browser previews credits; the server recomputes the charge. Firestore transactions reserve free credits first and then paid credits. A persistent idempotency key binds the job to its normalized payload, prevents duplicate charging and permits replay of the same result. Each account has at most one pending annotation. Failure returns only unexpired credits; a five-minute lease reconciles interrupted requests.

## Margin model: assumptions and the annual discount

The 80–90% margin remains a target, not a guarantee. Google lists request-based Cloud Run us-central1 active CPU at $0.000024/vCPU-second and memory at $0.0000025/GiB-second. At 4 vCPU / 16 GiB, engine active time is approximately $0.000136/second. Startup CPU boost, reference loading, the frontend, Firestore and result storage/downloads add cost. Do not rely on billing-account free tiers.

Planning allowance: $0.03 per successful batch, including an isolated cold start. This is an assumption, not a measured ceiling. A 120-second startup at 8 boosted vCPU / 16 GiB alone is about $0.02784. Warm requests may be cheaper; long starts, failed requests and abuse can cost more.

For the base $20 monthly Research plan, 31 days provide up to 9,300 free + 4,000 paid credits. The minimum 150.01-credit charge permits at most 88 successful batches: $2.64 modeled compute/service cost. Add an illustrative, unverified APS fee of 2.9% + $0.30 ($0.88) and $0.10/account operations: $3.62 cost / $20 revenue = **81.9% contribution margin**.

With the new annual promotion, base Research revenue is **$200/year**. A 365-day account can receive 109,500 free + 48,000 annual paid credits, at most 1,049 minimum-fee jobs. At $0.03/job, illustrative 2.9% + $0.30 annual payment fee and $1.20/year operations, modeled cost is $31.47 + $6.10 + $1.20 = **$38.77**, or **80.615% annual contribution margin**. Annual rollover can concentrate costs in a later month, so evaluate this cohort over the purchased year. Daily expiry may lower actual use. The promotion reduces the margin buffer versus the former $240 annual price.

Clinical bundle margins must additionally include Clinical, Reporting and AI costs. Actual APS merchant fees, AI/model consumption, service usage, abuse, support, taxes, refunds and chargebacks have not been established by this model. Including AI at no extra customer charge does not eliminate its underlying cost. Do not promise a guaranteed 80% margin for the Clinical bundle or unlimited AI use. Free-only users have no revenue; their subsidy is a separate acquisition budget.

## Data, payments and release state

Results are private in the US-central1 bucket `fastvep-results-903636395933`; authenticated, owner-only downloads expire after exactly 24 hours. Storage lifecycle deletion can occur later than API expiry. No input VCF is stored as a separate upload; returned result JSON may contain sensitive input-derived data. Usage metadata contains counts, date, genome and charges. Client access to the named `fastvep` Firestore database is denied; Firebase Admin verifies revoked tokens and verified email.

The current production APS request and response phrases were retrieved from the signed-in merchant dashboard directly into Google Secret Manager. A no-purchase CHECK_STATUS probe returned expected code 12036 for a nonexistent reference, with a valid response signature. No secret values are committed or included in reports.

Checkout, signed callbacks/webhooks, independent CHECK_STATUS verification, owner-only payment reconciliation, idempotent capture attribution and refund revocation are implemented. New invoices settle in SAR, display USD, and grant their frozen selected monthly allowance only after server confirmation. For example, base Research annual charges SAR 750.00 (75000 halalas) for the displayed $200. The maximum Clinical annual amount is $200,000 -> SAR 750,000.00 (75000000 halalas).

The signed checkout has its own `/api/billing/callback` return URL. `/api/billing/webhook` is implemented, but the shared merchant-wide notification destination was not changed because it serves existing Enigma payments. Customers can use authenticated “Check payment” if a return is interrupted. A real approved card purchase and SAR settlement have not been exercised. APS's own checkout and the bank may display the actual SAR charge; fastVEP does not control those screens.

All development goes to `biswa`; production remains on `prod-enigma` until intentional promotion. App Hosting, engine, named database and result bucket stay in `us-central1`, project `enigmagenomics`, domain fastvep.enigmagenomics.com. Emulator tests use only synthetic demo users and data.

Sources:
- https://cloud.google.com/run/pricing
- https://www.sama.gov.sa/en-US/MediaCenter/News/Pages/news-557.aspx
- https://paymentservices.amazon.com/docs/developer-resources/signature
- https://paymentservices.amazon.com/docs/api/managing-payments/check-status
