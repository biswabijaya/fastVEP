"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSession } from "../src/components/Session";
import { inspectVcf, quoteUnits, credits } from "../src/lib/credits";
import type { AnnotateRequest } from "../src/generated/AnnotateRequest";
import type { AcmgReadiness } from "../src/generated/AcmgReadiness";

type Genome = {
  name: string;
  label?: string;
  acmg?: AcmgReadiness;
  loaded?: boolean;
};
type ResultRow = {
  seq_region_name?: string;
  start?: number;
  allele_string?: string;
  most_severe_consequence?: string;
  transcript_consequences?: {
    gene_symbol?: string;
    transcript_id?: string;
    hgvsc?: string;
    hgvsp?: string;
  }[];
};
type Answer = {
  billing?: {
    totalCredits: number;
    freeCredits: number;
    subscriptionCredits: number;
  };
  results: ResultRow[];
  count: number;
  warnings?: string[];
  gene_model?: { genome?: string };
};
const example = "17\t43124025\t.\tA\tG\t.\tPASS\t.";

export default function Home() {
  const { user, loading } = useSession();
  if (loading) return <p role="status">Loading your workspace…</p>;
  if (!user || !user.emailVerified)
    return (
      <section className="landing">
        <span className="eyebrow">ENIGMA GENOMICS / VARIANT ANNOTATION</span>
        <h1>
          From variants
          <br />
          to clear consequences.
        </h1>
        <p>
          Explore genes, transcripts and protein changes in a focused annotation
          workspace.
        </p>
        <Link href="/login" className="button primary">
          {user ? "Verify your email" : "Sign in to annotate"} →
        </Link>
        <Link href="/pricing" className="button secondary">
          Explore pricing
        </Link>
        <div className="feature-grid">
          <article>
            <strong>GRCh38 · Ensembl 115</strong>
            <p>Native Rust consequence prediction with ClinVar evidence.</p>
          </article>
          <article>
            <strong>300 free credits daily</strong>
            <p>Refreshed at UTC midnight. Know the cost before each batch.</p>
          </article>
          <article>
            <strong>Your own workspace</strong>
            <p>
              Private results, credit breakdowns and downloadable annotations.
            </p>
          </article>
        </div>
      </section>
    );
  return <Workspace key={user.uid} />;
}
function Workspace() {
  const { api, account, refresh, error: accountError } = useSession();
  const requestId = useRef<string | null>(null);
  const requestBody = useRef<string>("");
  let estimated: number | null = null;
  const [vcf, setVcf] = useState("");
  const [genomes, setGenomes] = useState<Genome[]>([]);
  const [genome, setGenome] = useState("");
  const [available, setAvailable] = useState(false);
  const [status, setStatus] = useState("Connecting to annotation service…");
  const [connectionAttempt, setConnectionAttempt] = useState(0);
  const [connecting, setConnecting] = useState(true);
  const [pick, setPick] = useState(true);
  const [acmg, setAcmg] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [answer, setAnswer] = useState<Answer | null>(null);
  const worker = useRef<Worker | null>(null);
  const pending = useRef(
    new Map<
      number,
      { resolve: (n: number) => void; reject: (e: Error) => void }
    >(),
  );
  const nextId = useRef(0);
  try {
    estimated = credits(quoteUnits(inspectVcf(vcf).variantCount));
  } catch {}
  useEffect(() => {
    const w = new Worker("/validate-worker.js", { type: "module" });
    worker.current = w;
    w.onmessage = ({ data }) => {
      const p = pending.current.get(data.id);
      if (p) {
        pending.current.delete(data.id);
        data.error ? p.reject(new Error(data.error)) : p.resolve(data.count);
      }
    };
    w.onerror = () => {
      for (const p of pending.current.values())
        p.reject(
          new Error(
            "Local input checker could not load. Refresh and try again.",
          ),
        );
      pending.current.clear();
    };
    const controller = new AbortController();
    setConnecting(true);
    setStatus("Connecting to annotation service…");
    const warming = window.setTimeout(() => {
      setStatus("Starting the annotation service and loading reference data. This can take up to two minutes after a period of inactivity…");
    }, 8000);
    const deadline = window.setTimeout(() => controller.abort(), 120000);
    (async () => {
      try {
        const response = await api("/api/fastvep/status", {
          signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok)
          throw new Error(data.error || "Annotation service unavailable");
        if (!data.transcripts || !data.has_fasta)
          throw new Error(
            "Reference data is being prepared. Annotation will be available when the genome and reference sequence are loaded.",
          );
        const list = await api("/api/fastvep/genomes", {
          signal: controller.signal,
        });
        const g = await list.json();
        if (!list.ok) throw new Error("Genome list could not be loaded");
        setGenomes(g.genomes || []);
        setGenome(g.default || g.genomes?.[0]?.name || "");
        setAvailable(true);
        setStatus(`Ready · VEP ${data.version}`);
      } catch (e) {
        if (controller.signal.aborted)
          setStatus("The connection took too long. Please retry.");
        else
          setStatus(e instanceof Error ? e.message : "Annotation service unavailable");
      } finally {
        window.clearTimeout(warming);
        window.clearTimeout(deadline);
        setConnecting(false);
      }
    })();
    return () => {
      window.clearTimeout(warming);
      window.clearTimeout(deadline);
      controller.abort();
      w.terminate();
      worker.current = null;
      for (const p of pending.current.values())
        p.reject(new Error("Input checker closed"));
      pending.current.clear();
    };
  }, [api, connectionAttempt]);
  async function annotate() {
    setBusy(true);
    setError("");
    setAnswer(null);
    try {
      if (new TextEncoder().encode(vcf).length > 1000000)
        throw new Error("Please keep interactive input below 1 MB.");
      await new Promise<number>((resolve, reject) => {
        const id = ++nextId.current;
        pending.current.set(id, { resolve, reject });
        worker.current?.postMessage({ id, vcf });
      });
      const request: AnnotateRequest = {
        vcf,
        genome: genome || null,
        acmg,
        pick,
        pick_allele: false,
        pick_allele_gene: false,
        flag_pick: false,
        flag_pick_allele: false,
        flag_pick_allele_gene: false,
      };
      const body = JSON.stringify(request);
      if (requestBody.current !== body || !requestId.current) {
        requestId.current = crypto.randomUUID();
        requestBody.current = body;
      }
      let response = await api("/api/fastvep/annotate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": requestId.current!,
        },
        body,
        signal: AbortSignal.timeout(100000),
      });
      let data = await response.json();
      const pollDeadline = Date.now() + 310000;
      while (response.status === 202 && Date.now() < pollDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        response = await api(`/api/jobs/${requestId.current}`);
        data = await response.json();
        if (data.job?.status === "refunded") {
          requestId.current = null;
          throw new Error(data.job.failure || "Batch refunded.");
        }
      }
      if (data.code === "batch_refunded") requestId.current = null;
      if (!response.ok || response.status === 202)
        throw new Error(
          typeof data.error === "string"
            ? data.error
            : JSON.stringify(data.error || data),
        );
      if (!Array.isArray(data.results))
        throw new Error(
          "The annotation service returned an unexpected response.",
        );
      setAnswer(data);
      requestId.current = null;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      await refresh();
      setBusy(false);
    }
  }
  function download() {
    if (!answer) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(answer, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "vep-results.json";
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">VARIANT EFFECT PREDICTOR</span>
          <h1>Annotation workspace</h1>
          <p>Submit VCF records and explore their predicted consequences.</p>
        </div>
        <Link className="button secondary" href="/account">
          Usage & results →
        </Link>
      </div>
      <div className="wallet-strip">
        <div>
          <span>Daily free credits</span>
          <strong>{account?.dailyCredits.toLocaleString() ?? "—"}</strong>
          <small>Reset at 00:00 UTC</small>
        </div>
        <div>
          <span>Subscription credits</span>
          <strong>
            {account?.subscriptionCredits.toLocaleString() ?? "—"}
          </strong>
          <small>Free credits are used first</small>
        </div>
        <div>
          <span>Batch pricing</span>
          <strong>1 credit / 5,000 variants</strong>
          <small>Each alternate allele counts as one variant</small>
        </div>
      </div>
      {accountError && (
        <p role="alert" className="error">
          {accountError}
        </p>
      )}
      <div className={`service ${available ? "ready" : ""}`} role="status">
        <span className="dot" />
        {status}
        {!available && !connecting && (
          <button type="button" className="button secondary" onClick={() => setConnectionAttempt((n) => n + 1)}>
            Retry connection
          </button>
        )}
      </div>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">01 / INPUT</span>
            <h2>Annotate variants</h2>
          </div>
          <button
            className="quiet"
            onClick={() => {
              setVcf(example);
              setAnswer(null);
            }}
          >
            Load GRCh38 example
          </button>
        </div>
        <div className="field">
          <label htmlFor="genome">Reference genome</label>
          <select
            id="genome"
            value={genome}
            disabled={!available || busy}
            onChange={(e) => {
              setGenome(e.target.value);
              setAcmg(false);
              setAnswer(null);
            }}
          >
            {genomes.length ? (
              genomes.map((g) => (
                <option key={g.name} value={g.name}>
                  {g.label || g.name}
                </option>
              ))
            ) : (
              <option value="">Reference genomes are being prepared</option>
            )}
          </select>
        </div>
        <div className="input-label">
          <label htmlFor="vcf">VCF records</label>
          <label className="file">
            Upload .vcf
            <input
              type="file"
              accept=".vcf,.txt"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) {
                  if (f.size > 1000000) {
                    setError("Please keep interactive input below 1 MB.");
                    return;
                  }
                  setVcf(await f.text());
                  setAnswer(null);
                }
              }}
            />
          </label>
        </div>
        <textarea
          id="vcf"
          value={vcf}
          onChange={(e) => setVcf(e.target.value)}
          spellCheck={false}
          placeholder={
            "#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\n17\t43124025\t.\tA\tG\t.\tPASS\t."
          }
        />
        <p className="hint">
          Tab-separated VCF · Up to 1,000 variants · Choose the reference build
          used for your VCF.
        </p>
        <div className="options">
          <label>
            <input
              type="checkbox"
              checked={pick}
              onChange={(e) => setPick(e.target.checked)}
            />{" "}
            One consequence per variant
          </label>
          <label>
            <input
              type="checkbox"
              checked={acmg}
              disabled={!genomes.find((g) => g.name === genome)?.acmg?.ready}
              onChange={(e) => setAcmg(e.target.checked)}
            />{" "}
            ACMG classification
          </label>
        </div>
        <div className="submit-row">
          <span>
            {estimated !== null
              ? `This batch: ${estimated.toLocaleString(undefined, { maximumFractionDigits: 2 })} credits`
              : "1 credit per started 5,000 alternate alleles · No batch fee"}
            <small>
              Browser input check · Private results available for 24 hours
            </small>
          </span>
          <button
            className="primary"
            disabled={
              !available ||
              busy ||
              !vcf.trim() ||
              estimated === null ||
              !account ||
              estimated > account.totalCredits
            }
            onClick={annotate}
          >
            {busy ? "Annotating…" : "Annotate variants →"}
          </button>
        </div>
        {estimated !== null && account && estimated > account.totalCredits && (
          <p className="notice">
            Not enough credits. Wait for the daily refresh or{" "}
            <Link href="/pricing">explore a subscription</Link>.
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </section>
      {answer && (
        <section className="panel results">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">02 / RESULTS</span>
              <h2>
                {answer.count.toLocaleString()} annotated{" "}
                {answer.count === 1 ? "variant" : "variants"}
              </h2>
            </div>
            <button className="quiet" onClick={download}>
              Download JSON ↓
            </button>
          </div>
          {answer.billing && (
            <p className="notice">
              {answer.billing.totalCredits} credits used:{" "}
              {answer.billing.freeCredits} daily +{" "}
              {answer.billing.subscriptionCredits} subscription. Download your
              results within 24 hours.
            </p>
          )}
          {answer.warnings?.map((w, i) => (
            <p className="error" key={i}>
              {w}
            </p>
          ))}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Variant</th>
                  <th>Gene</th>
                  <th>Consequence</th>
                  <th>Transcript</th>
                  <th>HGVS</th>
                </tr>
              </thead>
              <tbody>
                {answer.results.map((r, i) => {
                  const t = r.transcript_consequences?.[0];
                  return (
                    <tr key={i}>
                      <td>
                        {r.seq_region_name}:{r.start} {r.allele_string}
                      </td>
                      <td>{t?.gene_symbol || "—"}</td>
                      <td>{r.most_severe_consequence || "—"}</td>
                      <td>{t?.transcript_id || "—"}</td>
                      <td>{t?.hgvsc || t?.hgvsp || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
