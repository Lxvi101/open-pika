import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createSignedUploadTicket, RelayTicketError, verifyUploadRelayTicket } from "../src/generation/relay-ticket";

const priorSecret = process.env.PIKA_UPLOAD_RELAY_SECRET;
const priorDirectory = process.env.PIKA_UPLOAD_RELAY_STATE_DIR;
const directory = await mkdtemp(path.join(os.tmpdir(), "openpika-relay-ticket-check-"));
const owner = "test-api-key-never-sent-remotely";
let mintRequests = 0;
const options = {
  apiKey: owner,
  baseUrl: "https://platform.example",
  fetch: (async (_url, init) => {
    mintRequests += 1;
    assert.equal(init?.method, "POST");
    assert.deepEqual(JSON.parse(String(init?.body)), { content_type: "image/png", size_bytes: 3 });
    return Response.json({
      upload_url: "https://storage.example/signed-upload?signature=upstream-test",
      url: "https://cdn.example/file",
      headers: { "Content-Type": "image/png", "Content-Length": "3", "X-Storage-Signature": "upstream-test" },
    });
  }) as typeof fetch,
};

try {
  process.env.PIKA_UPLOAD_RELAY_SECRET = "a-private-test-signing-secret-of-at-least-32-bytes";
  const ticket = await createSignedUploadTicket(options, "image/png", 3);
  const now = Date.now();
  assert.equal(mintRequests, 1, "issue exactly one platform ticket");
  assert.deepEqual(await verifyUploadRelayTicket(ticket, owner, now), ticket);
  assert.deepEqual(await verifyUploadRelayTicket(JSON.parse(JSON.stringify(ticket)), owner, now), ticket,
    "JSON transport preserves the signed ticket");
  assert.equal(mintRequests, 1, "relay verification does not mint or fetch anything");

  for (const mutation of [
    { uploadUrl: "https://attacker.example/arbitrary-put" },
    { uploadUrl: "https://127.0.0.1/internal" },
    { url: "https://attacker.example/output" },
    { headers: { ...ticket.headers, "X-Storage-Signature": "modified" } },
    { headers: { ...ticket.headers, "X-Injected": "attacker-header" } },
    { headers: { ...ticket.headers, Host: "internal.example" } },
    { contentType: "image/jpeg" },
    { sizeBytes: 4 },
    { expiresAt: ticket.expiresAt - 1 },
    { relaySignature: "A".repeat(43) },
    { arbitraryField: true },
  ]) {
    await assert.rejects(verifyUploadRelayTicket({ ...ticket, ...mutation }, owner, now), RelayTicketError);
  }
  await assert.rejects(verifyUploadRelayTicket(ticket, "some-arbitrary-entered-key", now), RelayTicketError);
  await assert.rejects(verifyUploadRelayTicket(ticket, owner, ticket.expiresAt), (error: unknown) =>
    error instanceof RelayTicketError && error.status === 410);
  await assert.rejects(verifyUploadRelayTicket({ ...ticket, expiresAt: now + 301_000 }, owner, now), RelayTicketError);
  await assert.rejects(verifyUploadRelayTicket({ uploadUrl: "https://attacker.example" }, owner, now), RelayTicketError);
  await assert.rejects(createSignedUploadTicket(options, "image/png", 20 * 1024 * 1024 + 1), RelayTicketError);
  await assert.rejects(createSignedUploadTicket(options, "audio/wav", 20 * 1024 * 1024 + 1), RelayTicketError);
  await assert.rejects(createSignedUploadTicket(options, "video/mp4", 50 * 1024 * 1024 + 1), RelayTicketError);
  assert.equal(mintRequests, 1, "invalid size is refused before contacting the platform");

  // Every racer must use the same fully written secret. No partial file is visible.
  delete process.env.PIKA_UPLOAD_RELAY_SECRET;
  process.env.PIKA_UPLOAD_RELAY_STATE_DIR = directory;
  const concurrentlyIssued = await Promise.all(Array.from({ length: 8 }, () => createSignedUploadTicket(options, "image/png", 3)));
  for (const issued of concurrentlyIssued) assert.deepEqual(await verifyUploadRelayTicket(issued, owner), issued);
  const secretFile = path.join(directory, "upload-relay-secret");
  assert.equal((await stat(secretFile)).mode & 0o777, 0o600);
  assert.match(await readFile(secretFile, "utf8"), /^[a-f0-9]{64}$/);
  assert.deepEqual(await readdir(directory), ["upload-relay-secret"], "temporary files are removed");
} finally {
  if (priorSecret === undefined) delete process.env.PIKA_UPLOAD_RELAY_SECRET;
  else process.env.PIKA_UPLOAD_RELAY_SECRET = priorSecret;
  if (priorDirectory === undefined) delete process.env.PIKA_UPLOAD_RELAY_STATE_DIR;
  else process.env.PIKA_UPLOAD_RELAY_STATE_DIR = priorDirectory;
  await rm(directory, { recursive: true, force: true });
}

console.log("Signed relay ticket checks passed: binding, tampering, expiry, limits, and atomic secret creation.");
