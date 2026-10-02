import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const MAX_BODY_BYTES = 1024 * 1024;
const MAX_RECEIPTS = 500;
const MAX_RECEIPT_STORE_BYTES = 10 * 1024 * 1024;
const TIMESTAMP_TOLERANCE_SECONDS = 5 * 60;

export type WebhookReceipt = {
  webhookId: string;
  timestamp: number;
  receivedAt: string;
  eventType: string | null;
  payload: unknown;
};

export class WebhookError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

let writeQueue: Promise<void> = Promise.resolve();

/** Verify the Standard Webhooks v1 signature over the exact raw request bytes. */
export function verifyWebhookSignature(
  raw: string,
  headers: Headers,
  secret = process.env.PIKA_WEBHOOK_SECRET,
  nowSeconds = Math.floor(Date.now() / 1000),
): { webhookId: string; timestamp: number } {
  if (!secret) throw new WebhookError("Webhook receiver is not configured", 503);
  const webhookId = headers.get("webhook-id")?.trim();
  const timestampText = headers.get("webhook-timestamp");
  const signatureHeader = headers.get("webhook-signature") ?? "";
  if (!webhookId || webhookId.length > 256 || !timestampText || !/^\d{1,12}$/.test(timestampText)) {
    throw new WebhookError("Missing or invalid webhook signature headers", 400);
  }
  const timestamp = Number(timestampText);
  if (Math.abs(nowSeconds - timestamp) > TIMESTAMP_TOLERANCE_SECONDS) {
    throw new WebhookError("Webhook timestamp is outside the allowed window", 400);
  }
  const encodedSecret = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  let key: Buffer;
  try { key = Buffer.from(encodedSecret, "base64"); } catch { throw new WebhookError("Invalid webhook secret", 503); }
  if (key.byteLength === 0) throw new WebhookError("Invalid webhook secret", 503);
  const expected = createHmac("sha256", key).update(`${webhookId}.${timestampText}.${raw}`).digest();
  const valid = signatureHeader.split(/\s+/).some((entry) => {
    const [version, supplied] = entry.split(",", 2);
    if (version !== "v1" || !supplied) return false;
    let candidate: Buffer;
    try { candidate = Buffer.from(supplied, "base64"); } catch { return false; }
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  });
  if (!valid) throw new WebhookError("Invalid webhook signature", 401);
  return { webhookId, timestamp };
}

export async function readWebhookBody(body: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!body) throw new WebhookError("Missing webhook body", 400);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new WebhookError("Webhook body exceeds 1 MB", 413);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new WebhookError("Webhook body must be valid UTF-8", 400); }
}

/**
 * Store atomically before ACK so a single self-hosted process can deduplicate
 * after restart. Set PIKA_WEBHOOK_STATE_DIR to a persistent volume; serverless
 * and multi-instance deployments need a shared transactional store instead.
 */
export async function recordWebhookReceipt(receipt: WebhookReceipt): Promise<{ duplicate: boolean }> {
  let duplicate = false;
  const operation = writeQueue.then(async () => {
    const file = receiptFile();
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const existing = await readReceipts(file);
    if (existing.some((item) => item.webhookId === receipt.webhookId)) {
      duplicate = true;
      return;
    }
    const next = [...existing, receipt].slice(-MAX_RECEIPTS);
    while (next.length > 1 && Buffer.byteLength(JSON.stringify(next)) > MAX_RECEIPT_STORE_BYTES) next.shift();
    const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, JSON.stringify(next), { mode: 0o600 });
    await rename(temporary, file);
  });
  writeQueue = operation.catch(() => {});
  await operation;
  return { duplicate };
}

export async function listWebhookReceipts(): Promise<WebhookReceipt[]> {
  return readReceipts(receiptFile());
}

function receiptFile(): string {
  const directory = process.env.PIKA_WEBHOOK_STATE_DIR || path.join(process.cwd(), ".data", "webhook-receipts");
  return path.join(directory, "receipts.json");
}

async function readReceipts(file: string): Promise<WebhookReceipt[]> {
  try {
    const value: unknown = JSON.parse(await readFile(file, "utf8"));
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is WebhookReceipt =>
      item !== null && typeof item === "object" &&
      typeof item.webhookId === "string" && typeof item.timestamp === "number" &&
      typeof item.receivedAt === "string" && "payload" in item,
    ).slice(-MAX_RECEIPTS);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new WebhookError("Could not read webhook receipt store", 500);
  }
}
