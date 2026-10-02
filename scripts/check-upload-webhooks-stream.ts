import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHmac } from "node:crypto";

import { MAX_UPLOAD_BYTES, readUploadBody, validateUploadHeaders } from "../src/generation/upload";
import {
  readWebhookBody,
  recordWebhookReceipt,
  verifyWebhookSignature,
} from "../src/generation/webhooks";
import { chatTextDeltas, consumeChatStream } from "../src/generation/stream";

const ticket = {
  uploadUrl: "https://storage.example/upload",
  url: "https://cdn.example/file",
  headers: { "Content-Type": "image/png", "X-Signature": "signed" },
  contentType: "image/png",
  sizeBytes: 3,
};
assert.equal(validateUploadHeaders("image/png", "3", ticket), 3);
assert.throws(() => validateUploadHeaders("image/png", "4", ticket), /does not match/);
assert.throws(() => validateUploadHeaders("application/pdf", "3", { ...ticket, contentType: "application/pdf" }), /Unsupported/);
assert.equal(MAX_UPLOAD_BYTES.image, 20 * 1024 * 1024);
assert.equal(MAX_UPLOAD_BYTES.audio, 20 * 1024 * 1024);
assert.equal(MAX_UPLOAD_BYTES.video, 50 * 1024 * 1024);
assert.deepEqual(await readUploadBody(new Response("abc").body, 3), new TextEncoder().encode("abc"));
await assert.rejects(readUploadBody(new Response("abcd").body, 3), /exceeds/);
await assert.rejects(readUploadBody(new Response("ab").body, 3), /length/);

const webhookDirectory = await mkdtemp(path.join(os.tmpdir(), "openpika-webhook-test-"));
const priorStateDir = process.env.PIKA_WEBHOOK_STATE_DIR;
process.env.PIKA_WEBHOOK_STATE_DIR = webhookDirectory;
try {
  const secretBytes = Buffer.from("a local test secret");
  const secret = `whsec_${secretBytes.toString("base64")}`;
  const raw = JSON.stringify({ type: "generation.completed", id: "job-test" });
  const id = "msg-test-1";
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", secretBytes).update(`${id}.${timestamp}.${raw}`).digest("base64");
  const headers = new Headers({ "webhook-id": id, "webhook-timestamp": timestamp, "webhook-signature": `v1,${signature}` });
  const verified = verifyWebhookSignature(raw, headers, secret);
  assert.deepEqual(verified, { webhookId: id, timestamp: Number(timestamp) });
  assert.throws(() => verifyWebhookSignature(raw, new Headers({ ...Object.fromEntries(headers), "webhook-signature": "v1,AAAA" }), secret), /signature/);
  assert.throws(() => verifyWebhookSignature(raw, headers, secret, Number(timestamp) + 301), /outside/);
  assert.equal(await readWebhookBody(new Response(raw).body), raw);
  const receipt = { ...verified, receivedAt: new Date().toISOString(), eventType: "generation.completed", payload: JSON.parse(raw) };
  assert.deepEqual(await recordWebhookReceipt(receipt), { duplicate: false });
  assert.deepEqual(await recordWebhookReceipt(receipt), { duplicate: true });
} finally {
  if (priorStateDir === undefined) delete process.env.PIKA_WEBHOOK_STATE_DIR;
  else process.env.PIKA_WEBHOOK_STATE_DIR = priorStateDir;
  await rm(webhookDirectory, { recursive: true, force: true });
}

const cases = [
  ["openai", 'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\ndata: [DONE]\n\n', "Hi"],
  ["anthropic", 'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}\n\ndata: {"type":"message_stop"}\n\n', "Hi"],
  ["genai", 'data: {"candidates":[{"content":{"parts":[{"text":"Hi"}]},"finishReason":"STOP"}]}\n\n', "Hi"],
] as const;
for (const [protocol, payload, expected] of cases) {
  const deltas: string[] = [];
  for await (const delta of chatTextDeltas(new Response(payload), protocol)) deltas.push(delta);
  assert.equal(deltas.join(""), expected, `${protocol} stream text`);
}

await assert.rejects(async () => {
  for await (const _ of chatTextDeltas(new Response('data: {"choices":[{"delta":{"content":"Partial"}}]}\n\n'), "openai")) { /* partial text remains visible */ }
}, /before completion/);
await assert.rejects(async () => {
  for await (const _ of chatTextDeltas(new Response('data: {"error":{"message":"Provider failed"}}\n\n'), "openai")) { /* no false completion */ }
}, /Provider failed/);
const cumulative: string[] = [];
const streamed = await consumeChatStream(
  { model: "local-test", prompt: { text: "hello" }, media: {}, settings: {} },
  (text) => cumulative.push(text),
  async () => new Response('{"type":"text","text":"Hello"}\n{"type":"text","text":"!"}\n{"type":"done"}\n'),
);
assert.deepEqual(streamed, { text: "Hello!" });
assert.deepEqual(cumulative, ["Hello", "Hello!"]);

console.log("Upload, webhook, and chat stream checks passed.");
