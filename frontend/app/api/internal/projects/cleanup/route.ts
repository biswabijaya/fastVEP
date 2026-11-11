import { OAuth2Client } from "google-auth-library";
import { errorResponse } from "../../../../../src/server/admin";
import { ServiceError } from "../../../../../src/lib/credits";
import { cleanupExpiredProjects } from "../../../../../src/server/project-cleanup";
export const runtime = "nodejs";
const audience = "https://fastvep.enigmagenomics.com/api/internal/projects/cleanup";
const scheduler = "fastvep-project-cleanup@enigmagenomics.iam.gserviceaccount.com";
export async function POST(request: Request) {
  try {
    const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
    if (!token) throw new ServiceError(401, "Authentication required.");
    try {
      const ticket = await new OAuth2Client().verifyIdToken({ idToken: token, audience });
      const identity = ticket.getPayload();
      if (identity?.email !== scheduler || !identity.email_verified) throw new Error();
    } catch { throw new ServiceError(403, "Scheduler identity required."); }
    return Response.json(await cleanupExpiredProjects(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
