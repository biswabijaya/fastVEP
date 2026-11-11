import {
  requireUser,
  errorResponse,
  limitedText,
} from "../../../../src/server/admin";
import { reconcileInvoice } from "../../../../src/server/payments";
import { ServiceError } from "../../../../src/lib/credits";
export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    let body;
    try {
      body = JSON.parse(await limitedText(request, 4096));
    } catch {
      throw new ServiceError(400, "Invalid payment reference.");
    }
    if (typeof body?.id !== "string")
      throw new ServiceError(400, "Invalid payment reference.");
    return Response.json(
      { status: await reconcileInvoice(user, body.id) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
