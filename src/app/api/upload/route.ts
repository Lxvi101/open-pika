import { NextResponse } from "next/server";

import { createUpload } from "@/generation/actions";

/* The fallback leg of src/generation/upload.ts: the browser could not PUT to
   the presigned URL itself, so the bytes pass through here. The slot is minted
   with the visitor's own key, so a request without one uploads nothing. */

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const contentType = request.headers.get("content-type") ?? "";
    const bytes = await request.arrayBuffer();
    const ticket = await createUpload({ contentType, sizeBytes: bytes.byteLength });
    const stored = await fetch(ticket.uploadUrl, {
      method: "PUT",
      headers: ticket.headers,
      body: bytes,
    });
    if (!stored.ok) {
      return NextResponse.json(
        { message: `Storage refused the upload (${stored.status})` },
        { status: 502 },
      );
    }
    return NextResponse.json({ url: ticket.url });
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "Upload failed";
    console.error("[upload] failed", message);
    return NextResponse.json({ message }, { status: 400 });
  }
}
