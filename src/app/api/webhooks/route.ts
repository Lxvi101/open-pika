import { readWebhookBody, recordWebhookReceipt, verifyWebhookSignature, WebhookError } from "@/generation/webhooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const raw = await readWebhookBody(request.body);
    const signed = verifyWebhookSignature(raw, request.headers);
    let payload: unknown;
    try { payload = JSON.parse(raw); }
    catch { throw new WebhookError("Webhook body must be valid JSON", 400); }
    const eventType = payload && typeof payload === "object" && !Array.isArray(payload)
      ? ["type", "event", "event_type"].map((key) => (payload as Record<string, unknown>)[key]).find((value) => typeof value === "string") as string | undefined
      : undefined;
    const result = await recordWebhookReceipt({
      ...signed,
      receivedAt: new Date().toISOString(),
      eventType: eventType ?? null,
      payload,
    });
    return Response.json({ received: true, duplicate: result.duplicate });
  } catch (caught) {
    const status = caught instanceof WebhookError ? caught.status : 500;
    const message = caught instanceof Error ? caught.message : "Webhook delivery failed";
    console.error("[webhook] receipt failed", { status, message });
    return Response.json({ message }, { status });
  }
}
