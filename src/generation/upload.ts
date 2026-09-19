import { createUpload } from "./actions";

/** Files go to the platform's own storage: a server action mints a presigned
    slot with the visitor's key, and the bytes travel from the browser straight
    to it. Storage that refuses a cross-origin PUT is reached through
    /api/upload instead, which forwards the same bytes from the server. */
export async function uploadMedia(file: File): Promise<{ url: string }> {
  const contentType = file.type || "application/octet-stream";
  const ticket = await createUpload({ contentType, sizeBytes: file.size });
  /* Content-Length is signed too, but a browser writes that header itself —
     from the body, which is the exact length the ticket was minted for. */
  const headers = Object.fromEntries(
    Object.entries(ticket.headers).filter(([name]) => name.toLowerCase() !== "content-length"),
  );
  try {
    const direct = await fetch(ticket.uploadUrl, { method: "PUT", headers, body: file });
    if (direct.ok) return { url: ticket.url };
  } catch {
    /* a CORS refusal surfaces as a network error; the relay below is the answer */
  }
  const relayed = await fetch("/api/upload", {
    method: "POST",
    headers: { "content-type": contentType },
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
