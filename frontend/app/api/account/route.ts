import { displayPayment } from "../../../src/server/payment-pricing";
import type { Invoice } from "../../../src/server/payments";
import {
  accountRef,
  errorResponse,
  requireUser,
} from "../../../src/server/admin";
import { batchView, getAccount, type Batch } from "../../../src/server/wallet";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const user = await requireUser(request),
      account = await getAccount(user);
    const [jobs, payments] = await Promise.all([
      accountRef(user.uid)
        .collection("jobs")
        .orderBy("createdAt", "desc")
        .limit(25)
        .get(),
      accountRef(user.uid)
        .collection("payments")
        .orderBy("createdAt", "desc")
        .limit(25)
        .get(),
    ]);
    return Response.json(
      {
        account,
        jobs: jobs.docs.map((doc) => batchView(doc.data() as Batch)),
        payments: payments.docs.map((doc) => {
          const p = doc.data() as Invoice;
          return {
            id: p.id,
            cadence: p.cadence,
            planId: p.planId || "research-20",
            tier: p.tier || "research",
            monthlyCredits: p.monthlyCredits ?? 4000,
            ...displayPayment(p),
            status: p.status,
            createdAt: p.createdAt,
            termEnd: p.termEnd || null,
          };
        }),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
