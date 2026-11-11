import {
  errorResponse,
  limitedText,
  requireUser,
} from "../../../../src/server/admin";
import {
  cancelSubscription,
  getCancellationQuote,
} from "../../../../src/server/cancellations";
import { assertCancellationAmount } from "../../../../src/lib/refunds";
import { ServiceError } from "../../../../src/lib/credits";
export async function GET(request: Request) {
  try {
    const user = await requireUser(request),
      id = new URL(request.url).searchParams.get("id") || "";
    return Response.json(await getCancellationQuote(user, id), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    let body;
    try {
      body = JSON.parse(await limitedText(request, 4096));
    } catch {
      throw new ServiceError(400, "Review the cancellation before confirming.");
    }
    if (typeof body?.id !== "string" || body.confirm !== true)
      throw new ServiceError(400, "Confirm the subscription cancellation.");
    const expected = assertCancellationAmount(body.expectedUsdCents);
    return Response.json(
      { cancellation: await cancelSubscription(user, body.id, expected) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
