# VEP project system

## Implementation status

The first increment adds authenticated, owner-scoped project creation/listing and an atomic free-account project limit. `/projects` explicitly reports that uploads and runs are not available yet. Project-specific billing policy and file/run contracts are implemented; the existing interactive annotation prices, uploads and 24-hour JSON results are unchanged. Nothing in this increment charges for storage or transfers.

The project endpoint advertises `capabilities.uploads=false` and `capabilities.runs=false`. Do not enable file controls until the actual storage and worker capabilities exist.

## Selected policy — 2026-11-11-v2

Decimal MB; each block is 100,000,000 bytes. Transfers round per file/session; storage rounds once across all account files.

- Upload: 1 credit per started block, once on successful finalization.
- Save output: 1 credit per started block, once on successful finalization.
- Download: 40 credits per started block, per distinct download session.
- Deletion: 1 credit per started block, once; retries are not new deletions.
- Monthly storage: 5 credits per started block of total retained account data at the previous UTC month boundary. Settle at 00:00 UTC on the first. Deleted files are excluded. Do not charge settled transfer operations again.
- Run: ceil(billable alternate alleles / 5,000) credits (200 credits per million), with no base fee. Quote only after server validation/counting.
- Annual plans continue to pay ten monthly prices for twelve allocations.

At annual fully consumed credit revenue ($0.0041667/credit), the file rates leave approximately 91% storage margin at $0.02/GiB-month, 93% common-download margin at $0.12/GiB, and 87% download margin at $0.23/GiB. These estimates exclude overhead, provider fees, retained deleted copies and promotional usage. Prices are versioned; no overall margin guarantee is implied.

Free account policy: three projects, 100 MB retained, 100 MB uploads/day, 100 MB downloads/day, one active run, maximum expanded input 1 GB. Only the project count is enforced in this increment; byte and run limits must be enforced atomically when those endpoints are implemented. Paid accounts initially have an operational limit of 100 projects. Current small-batch workspace limits remain in force.

## Next implementation increments

1. Create a separate private persistent Standard bucket in us-central1. The existing results bucket has a one-day lifecycle and seven-day soft deletion: it is unsuitable for persistent project data. Decide the recovery retention and account for its real billable bytes explicitly. No public bucket or client-wide read rules.
2. Initiate resumable uploads after reserving transfer credits and an atomic byte allowance. Keep session URLs secret; use unguessable owner-scoped paths. Verify object generation, actual byte size and checksum on completion. Reject oversize objects and clean abandoned uploads. Settle each finalized generation once; release unused reservations. Never trust a browser count or declared file size.
3. Stream validation with bounded gzip expansion, line length, sample count, parsing time and variant count. Count alternate alleles separately from records, reject gVCF reference blocks, report unsupported records. Save an immutable validated object generation and reference identity.
4. Freeze quotes against object generation, options, reference version and pricing version. Run and max-output-save reservation requires explicit confirmation. Background workers use leases, heartbeats and idempotent billing; retries cannot create another debit. Do not use the existing five-minute interactive lease for large jobs.
5. Stream annotation into valid VCF preserving headers, records and genotypes with declared CSQ fields. BGZF output `vep.vcf.gz`; an index only for sorted indexable output. Track queued/preparing/annotating/compressing/saving stages and measured variant progress. A failed job refunds its reservation under a documented cancellation policy and publishes no partial output as complete.
6. Downloads need controlled sessions and byte/range accounting. An indefinitely reusable storage URL does not enforce per-download billing. Resumes share one bounded session; new downloads reserve another charge. Enforce free daily limits even when a wallet has available daily credits.
7. Deletion must remain possible with insufficient funds: reserve cleanup costs earlier or record a bounded debt. Mark deletion tombstones and reconcile physical deletion, soft retention and failed deletions. An in-use input cannot disappear mid-run.
8. Maintain immutable usage events and versioned file lifetimes. Monthly billing must reconstruct the cutoff, not use the current byte counter if the scheduler runs late. Deterministic account/month invoice IDs prevent duplicate settlement. Reserve storage exposure before account credit expiry, show a grace period and enforce quotas on delinquent accounts. Do not permit unlimited unpaid retention.
9. Before production enablement: fault-injection tests for duplicate events, failed transfers, worker crashes and month boundaries; benchmark representative multi-sample compressed VCFs; verify exact CSQ/genotype preservation; measure actual GCP costs per run.

Project metadata is stored under the authenticated account's `projects` collection in the existing named `fastvep` Firestore database. All access stays server-side under the existing deny-all client rules. Project creation and its usage counter share one transaction to prevent simultaneous requests bypassing limits.

Sources: https://cloud.google.com/storage/pricing and https://cloud.google.com/run/pricing (reviewed 2026-11-11).
