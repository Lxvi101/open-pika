// Server-only: Node crypto and filesystem code, imported only by the upload
// server action and route. Client code may import the ticket type only.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { link, mkdir, open, readFile, unlink } from "node:fs/promises";
import path from "node:path";

import { createPlatformClient } from "./platform";
import type { PlatformClientOptions, UploadTicket } from "./platform";

const TICKET_TTL_MS = 5 * 60 * 1000;
const MAX_TICKET_BYTES = 16_384;
const LIMITS = { image: 20 * 1024 * 1024, audio: 20 * 1024 * 1024, video: 50 * 1024 * 1024 };

export type SignedUploadTicket = UploadTicket & {
  contentType: string;
  sizeBytes: number;
  /** Unix milliseconds. Covers the original platform ticket's five-minute window. */
  expiresAt: number;
  relaySignature: string;
};

export class RelayTicketError extends Error {
  constructor(message = "Invalid upload relay ticket", readonly status = 403) { super(message); }
}

/** Mint once upstream, then bind every relay field to both this server and its API-key owner. */
export async function createSignedUploadTicket(
  options: PlatformClientOptions,
  contentType: string,
  sizeBytes: number,
): Promise<SignedUploadTicket> {
  validateSize(contentType, sizeBytes);
  if (!options.apiKey) throw new RelayTicketError("Missing platform key", 401);
  const secret = await readRelaySecret();
  // Start before minting: a slow ticket request must not extend upstream expiry.
  const expiresAt = Date.now() + TICKET_TTL_MS;
  const ticket = await createPlatformClient(options).upload(contentType, sizeBytes);
  const claims = validateClaims({ ...ticket, contentType, sizeBytes, expiresAt });
  const relaySignature = signature(claims, options.apiKey, secret).toString("base64url");
  return { ...claims, relaySignature };
}

/** Validate before reading upload bytes or making any storage request. */
export async function verifyUploadRelayTicket(
  value: unknown,
  apiKey: string,
  now = Date.now(),
): Promise<SignedUploadTicket> {
  const envelope = object(value);
  const keys = Object.keys(envelope);
  const allowed = ["uploadUrl", "url", "headers", "contentType", "sizeBytes", "expiresAt", "relaySignature"];
  if (keys.length !== allowed.length || keys.some((key) => !allowed.includes(key)) ||
      typeof envelope.relaySignature !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(envelope.relaySignature) ||
      Buffer.byteLength(JSON.stringify(envelope)) > MAX_TICKET_BYTES) {
    throw new RelayTicketError();
  }
  const claims = validateClaims(envelope);
  if (claims.expiresAt <= now) throw new RelayTicketError("Upload relay ticket expired", 410);
  if (claims.expiresAt > now + TICKET_TTL_MS || !apiKey) throw new RelayTicketError();
  const expected = signature(claims, apiKey, await readRelaySecret());
  const supplied = Buffer.from(envelope.relaySignature, "base64url");
  if (supplied.byteLength !== expected.byteLength || !timingSafeEqual(supplied, expected)) {
    throw new RelayTicketError();
  }
  return { ...claims, relaySignature: envelope.relaySignature };
}

type Claims = Omit<SignedUploadTicket, "relaySignature">;

function validateClaims(value: unknown): Claims {
  const data = object(value);
  if (typeof data.contentType !== "string" || typeof data.sizeBytes !== "number" ||
      typeof data.expiresAt !== "number" || !Number.isSafeInteger(data.expiresAt)) {
    throw new RelayTicketError();
  }
  validateSize(data.contentType, data.sizeBytes);
  for (const field of ["uploadUrl", "url"] as const) {
    if (typeof data[field] !== "string" || data[field].length > 8192) throw new RelayTicketError();
    let url: URL;
    try { url = new URL(data[field]); } catch { throw new RelayTicketError(); }
    if (url.protocol !== "https:" || url.username || url.password) throw new RelayTicketError();
  }
  const originalHeaders = object(data.headers);
  if (Object.keys(originalHeaders).length > 64) throw new RelayTicketError();
  const headers = Object.create(null) as Record<string, string>;
  const seen = new Set<string>();
  for (const [name, header] of Object.entries(originalHeaders)) {
    const lower = name.toLowerCase();
    if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/i.test(name) || typeof header !== "string" ||
        /[^\x20-\x7e\t]/.test(header) || seen.has(lower)) throw new RelayTicketError();
    if ((lower === "content-type" && header !== data.contentType) ||
        (lower === "content-length" && header !== String(data.sizeBytes))) throw new RelayTicketError();
    seen.add(lower);
    headers[name] = header;
  }
  const claims = { uploadUrl: data.uploadUrl as string, url: data.url as string, headers,
    contentType: data.contentType, sizeBytes: data.sizeBytes, expiresAt: data.expiresAt };
  if (Buffer.byteLength(JSON.stringify(claims)) > MAX_TICKET_BYTES - 80) throw new RelayTicketError();
  return claims;
}

function validateSize(contentType: string, sizeBytes: number): void {
  const match = /^(image|audio|video)\/[a-z0-9.+-]+$/i.exec(contentType);
  if (!match || !Number.isSafeInteger(sizeBytes) || sizeBytes <= 0 ||
      sizeBytes > LIMITS[match[1]!.toLowerCase() as keyof typeof LIMITS]) {
    throw new RelayTicketError("Invalid upload type or size", 400);
  }
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RelayTicketError();
  return value as Record<string, unknown>;
}

function signature(claims: Claims, apiKey: string, secret: string): Buffer {
  // Sort headers so JSON property order does not affect a legitimate ticket.
  const headers = Object.entries(claims.headers).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  const payload = JSON.stringify(["pika-upload-relay-v1", apiKey, claims.uploadUrl, claims.url,
    headers, claims.contentType, claims.sizeBytes, claims.expiresAt]);
  return createHmac("sha256", secret).update(payload).digest();
}

/**
 * Set PIKA_UPLOAD_RELAY_SECRET (at least 32 bytes) identically on every instance.
 * Otherwise a single self-hosted installation keeps a random secret under
 * .data/upload-relay-secret, with mode 0600 and exclusive atomic publication.
 * Preserve .data on a persistent volume across restarts. Replicas and ephemeral
 * deployments must use the shared env secret; independently generated secrets
 * cannot verify one another's tickets. PIKA_UPLOAD_RELAY_STATE_DIR can relocate
 * the local secret directory. Never send the secret or API key to the browser.
 */
async function readRelaySecret(): Promise<string> {
  const configured = process.env.PIKA_UPLOAD_RELAY_SECRET;
  if (configured !== undefined) {
    if (Buffer.byteLength(configured) < 32) throw new Error("Upload relay secret must contain at least 32 bytes");
    return configured;
  }
  const directory = process.env.PIKA_UPLOAD_RELAY_STATE_DIR || path.join(process.cwd(), ".data");
  const file = path.join(directory, "upload-relay-secret");
  let stored: string;
  try { stored = await readFile(file, "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = path.join(directory, `.upload-relay-secret-${randomBytes(16).toString("hex")}.tmp`);
    try {
      const handle = await open(temporary, "wx", 0o600);
      try { await handle.writeFile(randomBytes(32).toString("hex")); await handle.sync(); }
      finally { await handle.close(); }
      try { await link(temporary, file); }
      catch (linkError) { if ((linkError as NodeJS.ErrnoException).code !== "EEXIST") throw linkError; }
    } finally { await unlink(temporary).catch(() => {}); }
    stored = await readFile(file, "utf8");
  }
  if (!/^[a-f0-9]{64}$/.test(stored)) throw new Error("Upload relay secret file is invalid");
  return stored;
}
