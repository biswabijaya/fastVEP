import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { createHash } from "node:crypto";
import { ServiceError } from "../lib/credits";
const projectId = process.env.GOOGLE_CLOUD_PROJECT || "enigmagenomics";
export function adminApp() {
  return (
    getApps().find((app) => app.name === "fastvep-server") ||
    initializeApp(
      {
        projectId,
        ...(process.env.FIRESTORE_EMULATOR_HOST
          ? {}
          : { credential: applicationDefault() }),
      },
      "fastvep-server",
    )
  );
}
export const database = () =>
  getFirestore(adminApp(), process.env.FASTVEP_DATABASE || "fastvep");
export const resultsBucket = () =>
  getStorage(adminApp()).bucket(
    process.env.FASTVEP_RESULTS_BUCKET || "fastvep-results-903636395933",
  );
export const accountKey = (uid: string) =>
  createHash("sha256").update(uid).digest("hex");
export const accountRef = (uid: string) =>
  database().collection("accounts").doc(accountKey(uid));
export async function requireUser(request: Request) {
  const token = request.headers
    .get("authorization")
    ?.match(/^Bearer (.+)$/)?.[1];
  if (!token)
    throw new ServiceError(401, "Sign in to continue.", "sign_in_required");
  try {
    const user = await getAuth(adminApp()).verifyIdToken(token, true);
    if (!user.email_verified || !user.email)
      throw new ServiceError(
        403,
        "Verify your email address before using credits.",
        "email_verification_required",
      );
    return {
      uid: user.uid,
      email: user.email,
      name: typeof user.name === "string" ? user.name : "",
    };
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    throw new ServiceError(
      401,
      "Your session expired. Sign in again.",
      "sign_in_required",
    );
  }
}
export function errorResponse(error: unknown) {
  if (error instanceof ServiceError)
    return Response.json(
      { error: error.message, code: error.code },
      {
        status: error.status,
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  console.error(
    "fastvep_service_error",
    error instanceof Error ? error.constructor.name : "UnknownError",
  );
  return Response.json(
    { error: "The service could not complete this request. Please try again." },
    { status: 503, headers: { "Cache-Control": "private, no-store" } },
  );
}
export async function limitedText(request: Request, maxBytes = 1048576) {
  if (Number(request.headers.get("content-length") || 0) > maxBytes)
    throw new ServiceError(
      413,
      "Input exceeds 1 MiB. Split the file into smaller batches.",
    );
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader)
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new ServiceError(413, "Input exceeds the allowed size.");
      }
      chunks.push(chunk.value);
    }
  return Buffer.concat(chunks).toString("utf8");
}
