import { GoogleAuth } from "google-auth-library";
import {
  accountKey,
  errorResponse,
  limitedText,
  requireUser,
  resultsBucket,
} from "../../../../src/server/admin";
import {
  batchView,
  fingerprint,
  reserveBatch,
  settleBatch,
} from "../../../../src/server/wallet";
import {
  credits,
  inspectVcf,
  quoteUnits,
  RESULT_TTL_MS,
  ServiceError,
} from "../../../../src/lib/credits";
const auth = new GoogleAuth();
export const runtime = "nodejs";
const metadata = new Map<string, { expires: number; value: unknown }>();
async function engine(path: string, body?: string) {
  const base = process.env.FASTVEP_API_URL;
  if (!base)
    throw new ServiceError(
      503,
      "The annotation service is being prepared. Try again later.",
    );
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (process.env.FASTVEP_API_AUDIENCE) {
    const client = await auth.getIdTokenClient(
      process.env.FASTVEP_API_AUDIENCE,
    );
    const identity = await client.getRequestHeaders();
    const authorization = identity.get("authorization");
    if (authorization) headers.Authorization = authorization;
  }
  return fetch(`${base.replace(/\/$/, "")}/api/${path}`, {
    method: body ? "POST" : "GET",
    headers,
    body,
    cache: "no-store",
    signal: AbortSignal.timeout(95000),
  });
}
async function forward(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  let reserved: { uid: string; id: string } | null = null;
  try {
    const { path } = await context.params;
    if (
      path.length !== 1 ||
      !["status", "genomes", "annotate"].includes(path[0]) ||
      (request.method === "POST") !== (path[0] === "annotate")
    )
      throw new ServiceError(404, "Unknown endpoint.");
    const user = await requireUser(request);
    if (request.method === "GET") {
      const cached = metadata.get(path[0]);
      if (cached && cached.expires > Date.now())
        return Response.json(cached.value, {
          headers: { "Cache-Control": "private, no-store" },
        });
      const response = await engine(path[0]);
      if (
        !response.ok ||
        !response.headers.get("content-type")?.includes("application/json")
      )
        throw new ServiceError(
          503,
          "The annotation service is temporarily unavailable. Try again shortly.",
        );
      const value = await response.json();
      metadata.set(path[0], { value, expires: Date.now() + 30000 });
      return Response.json(value, {
        headers: { "Cache-Control": "private, no-store" },
      });
    }
    let input: Record<string, unknown>;
    try {
      input = JSON.parse(await limitedText(request));
      if (!input || typeof input !== "object" || Array.isArray(input))
        throw new Error();
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      throw new ServiceError(400, "Provide a valid JSON request.");
    }
    const counts = inspectVcf(input.vcf),
      charge = quoteUnits(counts.variantCount);
    const payload: Record<string, unknown> = {
      vcf: input.vcf,
      genome: input.genome ?? null,
      acmg: false,
    };
    if (
      payload.genome !== null &&
      (typeof payload.genome !== "string" ||
        !/^[a-zA-Z0-9_.-]{1,100}$/.test(payload.genome))
    )
      throw new ServiceError(400, "Select a valid reference genome.");
    if (input.acmg === true)
      throw new ServiceError(
        422,
        "ACMG classification is unavailable until all required evidence sources are loaded. No credits were charged.",
      );
    let picks = 0;
    for (const key of [
      "pick",
      "pick_allele",
      "pick_allele_gene",
      "flag_pick",
      "flag_pick_allele",
      "flag_pick_allele_gene",
    ]) {
      if (input[key] !== undefined && typeof input[key] !== "boolean")
        throw new ServiceError(400, "Invalid transcript selection.");
      payload[key] = input[key] ?? false;
      if (payload[key]) picks++;
    }
    if (picks > 1)
      throw new ServiceError(400, "Choose one transcript selection mode.");
    const id = request.headers.get("idempotency-key") || "";
    const reservation = await reserveBatch(user, {
      id,
      fingerprint: fingerprint(user.uid, payload),
      variants: counts.variantCount,
      records: counts.recordCount,
      genome: payload.genome as string | null,
      charge,
    });
    if (reservation.replay) {
      const job = reservation.job;
      if (job.status === "pending")
        return Response.json(
          { job: batchView(job) },
          { status: 202, headers: { "Cache-Control": "private, no-store" } },
        );
      if (job.status === "refunded")
        throw new ServiceError(
          409,
          job.failure || "This batch was refunded. Start a new batch.",
          "batch_refunded",
        );
      if (
        !job.resultPath ||
        !job.resultExpiresAt ||
        job.resultExpiresAt < Date.now()
      )
        throw new ServiceError(
          410,
          "This completed result expired. It will not be charged again. Start a new batch if you need to annotate it again.",
        );
      const [data] = await resultsBucket().file(job.resultPath).download();
      return new Response(new Uint8Array(data), {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "private, no-store",
        },
      });
    }
    reserved = { uid: user.uid, id };
    const response = await engine("annotate", JSON.stringify(payload));
    if (!response.headers.get("content-type")?.includes("application/json"))
      throw new ServiceError(
        503,
        "The annotation service is temporarily unavailable. Your unexpired credits will be returned.",
      );
    const text = await limitedText(
      new Request("http://result.invalid", {
        method: "POST",
        body: response.body,
        duplex: "half",
      } as RequestInit & { duplex: string }),
      16777216,
    );
    const result = JSON.parse(text);
    if (!response.ok)
      throw new ServiceError(
        response.status >= 500 ? 503 : response.status,
        typeof result.error === "string"
          ? result.error
          : "The engine could not annotate this batch. Your unexpired credits will be returned.",
      );
    if (!Array.isArray(result.results) || result.count !== counts.recordCount)
      throw new ServiceError(
        503,
        "The engine returned an incomplete result. Your unexpired credits will be returned.",
      );
    const expiresAt = Date.now() + RESULT_TTL_MS;
    const output = {
      ...result,
      billing: {
        jobId: id,
        totalCredits: credits(charge),
        freeCredits: credits(reservation.job.debit.freeUnits),
        subscriptionCredits: credits(reservation.job.debit.paidUnits),
        variantCount: counts.variantCount,
        resultExpiresAt: expiresAt,
      },
    };
    const resultPath = `${accountKey(user.uid)}/${id}.json`;
    await resultsBucket()
      .file(resultPath)
      .save(JSON.stringify(output), {
        resumable: false,
        preconditionOpts: { ifGenerationMatch: 0 },
        metadata: {
          contentType: "application/json",
          cacheControl: "private, no-store",
        },
      });
    const settled = await settleBatch(user.uid, id, {
      path: resultPath,
      expiresAt,
    });
    if (!settled) {
      await resultsBucket().file(resultPath).delete({ ignoreNotFound: true });
      throw new ServiceError(
        409,
        "This batch was already reconciled. Check your usage history.",
      );
    }
    reserved = null;
    return Response.json(output, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (reserved) {
      try {
        await settleBatch(reserved.uid, reserved.id, {
          failure:
            error instanceof ServiceError
              ? error.message
              : "This batch failed. Your unexpired credits were returned.",
        });
      } catch {
        console.error("fastvep_batch_reconciliation_pending");
      }
    }
    return errorResponse(error);
  }
}
export const GET = forward;
export const POST = forward;
