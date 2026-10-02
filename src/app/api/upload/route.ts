import { cookies } from "next/headers";

import {
  MissingCredentialsError,
  PLATFORM_KEY_COOKIE,
  decodeCredentials,
} from "@/generation/credentials";
import { readUploadBody, validateUploadHeaders } from "@/generation/upload";
import { RelayTicketError, verifyUploadRelayTicket } from "@/generation/relay-ticket";

export const runtime = "nodejs";

/** Relay the same presigned ticket used by the browser's direct PUT. */
export async function POST(request: Request): Promise<Response> {
  try {
    const jar = await cookies();
    const credentials = decodeCredentials(jar.get(PLATFORM_KEY_COOKIE)?.value);
    if (!credentials) {
      throw new MissingCredentialsError();
    }

    const contentType = request.headers.get("content-type") ?? "";
    const ticketHeader = request.headers.get("x-pika-upload-ticket");
    const declaredLength = request.headers.get("content-length");
    const ticket = await verifyUploadRelayTicket(parseRelayTicket(ticketHeader), credentials.apiKey);
    const sizeBytes = validateUploadHeaders(contentType, declaredLength, ticket);

    const bytes = await readUploadBody(request.body, sizeBytes);
    const uploadHeaders = new Headers(ticket.headers);
    uploadHeaders.set("content-type", contentType);
    uploadHeaders.set("content-length", String(sizeBytes));
    const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const stored = await fetch(ticket.uploadUrl, {
      method: "PUT",
      headers: uploadHeaders,
      body,
      redirect: "manual",
    });
    if (!stored.ok) {
      const detail = await stored.text().catch(() => "");
      return Response.json(
        { message: detail || `Storage refused the upload (${stored.status})` },
        { status: 502 },
      );
    }
    return Response.json({ url: ticket.url });
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "Upload failed";
    const status = caught instanceof MissingCredentialsError ? 401 : caught instanceof RelayTicketError ? caught.status : /exceeds|size limit/.test(message) ? 413 : 400;
    return Response.json({ message }, { status });
  }
}

function parseRelayTicket(raw: string | null): unknown {
  if (!raw || raw.length > 16_384) throw new Error("Missing or invalid upload ticket");
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error("Missing or invalid upload ticket"); }
  return value;
}
