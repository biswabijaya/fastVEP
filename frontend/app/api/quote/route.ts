import {
  credits,
  inspectVcf,
  quoteUnits,
  BATCH_CREDITS,
  ServiceError,
} from "../../../src/lib/credits";
import {
  errorResponse,
  limitedText,
  requireUser,
} from "../../../src/server/admin";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    await requireUser(request);
    let payload;
    try {
      payload = JSON.parse(await limitedText(request));
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      throw new ServiceError(400, "Provide a valid JSON request.");
    }
    const counts = inspectVcf(payload?.vcf);
    return Response.json(
      {
        ...counts,
        batchCredits: BATCH_CREDITS,
        variantCredits: credits(quoteUnits(counts.variantCount)),
        totalCredits: credits(quoteUnits(counts.variantCount)),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
