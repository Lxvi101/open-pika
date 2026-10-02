import { cookies } from "next/headers";
import { PLATFORM_KEY_COOKIE_OPTIONS } from "@/generation/credentials";
import { speechCredentials } from "@/generation/lipsync/azure";
import { lipSyncError, readSpeechCredentials, requireLipSyncRequest, SPEECH_COOKIE } from "@/generation/lipsync/server";

export async function GET() {
  return Response.json({ configured: Boolean(await readSpeechCredentials()) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  try {
    await requireLipSyncRequest(request);
    const raw = await request.text();
    if (raw.length > 2048) throw new Error("Invalid Azure configuration.");
    const data = JSON.parse(raw);
    const credentials = speechCredentials(data.endpoint, data.key);
    (await cookies()).set(SPEECH_COOKIE, JSON.stringify(credentials), PLATFORM_KEY_COOKIE_OPTIONS);
    return Response.json({ configured: true });
  } catch (error) { return lipSyncError(error); }
}

export async function DELETE(request: Request) {
  try {
    await requireLipSyncRequest(request);
    (await cookies()).delete(SPEECH_COOKIE);
    return Response.json({ configured: Boolean(await readSpeechCredentials()) });
  } catch (error) { return lipSyncError(error); }
}
