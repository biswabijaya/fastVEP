"use client";
import { useEffect, useRef, useState } from "react";
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
  results: ResultRow[];
  count: number;
  warnings?: string[];
  gene_model?: { genome?: string };
};
const example = "17\t43124025\t.\tA\tG\t.\tPASS\t.";

export default function Home() {
  const [vcf, setVcf] = useState("");
  const [genomes, setGenomes] = useState<Genome[]>([]);
  const [genome, setGenome] = useState("");
  const [available, setAvailable] = useState(false);
  const [status, setStatus] = useState("Connecting to annotation service…");
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
    (async () => {
      try {
        const response = await fetch("/api/fastvep/status", {
          signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok)
          throw new Error(data.error || "Annotation service unavailable");
        if (!data.transcripts || !data.has_fasta)
          throw new Error(
            "Reference data is being prepared. Annotation will be available when the genome and reference sequence are loaded.",
          );
        const list = await fetch("/api/fastvep/genomes", {
          signal: controller.signal,
        });
        const g = await list.json();
        if (!list.ok) throw new Error("Genome list could not be loaded");
        setGenomes(g.genomes || []);
        setGenome(g.default || g.genomes?.[0]?.name || "");
        setAvailable(true);
        setStatus(`Ready · fastVEP ${data.version}`);
      } catch (e) {
        if (!controller.signal.aborted)
          setStatus(
            e instanceof Error ? e.message : "Annotation service unavailable",
          );
      }
    })();
    return () => {
      controller.abort();
      w.terminate();
      worker.current = null;
      for (const p of pending.current.values())
        p.reject(new Error("Input checker closed"));
      pending.current.clear();
    };
  }, []);
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
      const response = await fetch("/api/fastvep/annotate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(100000),
      });
      const data = await response.json();
      if (!response.ok)
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
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
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
    a.download = "fastvep-results.json";
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <>
      <header>
        <a className="brand" href="/">
          <span className="brand-icon">fV</span>
          <span>
            fast<span className="accent">VEP</span>
          </span>
        </a>
        <span className="organization">ENIGMA GENOMICS</span>
        <a
          href="https://github.com/biswabijaya/fastVEP"
          target="_blank"
          rel="noreferrer"
        >
          Source ↗
        </a>
      </header>
      <main>
        <section className="intro">
          <span className="eyebrow">VARIANT EFFECT PREDICTOR</span>
          <h1>
            From variants
            <br />
            to consequences.
          </h1>
          <p>
            Explore the effect of genetic variants on genes, transcripts, and
            proteins.
          </p>
        </section>
        <div className={`service ${available ? "ready" : ""}`} role="status">
          <span className="dot" />
          {status}
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
            Tab-separated VCF · Up to 1,000 variants · Choose the reference
            build used for your VCF.
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
            <span>Input format is checked locally in your browser.</span>
            <button
              className="primary"
              disabled={!available || busy || !vcf.trim()}
              onClick={annotate}
            >
              {busy ? "Annotating…" : "Annotate variants →"}
            </button>
          </div>
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
        <footer>
          <span>fastVEP · Enigma Genomics</span>
          <span>GRCh38 · Ensembl 115 · ClinVar</span>
        </footer>
      </main>
    </>
  );
}
