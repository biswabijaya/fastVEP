import { NextRequest } from "next/server";
import { GoogleAuth } from "google-auth-library";
const auth = new GoogleAuth();
export const runtime = "nodejs";
const allowed = new Set(["status", "genomes", "annotate"]);
async function forward(
  req: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params;
  if (
    path.length !== 1 ||
    !allowed.has(path[0]) ||
    (req.method === "POST") !== (path[0] === "annotate")
  )
    return Response.json({ error: "Unknown endpoint" }, { status: 404 });
  const base = process.env.FASTVEP_API_URL;
  if (!base)
    return Response.json(
      {
        error:
          "The annotation backend is being prepared. Please try again later.",
      },
      { status: 503 },
    );
  try {
    if (Number(req.headers.get("content-length") || 0) > 1048576)
      return Response.json({ error: "Input exceeds 1 MiB" }, { status: 413 });
    const body = req.method === "POST" ? await req.text() : undefined;
    if (body && Buffer.byteLength(body) > 1048576)
      return Response.json({ error: "Input exceeds 1 MiB" }, { status: 413 });
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
    const response = await fetch(`${base.replace(/\/$/, "")}/api/${path[0]}`, {
      method: req.method,
      headers,
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(95000),
    });
    return new Response(response.body, {
      status: response.status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return Response.json(
      { error: "The annotation service is temporarily unavailable." },
      { status: 502 },
    );
  }
}
export const GET = forward;
export const POST = forward;
