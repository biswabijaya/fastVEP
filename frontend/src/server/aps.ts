import { createHash, timingSafeEqual } from "node:crypto";
import { GoogleAuth } from "google-auth-library";
import { ServiceError } from "../lib/credits";
export type Fields = Record<string, string>;
export function signature(fields: Fields, phrase: string) {
  return createHash("sha256")
    .update(
      phrase +
        Object.keys(fields)
          .filter((k) => k !== "signature")
          .sort()
          .map((k) => `${k}=${fields[k]}`)
          .join("") +
        phrase,
    )
    .digest("hex");
}
export function verifySignature(fields: Fields, phrase: string) {
  if (!/^[a-fA-F0-9]{64}$/.test(fields.signature || "")) return false;
  return timingSafeEqual(
    Buffer.from(fields.signature, "hex"),
    Buffer.from(signature(fields, phrase), "hex"),
  );
}
export function parseFields(value: unknown): Fields {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ServiceError(400, "Invalid payment response.");
  const fields: Fields = {};
  for (const [k, v] of Object.entries(value)) {
    if (v === null || v === undefined) continue;
    if (
      !/^[a-zA-Z0-9_]+$/.test(k) ||
      !["string", "number", "boolean"].includes(typeof v)
    )
      throw new ServiceError(400, "Invalid payment response.");
    fields[k] = String(v);
  }
  return fields;
}
export type ApsConfig = {
  access: string;
  merchant: string;
  requestPhrase: string;
  responsePhrase: string;
};
let cached: { expires: number; config: ApsConfig } | undefined;
export async function apsConfig(): Promise<ApsConfig> {
  if (process.env.GOOGLE_CLOUD_PROJECT?.startsWith("demo-"))
    throw new ServiceError(
      503,
      "Production payment secrets are unavailable in demo projects.",
    );
  if (cached && cached.expires > Date.now()) return cached.config;
  const auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  const client = await auth.getClient();
  const names = [
    "access-code",
    "merchant-identifier",
    "request-phrase",
    "response-phrase",
  ];
  const values = await Promise.all(
    names.map(async (name) => {
      const r = await client.request<{ payload: { data: string } }>({
        url: `https://secretmanager.googleapis.com/v1/projects/enigmagenomics/secrets/fastvep-aps-${name}/versions/latest:access`,
      });
      const value = Buffer.from(r.data.payload.data, "base64").toString("utf8");
      if (!value)
        throw new ServiceError(
          503,
          "Payment configuration is incomplete. No payment was taken.",
        );
      return value;
    }),
  );
  const config = {
    access: values[0],
    merchant: values[1],
    requestPhrase: values[2],
    responsePhrase: values[3],
  };
  cached = { config, expires: Date.now() + 300000 };
  return config;
}
export const checkoutUrl = () =>
  process.env.FASTVEP_APS_MODE === "sandbox"
    ? "https://sbcheckout.payfort.com/FortAPI/paymentPage"
    : "https://checkout.payfort.com/FortAPI/paymentPage";
export const canonicalOrigin = "https://fastvep.enigmagenomics.com";
export function signedRequest(fields: Fields, config: ApsConfig): Fields {
  const request = {
    ...fields,
    access_code: config.access,
    merchant_identifier: config.merchant,
    language: "en",
  };
  return { ...request, signature: signature(request, config.requestPhrase) };
}
export async function checkPayment(
  reference: string,
  config: ApsConfig,
): Promise<Fields> {
  const url =
    process.env.FASTVEP_APS_MODE === "sandbox"
      ? "https://sbpaymentservices.payfort.com/FortAPI/paymentApi"
      : "https://paymentservices.payfort.com/FortAPI/paymentApi";
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(
      signedRequest(
        { query_command: "CHECK_STATUS", merchant_reference: reference },
        config,
      ),
    ),
    signal: AbortSignal.timeout(20000),
    cache: "no-store",
  });
  if (!response.ok)
    throw new ServiceError(
      503,
      "Payment confirmation is delayed. Check your account shortly.",
    );
  const fields = parseFields(await response.json());
  if (
    !verifySignature(fields, config.responsePhrase) ||
    fields.merchant_identifier !== config.merchant ||
    fields.merchant_reference !== reference
  )
    throw new ServiceError(503, "Payment confirmation could not be verified.");
  return fields;
}
export function capturedPayment(check: Fields, amount: number) {
  return (
    check.response_code === "12000" &&
    check.transaction_code === "14000" &&
    /^\d+$/.test(check.captured_amount || "") &&
    Number(check.captured_amount) === amount &&
    /^\d+$/.test(check.refunded_amount || "0") &&
    Number(check.refunded_amount || 0) === 0 &&
    /^\d+$/.test(check.fort_id || "")
  );
}
