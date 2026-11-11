import { randomUUID } from "node:crypto";
import { accountRef, database, errorResponse, limitedText, requireUser } from "../../../src/server/admin";
import { getAccount, type Account } from "../../../src/server/wallet";
import { normalizeWallet, ServiceError, walletView } from "../../../src/lib/credits";
import { FREE_PROJECT_LIMITS, PROJECT_POLICY_VERSION, PROJECT_RATES, projectDetails, projectExpiry, freeProjectExpiry, type Project } from "../../../src/lib/project-policy";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const account = await getAccount(user);
    const result = await accountRef(user.uid).collection("projects").orderBy("createdAt", "desc").limit(100).get();
    return Response.json({
      projects: result.docs.map((doc) => {
        const project = doc.data() as Project;
        return { ...project, expiresAt: projectExpiry(project, account.plan === "free") };
      }).filter((project) => project.expiresAt === null || project.expiresAt > Date.now()),
      policy: { version: PROJECT_POLICY_VERSION, rates: PROJECT_RATES, freeLimits: FREE_PROJECT_LIMITS },
      plan: account.plan,
      capabilities: { uploads: false, runs: false },
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const details = projectDetails(JSON.parse(await limitedText(request, 8192)));
    await getAccount(user);
    const ref = accountRef(user.uid);
    const project: Project = { id: randomUUID(), ...details, createdAt: Date.now(), updatedAt: Date.now(), expiresAt: null };
    await database().runTransaction(async (tx) => {
      const [accountSnapshot, projects] = await Promise.all([
        tx.get(ref), tx.get(ref.collection("projects").limit(1000)),
      ]);
      const account = accountSnapshot.data() as Account;
      const now = Date.now();
      const free = walletView(normalizeWallet(account.wallet, now), now).plan === "free";
      const count = projects.docs.filter((doc) => {
        const expiresAt = projectExpiry(doc.data() as Project, free);
        return expiresAt === null || expiresAt > now;
      }).length;
      if (count >= (free ? FREE_PROJECT_LIMITS.projects : 100))
        throw new ServiceError(403, "Your account has reached its project limit.", "project_limit");
      project.expiresAt = free ? freeProjectExpiry(project.createdAt) : null;
      tx.create(ref.collection("projects").doc(project.id), project);
    });
    return Response.json({ project }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return errorResponse(error instanceof SyntaxError ? new ServiceError(400, "Provide valid project details.") : error);
  }
}
