import { transcribe } from "@/generation/lipsync/azure";
import { lipSyncError, readSpeechCredentials, readWave, requireLipSyncRequest } from "@/generation/lipsync/server";

export const runtime = "nodejs";
export const maxDuration = 150;

export async function POST(request: Request) {
  try {
    await requireLipSyncRequest(request);
    const credentials = await readSpeechCredentials();
    if (!credentials) throw new Error("Connect Azure Speech to transcribe automatically, or enter the dialogue manually.");
    const bytes = await readWave(request);
    const text = await transcribe(new Blob([bytes], { type: "audio/wav" }), credentials, request.signal);
    return Response.json({ text }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return lipSyncError(error); }
}
