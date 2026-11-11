export async function GET() {
  return Response.json(
    {
      enabled: process.env.FASTVEP_PAYMENTS_ENABLED === "true",
      provider: "Amazon Payment Services",
      renewal: "manual",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
