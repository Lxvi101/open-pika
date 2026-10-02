import { createUpload } from "./actions";
import type { SignedUploadTicket } from "./relay-ticket";

export const MAX_UPLOAD_BYTES = {
  image: 20 * 1024 * 1024,
  audio: 20 * 1024 * 1024,
  video: 50 * 1024 * 1024,
} as const;

export type RelayUploadTicket = {
  uploadUrl: string;
  headers: Record<string, string>;
  url: string;
  contentType: string;
  sizeBytes: number;
};

export function validateUploadHeaders(
  contentType: string,
  contentLength: string | null,
  ticket: RelayUploadTicket,
): number {
  const match = /^(image|audio|video)\/[a-z0-9.+-]+$/i.exec(contentType);
  if (!match) throw new Error("Unsupported file type");
  if (ticket.contentType !== contentType) throw new Error("Upload content type does not match its ticket");
  const size = contentLength === null ? NaN : Number(contentLength);
  if (!Number.isSafeInteger(size) || size <= 0 || size !== ticket.sizeBytes) {
    throw new Error("Upload length does not match its ticket");
  }
  const limit = MAX_UPLOAD_BYTES[match[1]!.toLowerCase() as keyof typeof MAX_UPLOAD_BYTES];
  if (size > limit) throw new Error("File exceeds the upload size limit");
  const headers = new Headers(ticket.headers);
  const signedType = headers.get("content-type");
  const signedLength = headers.get("content-length");
  if ((signedType && signedType !== contentType) || (signedLength && signedLength !== String(size))) {
    throw new Error("Upload headers do not match the signed ticket");
  }
  return size;
}

/** Reads a request incrementally and stops as soon as the declared bound is exceeded. */
export async function readUploadBody(
  body: ReadableStream<Uint8Array> | null,
  expectedBytes: number,
): Promise<Uint8Array> {
  if (!body) throw new Error("Missing upload body");
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > expectedBytes || total > MAX_UPLOAD_BYTES.video) {
        await reader.cancel();
        throw new Error("Upload body exceeds its declared size or size limit");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (total !== expectedBytes) throw new Error("Upload body length does not match its ticket");
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}

/** Files go to the platform's own storage: a server action mints a presigned
    slot with the visitor's key, and the bytes travel from the browser straight
    to it. Storage that refuses a cross-origin PUT is reached through
    /api/upload instead, which forwards the same bytes from the server. */
export async function uploadMedia(file: File): Promise<{ url: string }> {
  const contentType = file.type || "application/octet-stream";
  const kind = contentType.split("/", 1)[0] as keyof typeof MAX_UPLOAD_BYTES;
  if (!Object.hasOwn(MAX_UPLOAD_BYTES, kind) || !/^(image|audio|video)\/[a-z0-9.+-]+$/i.test(contentType)) {
    throw new Error("Unsupported file type");
  }
  if (file.size <= 0 || file.size > MAX_UPLOAD_BYTES[kind]) throw new Error("File exceeds the upload size limit");
  const created: unknown = await createUpload({ contentType, sizeBytes: file.size });
  let ticket: SignedUploadTicket;
  if (created && typeof created === "object" && "ok" in created) {
    const result = created as { ok: boolean; value?: typeof ticket; error?: { message?: string } };
    if (!result.ok) throw new Error(result.error?.message || "Could not create upload ticket");
    if (!result.value) throw new Error("Upload ticket response was invalid");
    ticket = result.value;
  } else {
    ticket = created as typeof ticket;
  }
  /* Content-Length is signed too, but a browser writes that header itself —
     from the body, which is the exact length the ticket was minted for. */
  const relayTicket = ticket;
  const headers = new Headers(ticket.headers);
  if (headers.has("content-type") && headers.get("content-type") !== contentType) {
    throw new Error("Upload content type does not match the signed ticket");
  }
  if (!headers.has("content-type")) headers.set("content-type", contentType);
  if (headers.has("content-length") && headers.get("content-length") !== String(file.size)) {
    throw new Error("Upload length does not match the signed ticket");
  }
  headers.set("content-length", String(file.size));
  const normalizedHeaders = Object.fromEntries(headers.entries());
  let direct: Response | undefined;
  try {
    direct = await fetch(ticket.uploadUrl, { method: "PUT", headers: normalizedHeaders, body: file });
  } catch { /* A CORS/network failure is relayed with this same ticket. */ }
  if (direct?.ok) return { url: ticket.url };
  if (direct) throw new Error(await uploadError(direct));
  const relayed = await fetch("/api/upload", {
    method: "POST",
    headers: { "content-type": contentType, "x-pika-upload-ticket": JSON.stringify(relayTicket) },
    body: file,
  });
  if (!relayed.ok) throw new Error(await uploadError(relayed));
  const { url } = (await relayed.json()) as { url?: unknown };
  if (typeof url !== "string") throw new Error("Upload failed");
  return { url };
}

async function uploadError(response: Response): Promise<string> {
  try {
    const { message } = (await response.json()) as { message?: unknown };
    if (typeof message === "string" && message) return message;
  } catch {
    /* not JSON */
  }
  return `Upload failed (${response.status})`;
}
