import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { getAuth } from "firebase-admin/auth";
import { accountRef, adminApp } from "../src/server/admin";
if (
  !process.env.FIRESTORE_EMULATOR_HOST ||
  !process.env.FIREBASE_STORAGE_EMULATOR_HOST ||
  process.env.GOOGLE_CLOUD_PROJECT !== "demo-fastvep"
)
  throw new Error("Requires demo auth, firestore and storage emulators.");
const base = "http://127.0.0.1:3102";
let app: ChildProcess;
let token: string, otherToken: string;
let calls = 0;
const engine = createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  let body = "";
  for await (const chunk of req) body += chunk;
  if (req.url === "/api/annotate") {
    calls++;
    const payload = JSON.parse(body);
    if (payload.vcf.includes("FAIL")) {
      res.statusCode = 422;
      res.end(JSON.stringify({ error: "Synthetic engine failure" }));
    } else
      res.end(
        JSON.stringify({
          count: 1,
          results: [
            { seq_region_name: "17", start: 43124025, allele_string: "A/G" },
          ],
        }),
      );
  } else
    res.end(
      JSON.stringify({ version: "test", transcripts: 1, has_fasta: true }),
    );
});
async function identity(uid: string) {
  const auth = getAuth(adminApp());
  await auth.createUser({
    uid,
    email: `${uid}@example.invalid`,
    emailVerified: true,
    password: "test-password-123",
  });
  const r = await fetch(
    `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: `${uid}@example.invalid`,
        password: "test-password-123",
        returnSecureToken: true,
      }),
    },
  );
  return (await r.json()).idToken as string;
}
const vcf = "17\t43124025\t.\tA\tG\t.\tPASS\t.";
const request = (path: string, body?: unknown, id?: string, auth = token) =>
  fetch(`${base}${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${auth}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(id ? { "Idempotency-Key": id } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
test.before(async () => {
  await new Promise<void>((resolve) =>
    engine.listen(18081, "127.0.0.1", resolve),
  );
  token = await identity("api-owner");
  otherToken = await identity("api-other");
  app = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "start", "-p", "3102"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        FASTVEP_API_URL: "http://127.0.0.1:18081",
        FASTVEP_API_AUDIENCE: "",
        FASTVEP_RESULTS_BUCKET: "demo-fastvep-results",
      },
      stdio: "ignore",
    },
  );
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(base)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Test app failed to start");
});
test("server routes enforce sign-in and verified identity", async () => {
  for (const path of [
    "/api/account",
    "/api/fastvep/status",
    "/api/billing/cancel?id=fv-11111111111111111111111111111111",
    "/api/jobs/aaaaaaaaaaaaaaaa",
  ])
    assert.equal((await fetch(base + path)).status, 401);
});
test("quotes do not debit, completed retries do not charge, and downloads are private", async () => {
  const q = await request("/api/quote", { vcf });
  assert.equal(q.status, 200);
  const quote = await q.json();
  assert.equal(quote.batchCredits, 0);
  assert.equal(quote.variantCredits, 1);
  assert.equal(quote.totalCredits, 1);
  assert.equal(
    (await request("/api/account").then((r) => r.json())).account.dailyCredits,
    300,
  );
  const id = "api-batch-aaaaaaaaaaaaaaaa";
  const r = await request("/api/fastvep/annotate", { vcf }, id);
  assert.equal(r.status, 200, await r.clone().text());
  const result = await r.json();
  assert.equal(result.billing.totalCredits, 1);
  assert.equal(
    (await request("/api/account").then((r) => r.json())).account.dailyCredits,
    299,
  );
  assert.equal(
    (await request("/api/fastvep/annotate", { vcf }, id)).status,
    200,
  );
  assert.equal(calls, 1);
  assert.equal(
    (await request(`/api/jobs/${id}`, undefined, undefined, otherToken)).status,
    404,
  );
  assert.equal((await request(`/api/jobs/${id}`)).status, 200);
  assert.equal(
    (
      await request(
        "/api/fastvep/annotate",
        { vcf },
        "api-batch-bbbbbbbbbbbbbbbb",
      )
    ).status,
    200,
  );
  assert.equal(calls, 2);
  assert.equal((await (await request("/api/account")).json()).account.dailyCredits, 298);
});
test("engine failures refund credits and never expose a result", async () => {
  const id = "api-failure-aaaaaaaaaaaa";
  const r = await request(
    "/api/fastvep/annotate",
    { vcf: vcf.replace("PASS", "FAIL") },
    id,
    otherToken,
  );
  assert.equal(r.status, 422);
  assert.equal(
    (
      await request("/api/account", undefined, undefined, otherToken).then(
        (r) => r.json(),
      )
    ).account.dailyCredits,
    300,
  );
  const history = await request(
    `/api/jobs/${id}`,
    undefined,
    undefined,
    otherToken,
  ).then((r) => r.json());
  assert.equal(history.job.status, "refunded");
  assert.equal(history.results, undefined);
});
test.after(async () => {
  app?.kill("SIGTERM");
  await new Promise<void>((resolve) => engine.close(() => resolve()));
});

test("projects are owner scoped and concurrent creation enforces the free project cap", async () => {
  assert.equal((await fetch(`${base}/api/projects`)).status, 401);
  const responses = await Promise.all(Array.from({ length: 5 }, (_, i) => request("/api/projects", { name: `Study ${i}` })));
  assert.equal(responses.filter((response) => response.status === 201).length, 3);
  assert.equal(responses.filter((response) => response.status === 403).length, 2);
  const mine = await (await request("/api/projects")).json();
  assert.equal(mine.projects.length, 3);
  for (const project of mine.projects) {
    const created = new Date(project.createdAt);
    assert.equal(project.expiresAt, Date.UTC(created.getUTCFullYear(), created.getUTCMonth() + 1, 1));
  }
  assert.equal(mine.capabilities.uploads, false);
  assert.equal(mine.capabilities.runs, false);
  const theirs = await (await request("/api/projects", undefined, undefined, otherToken)).json();
  assert.equal(theirs.projects.length, 0);
  assert.equal((await request("/api/projects", { name: " " }, undefined, otherToken)).status, 400);
});


test("expired projects are inaccessible, free capacity is restored, and collection removes their records without charging", async () => {
  const { cleanupExpiredProjects } = await import("../src/server/project-cleanup");
  const ref = accountRef("api-owner").collection("projects").doc("expired-project");
  await ref.set({ id: ref.id, name: "Expired", description: "", createdAt: 1, updatedAt: 1, expiresAt: 2 });
  await ref.collection("runs").doc("old-run").set({ status: "complete" });
  const before = (await (await request("/api/account")).json()).account.totalCredits;
  const listed = await (await request("/api/projects")).json();
  assert.equal(listed.projects.some((project: { id: string }) => project.id === ref.id), false);
  // One of the three successful concurrent creations may have any name.
  const active = (await accountRef("api-owner").collection("projects").get()).docs.find((doc) => doc.id !== ref.id);
  assert.ok(active);
  await active.ref.update({ expiresAt: 2 });
  assert.equal((await request("/api/projects", { name: "New month project" })).status, 201);
  const { deleted } = await cleanupExpiredProjects();
  assert.ok(deleted >= 1);
  assert.equal((await ref.get()).exists, false);
  assert.equal((await ref.collection("runs").get()).empty, true);
  assert.equal((await (await request("/api/account")).json()).account.totalCredits, before);
  assert.equal((await fetch(`${base}/api/internal/projects/cleanup`, { method: "POST" })).status, 401);
  assert.equal((await fetch(`${base}/api/internal/projects/cleanup`, { method: "POST", headers: { Authorization: `Bearer ${token}` } })).status, 403);
});
