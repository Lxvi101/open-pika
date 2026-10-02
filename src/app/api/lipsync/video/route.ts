import { lipSyncError, readWave, requireLipSyncRequest, validateWave } from "@/generation/lipsync/server";
import { createVideoCarrier } from "@/generation/lipsync/video";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    await requireLipSyncRequest(request);
    const bytes = await readWave(request);
    const ratio = new URL(request.url).searchParams.get("ratio") ?? "";
    const video = await createVideoCarrier(new Uint8Array(bytes), validateWave(bytes), ratio);
    return new Response(new Blob([video as Uint8Array<ArrayBuffer>], { type: "video/mp4" }), {
      headers: { "Content-Type": "video/mp4", "Cache-Control": "no-store" },
    });
  } catch (error) { return lipSyncError(error); }
}
