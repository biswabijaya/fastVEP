# Enigma Genomics deployment

Development commits go to `biswa`. Production releases are promoted to
`prod-enigma`; only pushes to that branch trigger the production workflow.
The GitHub Actions job uses short-lived Google identity credentials restricted
to `biswabijaya/fastVEP` and `refs/heads/prod-enigma`. No Google key is stored in GitHub.

- Firebase project: `enigmagenomics`
- App Hosting backend: `fastvep`, region `us-central1`
- Product display name: fastVEP
- Domain: `fastvep.enigmagenomics.com`
- Frontend root: `frontend`
- Engine: native Rust on Cloud Run, private invocation by the App Hosting service account

The frontend uses the actual Rust `AnnotateRequest` exported by ts-rs. Its small
WASM module checks VCF structure locally in a Web Worker. Annotation, reference
lookups, and HGVS remain in the native engine. WASM is not a browser annotation engine yet.

Run `scripts/build-browser.sh` with Rust, the wasm32-unknown-unknown target,
wasm-bindgen-cli matching Cargo.lock, and Node 22 installed. Generated TypeScript
and WASM assets are committed so App Hosting only needs the Node build.

The initial engine uses GRCh38 Ensembl 115, its primary-assembly FASTA, and ClinVar.
ACMG classification remains disabled without the complete evidence stack.
Reference files are built into the engine image, with SHA256SUMS retained in the
reference directory. ClinVar is captured at image build time; retain the image
digest for reproducibility. Rebuilding references can change ClinVar results.

Build the engine with `gcloud builds submit --region us-central1 --config deploy/cloudbuild.yaml`.
Deploy the resulting image with `scripts/deploy-engine.sh IMAGE_URI` to the
private `fastvep-engine` Cloud Run service,
then configure FASTVEP_API_URL and FASTVEP_API_AUDIENCE in frontend/apphosting.yaml.
Engine reference rebuilds are a separate operator action; frontend promotions reuse
the deployed engine. Pin a tested image digest when updating the engine.

## Promote a release

After validation on `biswa`, fast-forward `prod-enigma` to the reviewed development
commit and push that branch. This starts `.github/workflows/deploy-enigma.yml`.
Do not push development commits directly to production. Monitor the GitHub workflow
and Firebase rollout, then verify status and a synthetic annotation through the domain.

The Firebase Developer Connect GitHub connection is not used by this deployment.
Production deployment is controlled by the branch-restricted GitHub Actions workflow.

Usage counters are per instance and reset when an instance restarts. They are not
a persistent audit trail.

## Initial verified reference image

Engine image digest: `sha256:2baab591672148ff0356d557605fc832f0cd1f93730a5e94e1bca1ead9c2ddaa`.
The live service reported 509,650 transcripts, Ensembl 115 GRCh38, and ClinVar
release 2026-11-08 (4,619,144 database records). A synthetic
`17:43124025 A>G` request through App Hosting returned BRCA1 with HGVS and ClinVar
annotations. Direct anonymous requests to the engine were refused with HTTP 403.
