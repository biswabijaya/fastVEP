"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "../../src/components/Session";
import { PROJECT_RATES, type Project } from "../../src/lib/project-policy";
export default function Projects() {
  const { user, loading, api } = useSession();
  const [projects, setProjects] = useState<Project[]>([]);
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!user?.emailVerified) return;
    let cancelled = false;
    api("/api/projects").then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      if (!cancelled) setProjects(data.projects);
    }).catch((error) => { if (!cancelled) setMessage(error.message); });
    return () => { cancelled = true; };
  }, [api, user]);
  if (loading) return <p role="status">Loading projects…</p>;
  if (!user?.emailVerified) return <section><h1>Your annotation projects</h1><Link href="/login">Sign in and verify your email to continue →</Link></section>;
  async function create(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      const response = await api("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setProjects((current) => [data.project, ...current]); setName("");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Project could not be created."); }
    finally { setBusy(false); }
  }
  return <section>
    <span className="eyebrow">INPUTS / RUNS / OUTPUTS</span>
    <h1>Your projects</h1>
    <p>Organize annotation work into projects. Each project will connect input files, processing runs and downloadable results.</p>
    <p role="status">Project setup is available. Persistent file uploads and background processing are being prepared. Continue using <Link href="/">the annotation workspace</Link> for current runs.</p>
    <form onSubmit={create}>
      <label htmlFor="project-name">Project name</label>
      <input id="project-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={100} required disabled={busy} />
      <button className="button primary" disabled={busy}>{busy ? "Creating…" : "Create project"}</button>
    </form>
    {message && <p role="alert">{message}</p>}
    <div className="feature-grid">{projects.map((project) => <article key={project.id}>
      <h2>{project.name}</h2><p>Created {new Date(project.createdAt).toLocaleDateString()}</p>
      <p>No input files or runs yet.</p>
    </article>)}</div>
    <h2>File and processing rates</h2>
    <p>Per started 100 MB: upload 1 credit · save output 1 credit · download {PROJECT_RATES.download} credits · delete 1 credit.</p>
    <p>Storage: {PROJECT_RATES.storageMonthly} credits per started 100 MB of total retained data at month-end, charged at 00:00 UTC on the first. Annotation: 150 credits plus 0.01 per alternate allele, rounded up to a whole credit.</p>
    <p>Free accounts: 3 projects, 100 MB retained data, 100 MB uploaded and downloaded per UTC day, and one active run. Transfer and storage limits apply in addition to credit balances.</p>
  </section>;
}
