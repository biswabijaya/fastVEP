import {
  requireUser,
  errorResponse,
  limitedText,
} from "../../../../src/server/admin";
import { ServiceError } from "../../../../src/lib/credits";
import { prepareCheckout } from "../../../../src/server/payments";
export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    if (process.env.FASTVEP_PAYMENTS_ENABLED !== "true")
      throw new ServiceError(
        503,
        "Payments are being verified with Amazon Payment Services. No payment was taken.",
        "checkout_not_ready",
      );
    let body;
    try {
      body = JSON.parse(await limitedText(request, 4096));
    } catch {
      throw new ServiceError(400, "Choose a billing period.");
    }
    if (
      !["monthly", "annual"].includes(body?.cadence) ||
      body?.acceptTerm !== true
    )
      throw new ServiceError(
        400,
        "Confirm the selected term and manual renewal before checkout.",
      );
    return Response.json(await prepareCheckout(user, body.cadence), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
