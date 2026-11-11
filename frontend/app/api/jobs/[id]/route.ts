import {
  accountRef,
  errorResponse,
  requireUser,
  resultsBucket,
} from "../../../../src/server/admin";
import {
  batchView,
  getAccount,
  type Batch,
} from "../../../../src/server/wallet";
import { ServiceError } from "../../../../src/lib/credits";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser(request);
    await getAccount(user);
    const { id } = await context.params;
    if (!/^[a-zA-Z0-9_-]{16,80}$/.test(id))
      throw new ServiceError(404, "Batch not found.");
    const snapshot = await accountRef(user.uid)
      .collection("jobs")
      .doc(id)
      .get();
    if (!snapshot.exists) throw new ServiceError(404, "Batch not found.");
    const job = snapshot.data() as Batch;
    if (job.status !== "complete")
      return Response.json(
        { job: batchView(job) },
        {
          status: job.status === "pending" ? 202 : 200,
          headers: { "Cache-Control": "private, no-store" },
        },
      );
    if (
      !job.resultPath ||
      !job.resultExpiresAt ||
      job.resultExpiresAt < Date.now()
    )
      throw new ServiceError(
        410,
        "The result download expired after 24 hours. Your usage record is still available.",
      );
    const [data] = await resultsBucket().file(job.resultPath).download();
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="vep-${id}.json"`,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
