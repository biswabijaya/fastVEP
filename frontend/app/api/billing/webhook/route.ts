import { errorResponse, limitedText } from "../../../../src/server/admin";
import { parseFields } from "../../../../src/server/aps";
import { confirmPayment } from "../../../../src/server/payments";

import { ServiceError } from "../../../../src/lib/credits";
export async function POST(request: Request) {
  try {
    const text = await limitedText(request, 65536);
    let fields;
    if (request.headers.get("content-type")?.includes("application/json"))
      fields = parseFields(JSON.parse(text));
    else {
      const params = new URLSearchParams(text);
      const entries = [...params.entries()];
      if (new Set(entries.map(([k]) => k)).size !== entries.length)
        throw new ServiceError(400, "Duplicate payment response fields.");
      fields = parseFields(Object.fromEntries(entries));
    }
    const status = await confirmPayment(fields);
    return Response.json(
      { status },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
